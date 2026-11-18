using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Text that is not Unicode (a lone surrogate, or a pair in the wrong order) reaches the one shared
// schema check through validate and through the alias retention read, and each must refuse it the
// ordinary way. Forms are named rather than given as theory data, which would replace a lone
// surrogate.
public sealed class SurrogateTests
{
    private const string NotUnicode = "schema: a name or string that is not Unicode text: ";
    private const string Chapter = "chapters/fixture-basics/chapter.json";
    private const string Mark = "surrogate-mark";
    private const string Empty = """{"slugs":{},"ids":{}}""";
    private static readonly UTF8Encoding Strict = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // No keyword of this alias schema reads a name or an end, so only the shared check sees them.
    private static readonly Lazy<SchemaSet> Widened = new(() =>
    {
        using var folder = new TempFolder();
        foreach (var file in Directory.EnumerateFiles(Repository.SchemaFolder))
        {
            File.Copy(file, Path.Combine(folder.Path, Path.GetFileName(file)));
        }

        File.WriteAllText(Path.Combine(folder.Path, "aliases.schema.json"), """
            {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "$id": "https://sharpladder.com/schema/aliases.schema.json",
                "type": "object",
                "additionalProperties": false,
                "required": ["slugs", "ids"],
                "properties": {
                    "slugs": { "type": "object", "additionalProperties": { "type": "string" } },
                    "ids": { "type": "object", "additionalProperties": { "type": "string" } }
                }
            }
            """);
        var (set, problems) = SchemaSet.Load(folder.Path);
        Assert.Empty(problems);
        return set!;
    });

    // Each form and each place once: title is read by minLength, source is a string no keyword
    // reads, and name is a property name.
    public static TheoryData<string, string> Broken => new() { { "high", "title" }, { "low", "source" }, { "reversed", "name" } };

    public static TheoryData<string, string> BrokenAlias => new() { { "high", "name" }, { "low", "end" }, { "reversed", "end" } };

    public static TheoryData<string> AliasPlaces => new(["name", "end"]);

    [Theory]
    [MemberData(nameof(Broken))]
    public void ValidateRefusesEscapedTextThatIsNotUnicode(string form, string place)
    {
        var result = PayloadWorkspace.Invoke(["validate", Repository.SchemaFolder], stdin: ChapterWith(place, Ascii(Escaped(form))));

        Assert.Equal(1, result.Code);
        Assert.StartsWith("  standard input: " + NotUnicode, result.Output, StringComparison.Ordinal);
        Assert.EndsWith("FAIL content validate\n", result.Output, StringComparison.Ordinal);
    }

    // Strict decoding refuses any encoded surrogate before reading JSON, so one form stands for all.
    [Theory]
    [InlineData("high", "title")]
    public void ValidateRefusesRawBytesThatAreNotUtf8(string form, string place)
    {
        var result = PayloadWorkspace.Invoke(["validate", Repository.SchemaFolder], stdin: ChapterWith(place, Raw(form)));

        Assert.Equal(1, result.Code);
        Assert.StartsWith("  standard input: not UTF-8", result.Output, StringComparison.Ordinal);
    }

    // A chapter admits no extra property, so a pair in a name meets the ordinary refusal.
    [Theory]
    [InlineData("title", true)]
    [InlineData("name", false)]
    public void ValidateReadsAPairAsOneCharacter(string place, bool accepted)
    {
        foreach (var bytes in new[] { ChapterWith(place, Ascii(Escaped("pair"))), ChapterWith(place, Raw("pair")) })
        {
            var result = PayloadWorkspace.Invoke(["validate", Repository.SchemaFolder], stdin: bytes);

            Assert.Equal(accepted ? 0 : 1, result.Code);
            Assert.DoesNotContain("not Unicode", result.Output, StringComparison.Ordinal);
            Assert.EndsWith((accepted ? "PASS" : "FAIL") + " content validate\n", result.Output, StringComparison.Ordinal);
        }
    }

    // Strings in memory can hold what no UTF-8 input can, and the shared check refuses that too.
    [Theory]
    [MemberData(nameof(Broken))]
    public void SchemaSetRefusesAStringHoldingALoneSurrogate(string form, string place)
    {
        var text = Strict.GetString(ChapterWith(place, []));

        var broken = Repository.Schema.Validate(text.Replace(Mark, Held(form), StringComparison.Ordinal));
        var pair = Repository.Schema.Validate(text.Replace(Mark, Held("pair"), StringComparison.Ordinal));

        Assert.StartsWith(NotUnicode["schema: ".Length..], broken, StringComparison.Ordinal);
        Assert.Equal(!IsName(place), pair is null);
        Assert.DoesNotContain("not Unicode", pair ?? string.Empty, StringComparison.Ordinal);
    }

    // A kind's own type check reads the type value before the schema does.
    [Theory]
    [InlineData("high")]
    public void KindCheckRefusesATypeThatIsNotUnicode(string form)
    {
        var refusal = Repository.Schema.Validate("{\"type\":\"chapter" + Escaped(form) + "\"}", RecordKind.Chapter);

        Assert.StartsWith(NotUnicode["schema: ".Length..], refusal, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(BrokenAlias))]
    public void RetentionReadRefusesEscapedTextThatIsNotUnicode(string form, string place)
    {
        foreach (var schema in new[] { Repository.Schema, Widened.Value })
        {
            var (record, refusal) = Retention.Read(AliasWith(place, Ascii(Escaped(form))), schema);

            Assert.Null(record);
            Assert.StartsWith(NotUnicode, refusal, StringComparison.Ordinal);
        }
    }

    // Strict decoding refuses any encoded surrogate before reading JSON, so one form stands for all.
    [Theory]
    [InlineData("high", "name")]
    public void RetentionReadRefusesRawBytesThatAreNotUtf8(string form, string place)
    {
        var (record, refusal) = Retention.Read(AliasWith(place, Raw(form)), Repository.Schema);

        Assert.Null(record);
        Assert.StartsWith("not UTF-8", refusal, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(BrokenAlias))]
    public void RetainRefusesAnEarlierRecordThatIsNotUnicode(string form, string place)
    {
        using var folder = new TempFolder();
        File.WriteAllBytes(Path.Combine(folder.Path, "aliases.json"), Strict.GetBytes(Empty));

        var result = PayloadWorkspace.Invoke(["retain", Repository.SchemaFolder, folder.Path], stdin: AliasWith(place, Ascii(Escaped(form))));

        Assert.Equal(1, result.Code);
        Assert.StartsWith("  standard input: " + NotUnicode, result.Output, StringComparison.Ordinal);
        Assert.EndsWith("FAIL content retain\n", result.Output, StringComparison.Ordinal);
    }

    // Alias names are ASCII, so the committed schema refuses a pair the ordinary way; a schema that
    // reads no alias text shows the pair itself is accepted.
    [Theory]
    [MemberData(nameof(AliasPlaces))]
    public void RetentionReadReadsAPairAsOneCharacter(string place)
    {
        foreach (var bytes in new[] { AliasWith(place, Ascii(Escaped("pair"))), AliasWith(place, Raw("pair")) })
        {
            var (refused, ordinary) = Retention.Read(bytes, Repository.Schema);
            var (record, refusal) = Retention.Read(bytes, Widened.Value);

            Assert.Null(refused);
            Assert.StartsWith("schema: ", ordinary, StringComparison.Ordinal);
            Assert.DoesNotContain("not Unicode", ordinary, StringComparison.Ordinal);
            Assert.Null(refusal);
            var slugs = record!["slugs"]!.AsObject();
            Assert.Equal(IsName(place) ? Held("pair") : "a", slugs.Single().Key);
            Assert.Equal(IsName(place) ? "b" : Held("pair"), slugs.Single().Value!.GetValue<string>());
        }
    }

    private static string Escaped(string form) => form switch
    {
        "high" => "a\\uD800b",
        "low" => "a\\uDC00b",
        "reversed" => "a\\uDC00\\uD800b",
        _ => "a\\uD83D\\uDE00b",
    };

    private static string Held(string form) => form switch
    {
        "high" => "a" + (char)0xD800 + "b",
        "low" => "a" + (char)0xDC00 + "b",
        "reversed" => "a" + (char)0xDC00 + (char)0xD800 + "b",
        _ => "a😀b",
    };

    // Lone surrogates written the way UTF-8 would write any other scalar, which UTF-8 forbids.
    private static byte[] Raw(string form) => form switch
    {
        "high" => [(byte)'a', 0xED, 0xA0, 0x80, (byte)'b'],
        "low" => [(byte)'a', 0xED, 0xB0, 0x80, (byte)'b'],
        "reversed" => [(byte)'a', 0xED, 0xB0, 0x80, 0xED, 0xA0, 0x80, (byte)'b'],
        _ => [(byte)'a', 0xF0, 0x9F, 0x98, 0x80, (byte)'b'],
    };

    private static byte[] Ascii(string text) => Encoding.ASCII.GetBytes(text);

    // The chapter fixture with the text in the title, in a text block's source, or as the name
    // of an extra property; empty text leaves the mark in place.
    private static byte[] ChapterWith(string place, byte[] text)
    {
        var chapter = JsonNode.Parse(File.ReadAllText(Path.Combine(Repository.Root, "web", "compiled", Chapter)))!.AsObject();
        switch (place)
        {
            case "title":
                chapter["title"] = Mark;
                break;
            case "source":
                var block = chapter["sections"]!.AsArray().SelectMany(s => s!["body"]!.AsArray()).First(b => b!["source"] is not null)!.AsObject();
                block["source"] = Mark;
                break;
            default:
                chapter[Mark] = "b";
                break;
        }

        return text.Length == 0 ? Strict.GetBytes(chapter.ToJsonString()) : Insert(chapter.ToJsonString(), text);
    }

    private static byte[] AliasWith(string place, byte[] text) =>
        Insert("{\"slugs\":{" + (IsName(place) ? $"\"{Mark}\":\"b\"" : $"\"a\":\"{Mark}\"") + "},\"ids\":{}}", text);

    private static bool IsName(string place) => string.Equals(place, "name", StringComparison.Ordinal);

    private static byte[] Insert(string json, byte[] text)
    {
        var at = json.IndexOf(Mark, StringComparison.Ordinal);
        Assert.Equal(at, json.LastIndexOf(Mark, StringComparison.Ordinal));
        return [.. Strict.GetBytes(json[..at]), .. text, .. Strict.GetBytes(json[(at + Mark.Length)..])];
    }
}
