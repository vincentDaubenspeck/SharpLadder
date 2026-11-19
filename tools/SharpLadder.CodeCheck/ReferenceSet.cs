using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using Microsoft.CodeAnalysis;

namespace SharpLadder.CodeCheck;

// The reference assemblies every group compiles against, loaded once per run. Each DLL is read
// whole into memory, so no file or mapping stays open on the install; the metadata owners live
// until the run ends.
internal sealed class ReferenceSet : IDisposable
{
    private const string Reinstall = "run node tools/install-tools.mjs";

    private readonly List<AssemblyMetadata> _owners;

    private ReferenceSet(List<AssemblyMetadata> owners, ImmutableArray<MetadataReference> references)
    {
        _owners = owners;
        References = references;
    }

    public ImmutableArray<MetadataReference> References { get; }

    // The stamp vouches for a verified install of the pinned pack; the committed list, never the
    // folder, says which files that install holds.
    public static ReferenceSet Load(Locations locations)
    {
        var listed = ReadList(locations);
        CheckStamp(locations);
        CheckFolder(locations, listed);

        var owners = new List<AssemblyMetadata>(listed.Count);
        var references = ImmutableArray.CreateBuilder<MetadataReference>(listed.Count);
        try
        {
            foreach (var name in listed)
            {
                var assembly = ReadAssembly(locations, name);
                owners.Add(assembly);
                references.Add(assembly.GetReference(display: name));
            }

            return new ReferenceSet(owners, references.MoveToImmutable());
        }
        catch
        {
            owners.ForEach(o => o.Dispose());
            throw;
        }
    }

    public void Dispose() => _owners.ForEach(o => o.Dispose());

    private static List<string> ReadList(Locations locations)
    {
        var list = JsonFile.Read(locations.ReferenceList, Locations.ReferenceListShown);
        var version = JsonFile.Text(list, "version");
        if (!string.Equals(version, locations.Pin.Version, StringComparison.Ordinal))
        {
            throw new ToolProblem($"{Locations.ReferenceListShown} is for {version ?? "no version"}, the pin is {locations.Pin.Version}");
        }

        var names = list["files"] is JsonArray files
            ? files.Select(f => f is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.String ? v.GetValue<string>() : null).ToList()
            : [];
        if (names.Count == 0 || names.Any(string.IsNullOrEmpty))
        {
            throw new ToolProblem($"{Locations.ReferenceListShown}: files must be a list of file names");
        }

        if (names.GroupBy(n => n, StringComparer.Ordinal).FirstOrDefault(g => g.Count() > 1) is { } twice)
        {
            throw new ToolProblem($"{Locations.ReferenceListShown} names {twice.Key} twice");
        }

        return names!;
    }

    private static void CheckStamp(Locations locations)
    {
        if (!File.Exists(locations.ReferenceStamp))
        {
            throw new ToolProblem($"{Locations.ReferenceStampShown} is missing, so the reference set is not installed; {Reinstall}");
        }

        var stamp = JsonFile.Read(locations.ReferenceStamp, Locations.ReferenceStampShown);
        if (!string.Equals(JsonFile.Text(stamp, "version"), locations.Pin.Version, StringComparison.Ordinal)
            || !string.Equals(JsonFile.Text(stamp, "sha512"), locations.Pin.Sha512, StringComparison.Ordinal))
        {
            throw new ToolProblem($"{Locations.ReferenceStampShown} does not record the dotnet-ref pin ({locations.Pin.Version} and its sha512); {Reinstall}");
        }
    }

    private static void CheckFolder(Locations locations, List<string> listed)
    {
        var folder = new DirectoryInfo(locations.ReferenceFolder);
        if (!folder.Exists)
        {
            throw new ToolProblem($"{Locations.ReferenceFolderShown} is missing; {Reinstall}");
        }

        // Hidden and system entries count too, so nothing in the folder goes unseen.
        var options = new EnumerationOptions { AttributesToSkip = FileAttributes.None, IgnoreInaccessible = false, RecurseSubdirectories = false };
        var entries = folder.EnumerateFileSystemInfos("*", options).ToList();
        var found = entries.Select(e => e.Name).ToHashSet(StringComparer.Ordinal);
        var expected = listed.ToHashSet(StringComparer.Ordinal);
        var missing = listed.Where(n => !found.Contains(n)).ToList();
        var extra = found.Where(n => !expected.Contains(n)).Order(StringComparer.Ordinal).ToList();
        if (missing.Count > 0 || extra.Count > 0)
        {
            throw new ToolProblem($"{Locations.ReferenceFolderShown} differs from {Locations.ReferenceListShown} (missing: {Names(missing)}; not listed: {Names(extra)}); {Reinstall}");
        }

        var odd = entries
            .Where(e => e is not FileInfo || e.LinkTarget is not null || e.Attributes.HasFlag(FileAttributes.ReparsePoint))
            .Select(e => e.Name)
            .Order(StringComparer.Ordinal)
            .ToList();
        if (odd.Count > 0)
        {
            throw new ToolProblem($"{Locations.ReferenceFolderShown}: not regular files: {Names(odd)}; {Reinstall}");
        }
    }

    private static AssemblyMetadata ReadAssembly(Locations locations, string name)
    {
        var shown = $"{Locations.ReferenceFolderShown}/{name}";
        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(Path.Combine(locations.ReferenceFolder, name));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{shown}: cannot be read: {e.Message}", e);
        }

        // The image is the array itself, never copied and never tied to the file.
        var image = ImmutableCollectionsMarshal.AsImmutableArray(bytes);
        return IsAssembly(image)
            ? AssemblyMetadata.CreateFromImage(image)
            : throw new ToolProblem($"{shown} is not valid metadata; {Reinstall}");
    }

    // Reading the manifest parses the headers and metadata tables now, before any group compiles.
    private static bool IsAssembly(ImmutableArray<byte> image)
    {
        try
        {
            using var pe = new PEReader(image);
            if (!pe.HasMetadata)
            {
                return false;
            }

            var reader = pe.GetMetadataReader();
            return reader.IsAssembly && reader.GetString(reader.GetAssemblyDefinition().Name).Length > 0;
        }
        catch (BadImageFormatException)
        {
            return false;
        }
    }

    private static string Names(List<string> names) => names.Count == 0 ? "none" : string.Join(", ", names);
}
