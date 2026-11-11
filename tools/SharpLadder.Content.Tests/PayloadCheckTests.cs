using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class PayloadCheckTests
{
    private const string ManifestDrift = "compiled/manifest.json: differs from fresh output";
    private const string SecondChapter = "chapters/fixture-second/chapter.json";
    private const string SecondWitness = "witness/chapters/fixture-second/chapter.ts";
    private static readonly UTF8Encoding Strict = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    [Fact]
    public void RepositoryPayloadEqualsFreshOutput()
    {
        using var stage = new TempFolder();
        var web = Path.Combine(Repository.Root, "web");

        var result = PayloadWorkspace.Invoke(["compare", Repository.SchemaFolder, Repository.Fixture, Path.Combine(web, "compiled"), Path.Combine(web, "src", "generated"), Path.Combine(stage.Path, "fresh")]);

        Assert.True(result.Code == 0, result.Output);
        foreach (var name in new[] { "body.ts", "content.ts" })
        {
            var golden = Path.Combine(Repository.Root, "tools", "SharpLadder.Content.Tests", "fixtures", "emitter", name + ".expected");
            Assert.Equal(File.ReadAllBytes(golden), File.ReadAllBytes(Path.Combine(web, "src", "generated", name)));
        }
    }

    [Fact]
    public void ManifestHasTheFixedShapeAndOrder()
    {
        using var work = new PayloadWorkspace();
        var bytes = File.ReadAllBytes(Path.Combine(work.Compiled, "manifest.json"));
        var text = Strict.GetString(bytes);
        var lines = text.Split('\n');

        Assert.NotEqual(0xEF, bytes[0]);
        Assert.DoesNotContain('\r', text);
        Assert.Equal(["{", "  \"version\": 2,", "  \"files\": ["], lines[..3]);
        Assert.Equal(["  ]", "}", string.Empty], lines[^3..]);
        var paths = lines[3..^3].Select(l => JsonDocument.Parse(l.TrimEnd(',')).RootElement.GetProperty("path").GetString()!).ToList();
        Assert.Equal(paths.Order(StringComparer.Ordinal), paths, StringComparer.Ordinal);
        Assert.Equal(22, paths.Count);
        Assert.DoesNotContain("compiled/manifest.json", paths, StringComparer.Ordinal);
        Assert.Matches("^    \\{ \"path\": \"compiled/aliases.json\", \"kind\": \"aliases\", \"sha256\": \"[0-9a-f]{64}\" \\},$", lines[3]);
        Assert.Matches("^    \\{ \"path\": \"compiled/chapters/fixture-basics/build.json\", \"kind\": \"part\", \"sha256\": \"[0-9a-f]{64}\" \\},$", lines[4]);
        Assert.Matches("^    \\{ \"path\": \"compiled/chapters/fixture-basics/chapter.json\", \"kind\": \"chapter\", \"sha256\": \"[0-9a-f]{64}\" \\},$", lines[5]);
        Assert.Contains(lines, l => l.StartsWith("    { \"path\": \"compiled/patterns.json\", \"kind\": \"patterns\", ", StringComparison.Ordinal));

        // Only a compiled record states a kind.
        Assert.All(lines[3..^3], l => Assert.Equal(l.Contains("\"compiled/", StringComparison.Ordinal), l.Contains("\"kind\"", StringComparison.Ordinal)));
    }

    [Theory]
    [InlineData("self", "the manifest must not list itself")]
    [InlineData("unsorted", "out of ordinal order")]
    [InlineData("duplicate", "listed twice")]
    [InlineData("back-slash", "a back slash is not a path separator here")]
    [InlineData("dot-segment", "empty, . and .. segments are not accepted")]
    [InlineData("no-file", "compiled/zz.json: listed but no such file")]
    [InlineData("wrong-hash", "sha256 does not match the file")]
    [InlineData("upper-hash", "sha256 must be 64 lower-case hex digits")]
    [InlineData("version", "must hold exactly \"version\": 2 and a \"files\" array")]
    [InlineData("extra-key", "must hold exactly \"version\": 2 and a \"files\" array")]
    [InlineData("entry-key", "each entry must hold exactly a string \"path\", a string \"sha256\" and, for a compiled record, a \"kind\"")]
    [InlineData("no-kind", "compiled/aliases.json: kind must be one of chapter, part, aliases, patterns")]
    [InlineData("unknown-kind", "compiled/aliases.json: kind must be one of chapter, part, aliases, patterns")]
    [InlineData("kind-in-capitals", "compiled/aliases.json: kind must be one of chapter, part, aliases, patterns")]
    [InlineData("kind-not-text", "compiled/aliases.json: kind must be one of chapter, part, aliases, patterns")]
    [InlineData("kind-on-generated", "only a compiled record has a kind")]
    [InlineData("relabelled", ManifestDrift)]
    [InlineData("duplicate-name", "not UTF-8 JSON without duplicate names")]
    [InlineData("bom", "starts with a byte-order mark")]
    [InlineData("one-byte", ManifestDrift)]
    public void BadCommittedManifestIsDrift(string change, string expected)
    {
        using var work = new PayloadWorkspace();
        var manifest = Path.Combine(work.Compiled, "manifest.json");
        File.WriteAllBytes(manifest, Mutate(File.ReadAllText(manifest), change));

        var result = work.Run("compare");

        Assert.Equal(1, result.Code);
        Assert.Contains(ManifestDrift, result.Output, StringComparison.Ordinal);
        Assert.Contains(expected, result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("added", "compiled", "compiled/extra.json: not in fresh output")]
    [InlineData("added", "generated", "src/generated/extra.ts: not in fresh output")]
    [InlineData("removed", "compiled", "compiled/" + SecondChapter + ": missing from the committed trees")]
    [InlineData("removed", "generated", "src/generated/body.ts: missing from the committed trees")]
    [InlineData("changed", "compiled", "compiled/" + SecondChapter + ": differs from fresh output")]
    [InlineData("changed", "generated", "src/generated/body.ts: differs from fresh output")]
    [InlineData("added", "witness", "src/generated/witness/chapters/extra.ts: not in fresh output")]
    [InlineData("removed", "witness", "src/generated/" + SecondWitness + ": missing from the committed trees")]
    [InlineData("changed", "witness", "src/generated/" + SecondWitness + ": differs from fresh output")]
    public void DriftInEachGeneratedSetIsReported(string change, string set, string expected)
    {
        using var work = new PayloadWorkspace();
        var file = set switch
        {
            "compiled" => Path.Combine(work.Compiled, SecondChapter),
            "witness" => Path.Combine(work.Generated, SecondWitness),
            _ => Path.Combine(work.Generated, "body.ts"),
        };
        var extra = set switch
        {
            "compiled" => Path.Combine(work.Compiled, "extra.json"),
            "witness" => Path.Combine(work.Generated, "witness", "chapters", "extra.ts"),
            _ => Path.Combine(work.Generated, "extra.ts"),
        };
        if (string.Equals(change, "added", StringComparison.Ordinal))
        {
            PayloadWorkspace.Write(extra, "{}\n");
        }
        else if (string.Equals(change, "removed", StringComparison.Ordinal))
        {
            File.Delete(file);
        }
        else
        {
            File.AppendAllText(file, " ");
        }

        var result = work.Run("compare");

        Assert.Equal(1, result.Code);
        Assert.Contains("  " + expected + "\n", result.Output, StringComparison.Ordinal);
        var path = expected[..expected.IndexOf(':', StringComparison.Ordinal)];
        Assert.Contains(
            change switch { "added" => $"{path}: payload file not in the manifest", "removed" => $"{path}: listed but no such file", _ => $"{path}: sha256 does not match the file" },
            result.Output,
            StringComparison.Ordinal);
    }

    [Fact]
    public void MissingCommittedManifestIsDrift()
    {
        using var work = new PayloadWorkspace();
        File.Delete(Path.Combine(work.Compiled, "manifest.json"));

        var result = work.Run("compare");

        Assert.Equal(1, result.Code);
        Assert.Contains("compiled/manifest.json: missing from the committed trees", result.Output, StringComparison.Ordinal);
        Assert.Contains("  compiled/manifest.json: missing\n", result.Output, StringComparison.Ordinal);
    }

    [Fact]
    public void TestRecordsWritesOneEnvelopeOfTheCompiledPayloads()
    {
        using var work = new PayloadWorkspace();

        var result = work.Run("test-records");

        Assert.Equal(0, result.Code);
        Assert.Empty(result.Output);
        Assert.Empty(result.Error);
        var records = ParseEnvelope(result.Stdout);
        Assert.Equal(
            ["compiled/aliases.json", "compiled/chapters/fixture-basics/build.json", "compiled/chapters/fixture-basics/chapter.json", "compiled/chapters/fixture-basics/gotchas.json", "compiled/chapters/fixture-basics/idioms.json", "compiled/chapters/fixture-basics/library.json", "compiled/chapters/fixture-basics/syntax.json", "compiled/chapters/fixture-empty-intro/chapter.json", "compiled/chapters/fixture-no-sections/chapter.json", "compiled/" + SecondChapter, "compiled/patterns.json"],
            records.Select(r => r.Path),
            StringComparer.Ordinal);
        Assert.All(records, r => Assert.Equal(File.ReadAllText(Path.Combine(work.Web, r.Path)), r.Text));

        // Each record carries the kind the manifest states for it.
        Assert.Equal(
            ["aliases", "part", "chapter", "part", "part", "part", "part", "chapter", "chapter", "chapter", "patterns"],
            JsonNode.Parse(Strict.GetString(result.Stdout))!["records"]!.AsArray().Select(r => r!["kind"]!.GetValue<string>()),
            StringComparer.Ordinal);
    }

    [Fact]
    public void TestRecordsDriftWritesNothingToStandardOutput()
    {
        using var work = new PayloadWorkspace();
        File.AppendAllText(Path.Combine(work.Compiled, SecondChapter), " ");

        var result = work.Run("test-records");

        Assert.Equal(1, result.Code);
        Assert.Empty(result.Stdout);
        Assert.Empty(result.Output);
        Assert.EndsWith("FAIL content test-records\n", result.Error, StringComparison.Ordinal);
        Assert.Contains($"compiled/{SecondChapter}: differs from fresh output", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TestRecordsCarriesNonAsciiTextThroughRedirectedStandardOutput()
    {
        using var work = new PayloadWorkspace(seed: false);
        await File.AppendAllTextAsync(Path.Combine(work.Content, "chapters", "fixture-second", "chapter.md"), "\nGrüße, 日本語, emoji \U0001F600.\n", Strict, TestContext.Current.CancellationToken);
        Assert.Equal(0, work.Run("update").Code);

        var (code, stdout, error) = await PayloadWorkspace.RunProcessAsync(work.Args("test-records"));

        Assert.True(code == 0, error);
        Assert.Empty(error);
        Assert.Contains(ParseEnvelope(stdout), r => Decoded(r.Text).Contains("Grüße, 日本語, emoji \U0001F600.", StringComparison.Ordinal));
    }

    [Fact]
    public async Task TestRecordsFailureInItsOwnProcessKeepsStandardOutputEmpty()
    {
        using var work = new PayloadWorkspace();
        File.Delete(Path.Combine(work.Generated, "content.ts"));

        var (code, stdout, error) = await PayloadWorkspace.RunProcessAsync(work.Args("test-records"));

        Assert.Equal(1, code);
        Assert.Empty(stdout);
        Assert.Contains("src/generated/content.ts: missing from the committed trees", error, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("bom", "chapter", "starts with a byte-order mark")]
    [InlineData("utf8", "chapter", "not UTF-8")]
    [InlineData("schema", "chapter", "schema: ")]
    [InlineData("good", "part", "schema: the record is not of type \"part\"")]
    [InlineData("good", "aliases", "schema: ")]
    [InlineData("good", "patterns", "schema: ")]
    [InlineData("good", null, "the manifest states no kind for it")]
    public void RecordsAreRefusedFromBadPayloadBytes(string change, string? kind, string expected)
    {
        var good = File.ReadAllBytes(Path.Combine(Repository.Root, "web", "compiled", SecondChapter));
        byte[] bytes = change switch
        {
            "bom" => [0xEF, 0xBB, 0xBF, .. good],
            "utf8" => [.. good[..^2], 0xFF, .. good[^2..]],
            "schema" => Strict.GetBytes("{\"type\":\"chapter\"}\n"),
            _ => good,
        };
        var committed = new Dictionary<string, byte[]>(StringComparer.Ordinal) { ["compiled/a.json"] = bytes };

        // A broken manifest states no kind at all.
        committed["compiled/manifest.json"] = kind is null
            ? [0xFF]
            : Payload.BuildManifest([new OutputFile("compiled/a.json", bytes, Enum.Parse<RecordKind>(kind, ignoreCase: true))]);

        var (envelope, problems) = TestRecords.Build(committed, Repository.Schema);

        Assert.Null(envelope);
        Assert.StartsWith("compiled/a.json: " + expected, Assert.Single(problems), StringComparison.Ordinal);
    }

    [Fact]
    public void EnvelopeWriterEmitsUtf8WithoutAByteOrderMark()
    {
        byte[] written = [];

        TestRecords.Write(() => new CapturingStream(b => written = b), "{\"text\":\"é\"}");

        Assert.Equal([.. "{\"text\":\""u8, 0xC3, 0xA9, .. "\"}"u8], written);
    }

    [Theory]
    [InlineData("valid", 0, "PASS content validate")]
    [InlineData("invalid", 1, "  standard input: schema: ")]
    [InlineData("bom", 1, "  standard input: starts with a byte-order mark")]
    [InlineData("utf8", 1, "  standard input: not UTF-8")]
    [InlineData("duplicate", 1, "  standard input: schema: not JSON without duplicate names")]
    public void ValidateReadsOneDocumentFromStandardInput(string input, int code, string expected)
    {
        var good = File.ReadAllBytes(Path.Combine(Repository.Root, "web", "compiled", SecondChapter));
        byte[] bytes = input switch
        {
            "valid" => good,
            "invalid" => Strict.GetBytes("{\"type\":\"chapter\"}"),
            "bom" => [0xEF, 0xBB, 0xBF, .. good],
            "utf8" => [0xFF],
            _ => Strict.GetBytes("{\"type\":\"chapter\",\"type\":\"part\"}"),
        };

        var result = PayloadWorkspace.Invoke(["validate", Repository.SchemaFolder], stdin: bytes);

        Assert.Equal(code, result.Code);
        Assert.Contains(expected, result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("validate")]
    [InlineData("compare")]
    [InlineData("test-records")]
    public void WrongArgumentsExitWithTwo(string mode)
    {
        Assert.Equal(2, PayloadWorkspace.Invoke([mode]).Code);
        Assert.Equal(2, PayloadWorkspace.Invoke([mode, "relative", "b", "c", "d", "e"]).Code);
    }

    private static byte[] Mutate(string text, string change)
    {
        var lines = text.Split('\n').ToList();
        var first = lines[3];
        var src = lines.FindIndex(l => l.Contains("\"src/", StringComparison.Ordinal));
        var zeros = new string('0', 64);
        if (KindChange(lines, src, change))
        {
            return Strict.GetBytes(string.Join('\n', lines));
        }

        switch (change)
        {
            case "self": lines.Insert(src, $"    {{ \"path\": \"compiled/manifest.json\", \"sha256\": \"{zeros}\" }},"); break;
            case "unsorted": (lines[3], lines[4]) = (lines[4], lines[3]); break;
            case "duplicate": lines.Insert(3, first); break;
            case "back-slash": lines[3] = first.Replace("compiled/", "compiled\\\\", StringComparison.Ordinal); break;
            case "dot-segment": lines[3] = first.Replace("compiled/", "compiled/./", StringComparison.Ordinal); break;
            case "no-file": lines.Insert(src, $"    {{ \"path\": \"compiled/zz.json\", \"kind\": \"part\", \"sha256\": \"{zeros}\" }},"); break;
            case "wrong-hash": lines[3] = first[..^68] + zeros + "\" },"; break;
            case "upper-hash": lines[3] = first[..^68] + first[^68..^4].ToUpperInvariant() + "\" },"; break;
            case "version": lines[1] = "  \"version\": 1,"; break;
            case "extra-key": lines.Insert(1, "  \"extra\": 1,"); break;
            case "entry-key": lines[3] = first.Replace(" },", ", \"size\": 1 },", StringComparison.Ordinal); break;
            case "duplicate-name": lines.Insert(1, "  \"version\": 2,"); break;
            case "bom": return [0xEF, 0xBB, 0xBF, .. Strict.GetBytes(text)];
            default: lines[^2] = "} "; break;
        }

        return Strict.GetBytes(string.Join('\n', lines));
    }

    // The first entry is the alias registry; the third is a chapter record.
    private static bool KindChange(List<string> lines, int src, string change)
    {
        const string Stated = "\"kind\": \"aliases\"";
        var first = lines[3];
        var before = string.Join('\n', lines);
        switch (change)
        {
            case "no-kind": lines[3] = first.Replace(" " + Stated + ",", string.Empty, StringComparison.Ordinal); break;
            case "unknown-kind": lines[3] = first.Replace(Stated, "\"kind\": \"registry\"", StringComparison.Ordinal); break;
            case "kind-in-capitals": lines[3] = first.Replace(Stated, "\"kind\": \"Aliases\"", StringComparison.Ordinal); break;
            case "kind-not-text": lines[3] = first.Replace(Stated, "\"kind\": 2", StringComparison.Ordinal); break;
            case "kind-on-generated": lines[src] = lines[src].Replace(", \"sha256\"", ", \"kind\": \"part\", \"sha256\"", StringComparison.Ordinal); break;
            case "relabelled": lines[5] = lines[5].Replace("\"kind\": \"chapter\"", Stated, StringComparison.Ordinal); break;
            default: return false;
        }

        Assert.NotEqual(before, string.Join('\n', lines), StringComparer.Ordinal);
        return true;
    }

    private static List<(string Path, string Text)> ParseEnvelope(byte[] stdout)
    {
        Assert.False(stdout.AsSpan().StartsWith((byte[])[0xEF, 0xBB, 0xBF]));
        using var envelope = JsonDocument.Parse(Strict.GetString(stdout));
        var root = envelope.RootElement;
        Assert.Equal(["version", "records"], Names(root), StringComparer.Ordinal);
        Assert.Equal(2, root.GetProperty("version").GetInt32());
        var records = new List<(string Path, string Text)>();
        using var items = root.GetProperty("records").EnumerateArray();
        foreach (var item in items)
        {
            Assert.Equal(["path", "kind", "text"], Names(item), StringComparer.Ordinal);
            records.Add((item.GetProperty("path").GetString()!, item.GetProperty("text").GetString()!));
        }

        Assert.Equal(records.Select(r => r.Path).Order(StringComparer.Ordinal), records.Select(r => r.Path), StringComparer.Ordinal);
        return records;
    }

    // The compiler escapes non-ASCII characters, so the payload text is searched by its string values.
    private static string Decoded(string json)
    {
        return string.Join('\n', Strings(JsonNode.Parse(json)));
    }

    private static IEnumerable<string> Strings(JsonNode? node) => node switch
    {
        JsonArray array => array.SelectMany(Strings),
        JsonObject members => members.SelectMany(p => Strings(p.Value)),
        JsonValue value when value.TryGetValue<string>(out var text) => [text],
        _ => [],
    };

    private static List<string> Names(JsonElement element)
    {
        using var properties = element.EnumerateObject();
        return [.. properties.Select(p => p.Name)];
    }
}
