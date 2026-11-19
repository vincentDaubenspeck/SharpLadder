using System.Buffers.Binary;
using System.Formats.Tar;
using System.IO.Compression;
using System.Text.Json;

namespace SharpLadder.CodeCheck;

// A docker save image, in the OCI layout of current engines or the legacy layout, both of which list
// their layers in manifest.json. It is read in two passes of a tar reader and never extracted: the
// first indexes the outer entries and reads the manifest, the second scans every outer entry and
// every entry of every listed layer. Whiteouts are never applied, so a file a later layer deletes is
// still scanned in the layer that added it; links are never followed; nothing nested is decompressed.
internal static class DockerSave
{
    private const string ManifestName = "manifest.json";

    private const int Block = 512;

    // A gzip's 10-byte header and 8-byte trailer.
    private const int GzipFrame = 18;

    private static readonly byte[] Gzip = [0x1f, 0x8b];

    private static readonly byte[] Zstd = [0x28, 0xb5, 0x2f, 0xfd];

    // The number of files scanned.
    public static int Scan(string path, string display, LeakScanner scanner)
    {
        var (config, layers) = Index(path, display);
        using var stream = Open(path, display);
        return Tar(display, () =>
        {
            using var reader = new TarReader(stream);
            var files = 0;
            while (Next(reader, display) is { } entry)
            {
                if (layers.Contains(entry.Name))
                {
                    files += Layer(entry.DataStream ?? Stream.Null, $"{display} layer {Shown(entry.Name)}", scanner);
                }
                else if (!string.Equals(entry.Name, config, StringComparison.Ordinal) && Compressed(Head(entry.DataStream ?? Stream.Null)))
                {
                    // A save of several platforms holds the other platforms' layers unlisted, and
                    // nothing nested is decompressed, so their files could not be scanned.
                    throw new ToolProblem($"{display} entry {Shown(entry.Name)}: compressed but not listed in Layers, so it cannot be scanned");
                }
                else
                {
                    files += Entry(entry, $"{display} entry {Shown(entry.Name)}", scanner);
                }
            }

            return files;
        });
    }

    // Pass one: the Config name and the listed layers, once each, after every rule on the outer tar and
    // its manifest holds.
    private static (string Config, HashSet<string> Layers) Index(string path, string display)
    {
        var types = new Dictionary<string, TarEntryType>(StringComparer.Ordinal);
        byte[]? manifest = null;
        using (var stream = Open(path, display))
        {
            Tar(display, () =>
            {
                using var reader = new TarReader(stream, leaveOpen: true);
                while (Next(reader, display) is { } entry)
                {
                    if (!types.TryAdd(entry.Name, entry.EntryType))
                    {
                        throw new ToolProblem($"{display}: two entries are named {Shown(entry.Name)}");
                    }

                    if (string.Equals(entry.Name, ManifestName, StringComparison.Ordinal) && IsFile(entry.EntryType))
                    {
                        manifest = Data(entry, $"{display} entry {ManifestName}");
                    }
                }

                End(stream, display);
                return 0;
            });
        }

        if (manifest is null)
        {
            throw new ToolProblem($"{display}: no {ManifestName}, which a docker save image holds");
        }

        var (config, layers) = Manifest(manifest, display);
        foreach (var (role, name) in layers.Select(l => ("layer", l)).Prepend(("Config", config)))
        {
            if (!types.TryGetValue(name, out var type) || !IsFile(type))
            {
                throw new ToolProblem($"{display}: {ManifestName} names {role} {Shown(name)}, which is not a regular entry of the image");
            }
        }

        return (config, layers);
    }

    // One image per scan: an array of one object, whose Config is a string and whose Layers is an
    // array of one or more strings. Other keys are ignored, and a layer named twice is scanned once.
    private static (string Config, HashSet<string> Layers) Manifest(byte[] bytes, string display)
    {
        var problem = $"{display}: {ManifestName} is not an array of one object with Config, a string, and Layers, an array of one or more strings";
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowDuplicateProperties = false });
        }
        catch (JsonException e)
        {
            throw new ToolProblem($"{display}: {ManifestName} does not parse ({e.Message})", e);
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Array || root.GetArrayLength() != 1 || root[0].ValueKind != JsonValueKind.Object
                || !root[0].TryGetProperty("Config", out var config) || config.ValueKind != JsonValueKind.String
                || !root[0].TryGetProperty("Layers", out var layers) || layers.ValueKind != JsonValueKind.Array || layers.GetArrayLength() == 0)
            {
                throw new ToolProblem(problem);
            }

            var names = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < layers.GetArrayLength(); i++)
            {
                names.Add(layers[i].ValueKind == JsonValueKind.String ? layers[i].GetString()! : throw new ToolProblem(problem));
            }

            return (config.GetString()!, names);
        }
    }

    // A layer is a tar, or a gzip of one; any other format cannot be scanned.
    private static int Layer(Stream data, string display, LeakScanner scanner)
    {
        var head = Head(data);
        if (head.SequenceEqual(Zstd))
        {
            throw new ToolProblem($"{display}: zstd-compressed; only tar and gzip layers can be scanned");
        }

        if (!head.StartsWith(Gzip))
        {
            return Entries(data, display, scanner);
        }

        int files;
        long length;
        using (var gzip = new GZipStream(data, CompressionMode.Decompress, leaveOpen: true))
        using (var counted = new Counting(gzip))
        {
            files = Entries(counted, display, scanner);
            length = counted.Count;
        }

        // The decompressor accepts a gzip without its trailer and ignores bytes after it, so the
        // trailer's length is a guard against a layer truncated or with bytes appended by accident,
        // not full gzip validation.
        Span<byte> size = stackalloc byte[sizeof(uint)];
        if (data.Length >= GzipFrame)
        {
            data.Position = data.Length - size.Length;
            data.ReadExactly(size);
        }

        return data.Length >= GzipFrame && BinaryPrimitives.ReadUInt32LittleEndian(size) == unchecked((uint)length)
            ? files
            : throw new ToolProblem($"{display}: a gzip whose trailer does not hold its decompressed length, so it is cut short or has bytes appended");
    }

    // The first bytes of an entry, which tell its compression; the entry is then read from its start.
    private static ReadOnlySpan<byte> Head(Stream data)
    {
        var head = new byte[Zstd.Length];
        var read = data.ReadAtLeast(head, head.Length, throwOnEndOfStream: false);
        data.Position = 0;
        return head.AsSpan(0, read);
    }

    private static bool Compressed(ReadOnlySpan<byte> head) => head.StartsWith(Gzip) || head.SequenceEqual(Zstd);

    private static int Entries(Stream tar, string display, LeakScanner scanner)
    {
        return Tar(display, () =>
        {
            using var reader = new TarReader(tar, leaveOpen: true);
            var files = 0;
            while (Next(reader, display) is { } entry)
            {
                files += Entry(entry, $"{display} entry {Shown(entry.Name)}", scanner);
            }

            End(tar, display);
            return files;
        });
    }

    // A whiteout is the empty regular file it is. Directories, devices and FIFOs carry no data and
    // links are never followed; any data such an entry does carry is scanned all the same.
    private static int Entry(TarEntry entry, string display, LeakScanner scanner)
    {
        if (Data(entry, display) is not { } bytes)
        {
            return 0;
        }

        scanner.Scan(display, LeakText.Views(entry.Name, bytes, display));
        return 1;
    }

    private static byte[]? Data(TarEntry entry, string display)
    {
        if (entry.DataStream is not { } data)
        {
            return IsFile(entry.EntryType) ? [] : null;
        }

        var bytes = LeakText.Read(data, display);
        return bytes.Length == entry.Length
            ? bytes
            : throw new ToolProblem($"{display}: truncated, {bytes.Length} of {entry.Length} bytes");
    }

    private static TarEntry? Next(TarReader reader, string display)
    {
        var entry = reader.GetNextEntry();
        return entry is null || Readable(entry)
            ? entry
            : throw new ToolProblem($"{display}: entry {Shown(entry.Name)} has type {entry.EntryType}, which the scan cannot read");
    }

    // Any other type holds data the scan cannot read as content, such as a sparse file's stored
    // bytes, whether the GNU type or the PAX attributes mark it sparse.
    private static bool Readable(TarEntry entry) =>
        entry.EntryType is TarEntryType.RegularFile or TarEntryType.V7RegularFile or TarEntryType.ContiguousFile
            or TarEntryType.Directory or TarEntryType.SymbolicLink or TarEntryType.HardLink
            or TarEntryType.CharacterDevice or TarEntryType.BlockDevice or TarEntryType.Fifo
        && !(entry is PaxTarEntry pax && pax.ExtendedAttributes.Keys.Any(k => k.StartsWith("GNU.sparse.", StringComparison.Ordinal)));

    private static bool IsFile(TarEntryType type) =>
        type is TarEntryType.RegularFile or TarEntryType.V7RegularFile or TarEntryType.ContiguousFile;

    // The reader stops at the first zero block, so a tar that ends there lacks the rest of its end
    // marker, and bytes after the marker would never be scanned.
    private static void End(Stream stream, string display)
    {
        var buffer = new byte[81920];
        long rest = 0;
        int count;
        while ((count = stream.Read(buffer)) > 0)
        {
            if (buffer.AsSpan(0, count).ContainsAnyExcept((byte)0))
            {
                throw new ToolProblem($"{display}: bytes after the end of the tar, which the scan cannot read");
            }

            rest += count;
        }

        if (rest < Block)
        {
            throw new ToolProblem($"{display}: a truncated tar, without its end marker");
        }
    }

    // The reader's and the decompressor's own refusals of what they cannot read.
    private static int Tar(string display, Func<int> read)
    {
        try
        {
            return read();
        }
        catch (Exception e) when (e is InvalidDataException or EndOfStreamException)
        {
            throw new ToolProblem($"{display}: a malformed or truncated tar or gzip ({e.Message})", e);
        }
    }

    private static FileStream Open(string path, string display)
    {
        try
        {
            return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{display}: could not be read ({e.GetType().Name})", e);
        }
    }

    // An entry name is untrusted text, so a control character cannot break a reported line.
    private static string Shown(string name) => string.Concat(name.Select(c => char.IsControl(c) ? '?' : c));

    // Every byte read through it counts, tar headers, padding and the drained tail included, as the
    // gzip trailer's length does.
    private sealed class Counting(Stream inner) : Stream
    {
        public long Count { get; private set; }

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

        public override int Read(Span<byte> buffer)
        {
            var read = inner.Read(buffer);
            Count += read;
            return read;
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
