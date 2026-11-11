using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SharpLadder.Content;

// The payload: compiled fixture JSON under compiled/, generated TypeScript under src/generated/
// and compiled/manifest.json, which lists every other payload file. Paths are relative to web/,
// and a staging folder holds the same layout, so its relative paths are these paths.
internal static class Payload
{
    public const string CompiledFolder = "compiled";
    public const string GeneratedFolder = "src/generated";
    public const string ManifestPath = "compiled/manifest.json";

    private static readonly UTF8Encoding Strict = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // Files is null on failure: Code 1 for content errors, 2 for a schema or type emitter refusal.
    public static (IReadOnlyList<OutputFile>? Files, IContentSchema? Schema, int Code, IReadOnlyList<string> Problems) Generate(InputTree schemaTree, InputTree contentTree)
    {
        var (schema, schemaProblems) = SchemaSet.Load(schemaTree);
        if (schema is null)
        {
            return (null, null, 2, [.. schemaProblems.Select(p => "schema: " + p)]);
        }

        var (modules, typeProblems) = TypeEmitter.Emit(schemaTree);
        if (modules is null)
        {
            return (null, null, 2, [.. typeProblems.Select(p => "types: " + p)]);
        }

        var result = ContentCompiler.Compile(contentTree, schema);
        if (result.Diagnostics.Count > 0)
        {
            return (null, null, 1, [.. result.Diagnostics.Select(d => d.ToString())]);
        }

        var witnesses = new List<OutputFile>();
        foreach (var file in result.Files)
        {
            // The witness is emitted only from bytes the schema accepts, the same bytes compiled/ receives.
            var invalid = schema.Validate(Strict.GetString(file.Bytes));
            var (witness, witnessProblems) = invalid is null ? WitnessEmitter.Emit(file.RelativePath, file.Bytes) : (null, [$"{file.RelativePath}: {invalid}"]);
            if (witness is null)
            {
                return (null, null, 2, [.. witnessProblems.Select(p => "witness: " + p)]);
            }

            witnesses.Add(new OutputFile($"{GeneratedFolder}/{WitnessEmitter.ModulePath(file.RelativePath)}", Strict.GetBytes(witness)));
        }

        var files = result.Files
            .Select(f => new OutputFile($"{CompiledFolder}/{f.RelativePath}", f.Bytes))
            .Concat(modules.Select(m => new OutputFile($"{GeneratedFolder}/{m.Key}", Strict.GetBytes(m.Value))))
            .Concat(witnesses)
            .ToList();
        files.Add(new OutputFile(ManifestPath, BuildManifest(files)));
        return ([.. files.OrderBy(f => f.RelativePath, StringComparer.Ordinal)], schema, 0, []);
    }

    public static byte[] BuildManifest(IEnumerable<OutputFile> files)
    {
        var entries = files
            .Where(f => !string.Equals(f.RelativePath, ManifestPath, StringComparison.Ordinal))
            .OrderBy(f => f.RelativePath, StringComparer.Ordinal)
            .Select(f => $"    {{ \"path\": {JsonSerializer.Serialize(f.RelativePath)}, \"sha256\": \"{Convert.ToHexStringLower(SHA256.HashData(f.Bytes))}\" }}")
            .ToList();
        var list = entries.Count == 0 ? "[]" : "[\n" + string.Join(",\n", entries) + "\n  ]";
        return Strict.GetBytes($"{{\n  \"version\": 1,\n  \"files\": {list}\n}}\n");
    }

    public static void Collect(InputTree tree, string prefix, Dictionary<string, byte[]> into, string relative = "")
    {
        foreach (var entry in tree.Children(relative))
        {
            if (entry.IsFolder)
            {
                Collect(tree, prefix, into, entry.Relative);
            }
            else
            {
                into.Add(prefix + entry.Relative, entry.Bytes!);
            }
        }
    }

    // Fresh output against the committed trees: one problem per missing, extra or changed file,
    // then the committed manifest checked on its own against the committed files.
    public static List<string> Compare(IReadOnlyDictionary<string, byte[]> fresh, IReadOnlyDictionary<string, byte[]> committed)
    {
        var problems = new List<string>();
        foreach (var path in fresh.Keys.Union(committed.Keys, StringComparer.Ordinal).Order(StringComparer.Ordinal))
        {
            if (!committed.TryGetValue(path, out var mine))
            {
                problems.Add($"{path}: missing from the committed trees");
            }
            else if (!fresh.TryGetValue(path, out var theirs))
            {
                problems.Add($"{path}: not in fresh output");
            }
            else if (!mine.AsSpan().SequenceEqual(theirs))
            {
                problems.Add($"{path}: differs from fresh output");
            }
        }

        problems.AddRange(CheckManifest(committed));
        return problems;
    }

    // The committed manifest read strictly: its shape, then each entry, then the committed files
    // it fails to list.
    public static List<string> CheckManifest(IReadOnlyDictionary<string, byte[]> committed)
    {
        if (!committed.TryGetValue(ManifestPath, out var bytes))
        {
            return [$"{ManifestPath}: missing"];
        }

        if (bytes.AsSpan().StartsWith((byte[])[0xEF, 0xBB, 0xBF]))
        {
            return [$"{ManifestPath}: starts with a byte-order mark"];
        }

        JsonNode? root;
        try
        {
            root = StrictJson.Parse(Strict.GetString(bytes));
        }
        catch (Exception e) when (e is JsonException or DecoderFallbackException)
        {
            return [$"{ManifestPath}: not UTF-8 JSON without duplicate names: {e.Message}"];
        }

        if (root is not JsonObject manifest || !Keys(manifest, "version", "files")
            || manifest["version"] is not JsonValue version || version.GetValueKind() != JsonValueKind.Number
            || !string.Equals(version.ToJsonString(), "1", StringComparison.Ordinal)
            || manifest["files"] is not JsonArray entries)
        {
            return [$"{ManifestPath}: must hold exactly \"version\": 1 and a \"files\" array"];
        }

        var problems = new List<string>();
        var listed = new HashSet<string>(StringComparer.Ordinal);
        string? previous = null;
        foreach (var item in entries)
        {
            var (path, problem) = Entry(item, committed, previous);
            if (problem is not null)
            {
                problems.Add($"{ManifestPath}: {problem}");
            }

            if (path is not null)
            {
                previous = path;
                listed.Add(path);
            }
        }

        problems.AddRange(committed.Keys
            .Where(p => !string.Equals(p, ManifestPath, StringComparison.Ordinal) && !listed.Contains(p))
            .Order(StringComparer.Ordinal)
            .Select(p => $"{p}: payload file not in the manifest"));
        return problems;
    }

    // Path is null when the entry names no well-formed path; Problem is null when the entry holds.
    private static (string? Path, string? Problem) Entry(JsonNode? item, IReadOnlyDictionary<string, byte[]> committed, string? previous)
    {
        if (item is not JsonObject entry || !Keys(entry, "path", "sha256")
            || entry["path"] is not JsonValue pathValue || !pathValue.TryGetValue<string>(out var path)
            || entry["sha256"] is not JsonValue hashValue || !hashValue.TryGetValue<string>(out var hash))
        {
            return (null, "each entry must hold exactly a string \"path\" and a string \"sha256\"");
        }

        if (PathProblem(path) is { } problem)
        {
            return (null, $"{path}: {problem}");
        }

        if (previous is not null && string.CompareOrdinal(previous, path) >= 0)
        {
            return (path, string.Equals(previous, path, StringComparison.Ordinal) ? $"{path}: listed twice" : $"{path}: out of ordinal order");
        }

        if (hash.Length != 64 || !hash.All(c => char.IsAsciiDigit(c) || c is >= 'a' and <= 'f'))
        {
            return (path, $"{path}: sha256 must be 64 lower-case hex digits");
        }

        if (!committed.TryGetValue(path, out var file))
        {
            return (path, $"{path}: listed but no such file");
        }

        return string.Equals(hash, Convert.ToHexStringLower(SHA256.HashData(file)), StringComparison.Ordinal)
            ? (path, null)
            : (path, $"{path}: sha256 does not match the file");
    }

    private static string? PathProblem(string path)
    {
        if (path.Contains('\\', StringComparison.Ordinal))
        {
            return "a back slash is not a path separator here";
        }

        if (string.Equals(path, ManifestPath, StringComparison.Ordinal))
        {
            return "the manifest must not list itself";
        }

        if (path.Split('/').Any(s => s is "" or "." or ".."))
        {
            return "empty, . and .. segments are not accepted";
        }

        return path.StartsWith(CompiledFolder + "/", StringComparison.Ordinal) || path.StartsWith(GeneratedFolder + "/", StringComparison.Ordinal)
            ? null
            : $"not below {CompiledFolder}/ or {GeneratedFolder}/";
    }

    private static bool Keys(JsonObject value, params string[] names) =>
        value.Count == names.Length && names.All(value.ContainsKey);
}
