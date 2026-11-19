using System.Formats.Tar;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The leak scan over docker save images written here with a tar writer, in both layouts: a reference
// hidden in a layer that a later layer deletes, images it must pass and images it must refuse.
public sealed class LeakImageTests
{
    // Shared with drill-fix-pair-scores's suite (and starter), then its reference lines 9 and 10.
    private const string Shared = "using System.Collections.Generic;";
    private const string Pairs = "var pairs = new Dictionary<string, int>(StringComparer.Ordinal);";
    private const string Count = "for (var i = 0; i < Math.Min(names.Length, scores.Length); i++)";

    private static readonly string Pair = Path.Combine(Checker.RepositoryRoot, "tools", "SharpLadder.Content.Tests", "fixtures");

    private static string Reference => Path.Combine(Pair, "reference");

    private static string ProblemReference => Checker.Shown(Path.Combine(Reference, "prob-9001.reference.cs"));

    // Layer 1 adds the reference file and layer 2 whites it out, so the merged image no longer holds it.
    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void ReferenceInADeletedLayerFileFails(bool legacy, bool gzip)
    {
        var added = Layer(("app/", null), ("app/solution.cs", File.ReadAllText(Path.Combine(Reference, "prob-9001.reference.cs"))));
        using var folder = new TempFolder();
        var (path, layers) = Image(folder, legacy, [gzip ? Gzipped(added) : added, Layer(("app/.wh.solution.cs", string.Empty))]);
        var entry = $"{Checker.Shown(path)} layer {layers[0]} entry app/solution.cs";

        var (code, lines) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(1, code);
        Assert.Equal(
            [
                $"  {entry}: raw view: holds the marker \"// reference: prob-9001\" of {ProblemReference}",
                $"  {entry}: raw view: holds lines 1 and 4 of {ProblemReference} in a row",
                "FAIL leak",
            ],
            lines);
    }

    // Docker writes RepoTags and may write LayerSources; one blob may serve as two identical layers.
    [Fact]
    public void ManifestWithOtherKeysPasses()
    {
        var layer = Layer(("app/", null), ("app/notes.txt", "Count the words.\n"));
        using var folder = new TempFolder();
        var (path, _) = Image(folder, false, [layer, layer], ",\"LayerSources\":{}");

        var (code, lines) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(0, code);
        Assert.Equal(["5 files scanned", "PASS leak"], lines);
    }

    // The same filter as for a file: excluded lines and lines shared with the suite never count.
    [Fact]
    public void ImageOfOnlyExcludedAndSuiteSharedLinesPasses()
    {
        using var folder = new TempFolder();
        var (path, _) = Image(folder, false, [Gzipped(Layer(("app/notes.txt", $"{Shared}\n{Pairs}\n{Count}\n")))]);
        using var root = new TempFolder();
        root.Write(Path.Combine("tools", "SharpLadder.CodeCheck", "leak-exclusions.txt"), $"# Generic.\n\n# A map with ordinal keys.\n{Pairs}\n# A loop over two lists.\n{Count}\n");

        var (excluded, lines) = Scan(root.Path, path);
        var (live, _) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(0, excluded);
        Assert.Equal(["5 files scanned", "PASS leak"], lines);
        Assert.Equal(1, live);
    }

    [Fact]
    public void MalformedTarCannotBeScanned()
    {
        using var folder = new TempFolder();
        var path = folder.Write("image.tar", new string('x', 2048));

        var (code, lines) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(2, code);
        Assert.StartsWith($"  {Checker.Shown(path)}: a malformed or truncated tar or gzip (", lines[0], StringComparison.Ordinal);
        Assert.Equal("FAIL leak", lines[^1]);
    }

    [Fact]
    public void ImageMissingAListedLayerCannotBeScanned()
    {
        using var folder = new TempFolder();
        var (path, layers) = Image(folder, false, [Layer(("app/", null)), Layer(("etc/", null))], leaveOut: 1);

        var (code, lines) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(path)}: manifest.json names layer {layers[1]}, which is not a regular entry of the image", "FAIL leak"], lines);
    }

    [Fact]
    public void ZstdLayerCannotBeScanned()
    {
        using var folder = new TempFolder();
        var (path, layers) = Image(folder, false, [[0x28, 0xb5, 0x2f, 0xfd, .. Encoding.UTF8.GetBytes("frame")]]);

        var (code, lines) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(path)} layer {layers[0]}: zstd-compressed; only tar and gzip layers can be scanned", "FAIL leak"], lines);
    }

    // The decompressor reads both of these to the end of the tar without a complaint.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void GzipLayerTruncatedOrWithBytesAppendedCannotBeScanned(bool truncated)
    {
        var gzip = Gzipped(Layer(("app/notes.txt", "Count the words.\n")));
        byte[] layer = truncated ? gzip[..^8] : [.. gzip, .. Encoding.UTF8.GetBytes("appended")];
        using var folder = new TempFolder();
        var (path, layers) = Image(folder, false, [layer]);

        var (code, lines) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(path)} layer {layers[0]}: a gzip whose trailer does not hold its decompressed length, so it is cut short or has bytes appended", "FAIL leak"], lines);
    }

    // A save of several platforms holds the other platforms' layers as blobs its manifest does not list.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void UnlistedCompressedEntryCannotBeScanned(bool gzip)
    {
        byte[] blob = gzip ? Gzipped(Layer(("app/notes.txt", "Count the words.\n"))) : [0x28, 0xb5, 0x2f, 0xfd, .. Encoding.UTF8.GetBytes("frame")];
        using var folder = new TempFolder();
        var (path, _) = Image(folder, false, [Layer(("app/", null))], unlisted: blob);

        var (code, lines) = Scan(Checker.RepositoryRoot, path);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(path)} entry blobs/sha256/{Hex(blob)}: compressed but not listed in Layers, so it cannot be scanned", "FAIL leak"], lines);
    }

    private static (int Code, string[] Lines) Scan(string repositoryRoot, string image) =>
        Checker.Run(repositoryRoot, ["leak", Checker.SchemaFolder, Path.Combine(Pair, "content"), Reference, image]);

    // A layer tar; a null text writes a directory.
    private static byte[] Layer(params (string Name, string? Text)[] entries) =>
        Tar(entries.Select(e => (e.Name, e.Text is null ? null : Encoding.UTF8.GetBytes(e.Text))));

    private static byte[] Tar(IEnumerable<(string Name, byte[]? Data)> entries)
    {
        using var buffer = new MemoryStream();
        using (var writer = new TarWriter(buffer, TarEntryFormat.Pax, leaveOpen: true))
        {
            foreach (var (name, data) in entries)
            {
                var entry = new PaxTarEntry(data is null ? TarEntryType.Directory : TarEntryType.RegularFile, name);
                if (data is not null)
                {
                    entry.DataStream = new MemoryStream(data);
                }

                writer.WriteEntry(entry);
            }
        }

        return buffer.ToArray();
    }

    private static byte[] Gzipped(byte[] bytes)
    {
        using var buffer = new MemoryStream();
        using (var gzip = new GZipStream(buffer, CompressionLevel.Optimal, leaveOpen: true))
        {
            gzip.Write(bytes);
        }

        return buffer.ToArray();
    }

    // The image as docker save writes it: the OCI layout keeps every blob under blobs/sha256, the
    // legacy layout gives each layer a folder. leaveOut drops that layer's entry but keeps its name
    // in the manifest; unlisted adds a blob the manifest does not name.
    private static (string Path, string[] Layers) Image(TempFolder folder, bool legacy, byte[][] layers, string otherKeys = "", int? leaveOut = null, byte[]? unlisted = null)
    {
        var config = Encoding.UTF8.GetBytes("{\"architecture\":\"amd64\",\"os\":\"linux\"}");
        var configName = legacy ? $"{Hex(config)}.json" : $"blobs/sha256/{Hex(config)}";
        var names = layers.Select(l => legacy ? $"{Hex(l)}/layer.tar" : $"blobs/sha256/{Hex(l)}").ToArray();
        var manifest = $"[{{\"Config\":{JsonSerializer.Serialize(configName)},\"RepoTags\":[\"fixture:1\"],\"Layers\":{JsonSerializer.Serialize(names)}{otherKeys}}}]";

        var entries = new List<(string, byte[]?)>();
        if (!legacy)
        {
            entries.Add(("blobs/", null));
            entries.Add(("blobs/sha256/", null));
        }

        entries.Add((configName, config));
        foreach (var (layer, index) in layers.Select((l, i) => (l, i)).DistinctBy(l => names[l.i], StringComparer.Ordinal).Where(l => l.i != leaveOut))
        {
            if (legacy)
            {
                entries.Add(($"{Hex(layer)}/", null));
                entries.Add(($"{Hex(layer)}/VERSION", Encoding.UTF8.GetBytes("1.0")));
            }

            entries.Add((names[index], layer));
        }

        if (unlisted is not null)
        {
            entries.Add(($"blobs/sha256/{Hex(unlisted)}", unlisted));
        }

        entries.Add(legacy ? ("repositories", Encoding.UTF8.GetBytes("{\"fixture\":{\"1\":\"0\"}}")) : ("oci-layout", Encoding.UTF8.GetBytes("{\"imageLayoutVersion\":\"1.0.0\"}")));
        if (!legacy)
        {
            entries.Add(("index.json", Encoding.UTF8.GetBytes("{\"schemaVersion\":2,\"manifests\":[]}")));
        }

        entries.Add(("manifest.json", Encoding.UTF8.GetBytes(manifest)));
        var path = Path.Combine(folder.Path, "image.tar");
        File.WriteAllBytes(path, Tar(entries));
        return (path, names);
    }

    private static string Hex(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
}
