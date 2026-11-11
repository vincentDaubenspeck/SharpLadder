using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <summary>
/// Witness emission: recorded layout, exact round trip of hostile strings, and refusal of every
/// key and value outside the admitted forms before anything is emitted.
/// </summary>
public sealed partial class WitnessTests
{
    private const string Header = "// SharpLadder.Content witness emitter output, grammar 1. Do not edit.";
    private const string Import = "import type { ContentDoc } from \"../../../content.ts\";";
    private const string Part = "chapters/fixture-basics/syntax.json";

    private static readonly JsonSerializerOptions Encoded = new() { Encoder = JavaScriptEncoder.Default };

    private static string Folder => Path.Combine(Repository.Root, "tools", "SharpLadder.Content.Tests", "fixtures", "witness");

    public static TheoryData<string> HostileStrings() =>
    [
        "say \"hi\"",
        "back\\slash",
        "cr\rlf\nboth\r\n",
        "tab\t, nul\u0000, bell\u0007",
        "caf\u00e9 \u4e2d\u6587 \ud83d\ude00",
        "line\u2028para\u2029",
        "${template}",
        "`backtick` and 'apostrophe'",
        "end */ start /*",
        "<script>alert(1)</script><!-- -->&amp;",
        "\\u0041 stays text",
        string.Empty,
    ];

    [Fact]
    public void StressFixtureEmitsTheRecordedModule()
    {
        var (text, problems) = Emit(File.ReadAllBytes(Path.Combine(Folder, "stress.json")));

        Assert.Empty(problems);
        Assert.Equal(File.ReadAllText(Path.Combine(Folder, "stress.ts.expected")), text);
    }

    [Fact]
    public void StressFixtureDecodesToTheSameValue()
    {
        var bytes = File.ReadAllBytes(Path.Combine(Folder, "stress.json"));

        var (text, _) = Emit(bytes);

        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(bytes), Decode(text!)));
    }

    [Fact]
    public void EveryCompiledFileRoundTripsThroughItsWitness()
    {
        var result = Repository.Compile(Repository.Fixture);
        Assert.Empty(result.Diagnostics);
        Assert.NotEmpty(result.Files);

        // A registry record has no witness: no browser code reads one yet.
        var content = result.Files.Where(f => f.Kind is RecordKind.Chapter or RecordKind.Part).ToList();
        Assert.Equal(result.Files.Count - 2, content.Count);
        foreach (var file in content)
        {
            var (text, problems) = WitnessEmitter.Emit(file.RelativePath, file.Bytes);

            Assert.Empty(problems);
            Assert.True(JsonNode.DeepEquals(JsonNode.Parse(file.Bytes), Decode(text!)), file.RelativePath);
        }
    }

    [Theory]
    [MemberData(nameof(HostileStrings))]
    public void HostileStringsAreEncodedAndDecodeExactly(string value)
    {
        var (text, problems) = Emit(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { type = value })));

        Assert.Empty(problems);
        var line = Assert.Single(text!.Split('\n'), l => l.StartsWith("  type: ", StringComparison.Ordinal));
        var literal = line["  type: ".Length..^1];
        Assert.Equal(JsonSerializer.Serialize(value, Encoded), literal);
        Assert.All(literal, c => Assert.InRange(c, ' ', '~'));
        Assert.DoesNotContain("<", literal, StringComparison.Ordinal);
        Assert.DoesNotContain("'", literal, StringComparison.Ordinal);
        Assert.DoesNotContain("`", literal, StringComparison.Ordinal);
        Assert.DoesNotContain("\"", literal[1..^1], StringComparison.Ordinal);
        Assert.Equal(value, JsonSerializer.Deserialize<string>(literal));
    }

    [Fact]
    public void ModuleHasTheFixedShape()
    {
        var (text, _) = Emit(Encoding.UTF8.GetBytes("""{"type":"part","order":-3,"done":false}"""));

        Assert.Equal(
            $"{Header}\n\n{Import}\n\nexport const witness = {{\n  type: \"part\",\n  order: -3,\n  done: false,\n}} satisfies ContentDoc;\n",
            text);
    }

    [Fact]
    public void EmissionIsDeterministic()
    {
        var bytes = File.ReadAllBytes(Path.Combine(Folder, "stress.json"));

        var (first, _) = Emit(bytes);
        var (second, _) = Emit(bytes);

        Assert.Equal(first, second);
        Assert.DoesNotContain('\r', first!);
        Assert.EndsWith(";\n", first, StringComparison.Ordinal);
        Assert.Single(ExportPattern().Matches(first!));
        Assert.Single(first!.Split('\n'), l => l.StartsWith("import ", StringComparison.Ordinal));
        Assert.Single(first!.Split('\n'), l => l.StartsWith("//", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("a.json", "witness/a.ts", "../content.ts")]
    [InlineData("chapters/a/b.json", "witness/chapters/a/b.ts", "../../../content.ts")]
    public void ModulePathAndImportFollowTheCompiledPath(string compiled, string module, string specifier)
    {
        var (text, _) = WitnessEmitter.Emit(compiled, Encoding.UTF8.GetBytes("""{"type":"part"}"""));

        Assert.Equal(module, WitnessEmitter.ModulePath(compiled));
        Assert.Contains($"import type {{ ContentDoc }} from \"{specifier}\";\n", text, StringComparison.Ordinal);
    }

    [Fact]
    public void ModulePathRefusesANonJsonPath() =>
        Assert.Throws<ArgumentException>(() => WitnessEmitter.ModulePath("chapters/a/b.ts"));

    [Fact]
    public void ImportTooLongForOneLineIsRefused()
    {
        var deep = string.Concat(Enumerable.Repeat("d/", 12)) + "x.json";

        var (text, problems) = WitnessEmitter.Emit(deep, Encoding.UTF8.GetBytes("""{"type":"part"}"""));

        Assert.Null(text);
        Assert.Contains("too deep for a one-line type import", Assert.Single(problems), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"__proto__":{"type":"x"}}""", "#: key \"__proto__\"")]
    [InlineData("""{"a":{"\u005f_proto__":1}}""", "#/a: key \"__proto__\"")]
    [InlineData("""{"constructor-x":1}""", "#: key \"constructor-x\"")]
    [InlineData("""{"Type":1}""", "#: key \"Type\"")]
    [InlineData("""{"a b":1}""", "#: key \"a b\"")]
    [InlineData("""{"":1}""", "#: key \"\"")]
    [InlineData("""{"$x":1}""", "#: key \"$x\"")]
    [InlineData("""{"1a":1}""", "#: key \"1a\"")]
    [InlineData("""{"\"":1}""", "#: key \"\\u0022\"")]
    [InlineData("""{"caf\u00e9":1}""", "#: key \"caf\\u00E9\"")]
    [InlineData("""{"a\n":1}""", "#: key \"a\\n\"")]
    [InlineData("""{"a":[{"b":{"c-d":1}}]}""", "#/a/0/b: key \"c-d\"")]
    [InlineData("""{"keyOfFortyNineCharactersXxxxxxxxxxxxxxxxxxxxxxxxx":1}""", "#: key \"keyOfFortyNineCharactersXxxxxxxxxxxxxxxxxxxxxxxxx\"")]
    public void ForbiddenKeysAreRefusedBeforeEmission(string json, string expected) =>
        AssertRefused(json, expected);

    [Theory]
    [InlineData("""{"a":null}""", "#/a: null is not an admitted witness value")]
    [InlineData("""{"a":[1,null]}""", "#/a/1: null is not an admitted witness value")]
    [InlineData("""{"a":{"b":[[null]]}}""", "#/a/b/0/0: null is not an admitted witness value")]
    [InlineData("""{"a":1.5}""", "#/a: a number must be an integer token")]
    [InlineData("""{"a":1e2}""", "#/a: a number must be an integer token")]
    [InlineData("""{"a":1E2}""", "#/a: a number must be an integer token")]
    [InlineData("""{"a":1.0}""", "#/a: a number must be an integer token")]
    [InlineData("""{"a":-0}""", "#/a: a number must be an integer token")]
    [InlineData("""{"a":9007199254740992}""", "#/a: a number must be an integer token")]
    [InlineData("""{"a":-9007199254740992}""", "#/a: a number must be an integer token")]
    [InlineData("""{"a":[0,0.1]}""", "#/a/1: a number must be an integer token")]
    public void ValuesOutsideTheAdmittedFormsAreRefused(string json, string expected) =>
        AssertRefused(json, expected);

    [Theory]
    [InlineData("""[{"type":"part"}]""", "#: the witness value must be a JSON object")]
    [InlineData("\"part\"", "#: the witness value must be a JSON object")]
    [InlineData("1", "#: the witness value must be a JSON object")]
    [InlineData("true", "#: the witness value must be a JSON object")]
    [InlineData("null", "#: null is not an admitted witness value")]
    [InlineData("""{"type":1,"\u0074ype":2}""", "#: not UTF-8 JSON without duplicate names")]
    [InlineData("""{"a":{"b":{"c":1,"c":2}}}""", "#: not UTF-8 JSON without duplicate names")]
    [InlineData("""{"a":1""", "#: not UTF-8 JSON without duplicate names")]
    [InlineData("""{"a":1} {"b":2}""", "#: not UTF-8 JSON without duplicate names")]
    [InlineData("", "#: not UTF-8 JSON without duplicate names")]
    public void DocumentsOutsideTheGrammarAreRefused(string json, string expected) =>
        AssertRefused(json, expected);

    [Theory]
    [InlineData("{\"type\":\"part\"}\r\n")]
    [InlineData("{\r\"type\":\"part\"}")]
    public void CarriageReturnIsRefused(string json)
    {
        var (text, problems) = Emit(Encoding.UTF8.GetBytes(json));

        Assert.Null(text);
        Assert.Equal($"{Part}#: holds a carriage return (CR)", Assert.Single(problems));
    }

    [Fact]
    public void ByteOrderMarkIsRefused()
    {
        var (text, problems) = Emit([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("""{"type":"part"}""")]);

        Assert.Null(text);
        Assert.Equal($"{Part}#: starts with a byte order mark", Assert.Single(problems));
    }

    [Fact]
    public void MalformedUtf8IsRefused()
    {
        var (text, problems) = Emit([.. Encoding.UTF8.GetBytes("""{"type":"pa"""), 0xC3, 0x28, .. Encoding.UTF8.GetBytes("\"}")]);

        Assert.Null(text);
        Assert.StartsWith($"{Part}#: not UTF-8 JSON without duplicate names", Assert.Single(problems), StringComparison.Ordinal);
    }

    private static (string? Text, IReadOnlyList<string> Problems) Emit(byte[] bytes) => WitnessEmitter.Emit(Part, bytes);

    private static void AssertRefused(string json, string expected)
    {
        var (text, problems) = Emit(Encoding.UTF8.GetBytes(json));

        Assert.Null(text);
        Assert.StartsWith(Part + expected, Assert.Single(problems), StringComparison.Ordinal);
    }

    // Reads the emitted literal back as JSON: keys quoted, trailing commas dropped. Strings never
    // span lines, so the line-wise edits cannot reach inside one.
    private static JsonNode? Decode(string text)
    {
        var start = text.IndexOf("export const witness = ", StringComparison.Ordinal) + "export const witness = ".Length;
        var end = text.LastIndexOf(" satisfies ContentDoc;", StringComparison.Ordinal);
        var lines = text[start..end].Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            lines[i] = KeyPattern().Replace(lines[i], "${pad}\"${key}\":");
            var next = i + 1 < lines.Length ? lines[i + 1].TrimStart() : string.Empty;
            if (lines[i].EndsWith(',') && (next.StartsWith(']') || next.StartsWith('}')))
            {
                lines[i] = lines[i][..^1];
            }
        }

        return JsonNode.Parse(string.Join('\n', lines));
    }

    [GeneratedRegex(@"^(?<pad>\s*)(?<key>[a-z][A-Za-z0-9]*):(?= |$)", RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture, matchTimeoutMilliseconds: 1000)]
    private static partial Regex KeyPattern();

    [GeneratedRegex("^export ", RegexOptions.Multiline | RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex ExportPattern();
}
