using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <summary>
/// The walk-it source form: a fence of one closed YAML document, read by position and scalar style
/// into the block the body schema defines. Each refusal is the accepted form with one change.
/// </summary>
public sealed partial class WalkItSourceTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n\n";
    private const string Part = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## Title {#syn-a}\n\nText.\n";
    private const string Info = "walk-it {#walk-shift}";
    private const string Path = "chapters/c/chapter.md:";
    private const string Pair = "walk-it cell escapes a surrogate code point, which is not a character; write the character itself";
    private const string Literal = "{ dst: 0, value: 1, note: Write. }";
    private const string Ten = "[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]";

    private const string Accepted = """
        title: Shift *right*
        cells: [4, "ab", null]
        sequences:
            -   name: safe
                intro: Copy before writing.
                steps:
                    - { dst: 2, src: 1, note: Copy. }
                    - { dst: 1, value: 42, note: Write., lost: true }
                    -   dst: 0
                        value: 'x'
                        note: "`x` is text."
            -   name: wrong
                intro: Write first.
                steps:
                    - { dst: 1, src: 0, note: Copy over., lost: true }
        """;

    [Fact]
    public void TheDocumentBecomesTheTypedBlockWithItsHooks()
    {
        var block = Block(Accepted);

        Assert.Equal(
            """{"type":"walk-it","blockId":"intro/b2","id":"walk-shift","title":[{"type":"text","text":"Shift "},{"type":"em","content":[{"type":"text","text":"right"}]}],"cells":[4,"ab",null],"sequences":[{"name":"safe","introBlockId":"intro/b2.1.s0","intro":[{"type":"text","text":"Copy before writing."}],"steps":[{"blockId":"intro/b2.1.s1","dst":2,"src":1,"note":[{"type":"text","text":"Copy."}]},{"blockId":"intro/b2.1.s2","dst":1,"value":42,"note":[{"type":"text","text":"Write."}],"lost":true},{"blockId":"intro/b2.1.s3","dst":0,"value":"x","note":[{"type":"code","text":"x"},{"type":"text","text":" is text."}]}]},{"name":"wrong","introBlockId":"intro/b2.2.s0","intro":[{"type":"text","text":"Write first."}],"steps":[{"blockId":"intro/b2.2.s1","dst":1,"src":0,"note":[{"type":"text","text":"Copy over."}],"lost":true}]}]}""",
            block.ToJsonString());
    }

    [Fact]
    public void EveryLimitIsReachedAndEachHookIsItsOwnPosition()
    {
        var steps = string.Concat(Enumerable.Range(1, 8).Select(k => $"\n      - {{ dst: {k}, src: 0, note: Step {k}. }}"));
        var sequences = string.Concat(Enumerable.Range(1, 4).Select(s => $"\n  - name: s{s}\n    intro: Intro {s}.\n    steps:{steps}"));

        var block = Block("title: Full\ncells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]\nsequences:" + sequences);

        var hooks = block["sequences"]!.AsArray().Select(s => (string)s!["introBlockId"]! + " " + string.Join(' ', s["steps"]!.AsArray().Select(t => (string)t!["blockId"]!)));
        Assert.Equal(
            string.Join('|', Enumerable.Range(1, 4).Select(s => $"intro/b2.{s}.s0 " + string.Join(' ', Enumerable.Range(1, 8).Select(k => $"intro/b2.{s}.s{k}")))),
            string.Join('|', hooks));
        Assert.Equal(10, block["cells"]!.AsArray().Count);
    }

    [Theory]
    [InlineData("[null]", "[null]")]
    [InlineData("[0, 7, -7]", "[0,7,-7]")]
    [InlineData("[-0]", "[0]")]
    [InlineData("[9007199254740991, -9007199254740991]", "[9007199254740991,-9007199254740991]")]
    [InlineData("[\"null\", 'null', \"12\", '12', \"true\", 'true']", "[\"null\",\"null\",\"12\",\"12\",\"true\",\"true\"]")]
    [InlineData("[\"~\", '', \"\", \"abcdefghijkl\"]", "[\"~\",\"\",\"\",\"abcdefghijkl\"]")]
    [InlineData("['\\u0041', \"\\u0041\"]", "[\"\\\\u0041\",\"A\"]")]
    [InlineData("\n  - null\n  - 3\n  - \"c\"", "[null,3,\"c\"]")]
    public void ACellIsTypedByItsStyleAlone(string cells, string expected) =>
        Assert.Equal(expected, Block(Walk(cells: cells, step: Literal))["cells"]!.ToJsonString());

    [Fact]
    public void ACellCountsUnicodeScalarsNotCodeUnits()
    {
        var twelve = string.Concat(Enumerable.Repeat("\\U0001F600", 12));

        Assert.Equal(string.Concat(Enumerable.Repeat("\U0001F600", 12)), (string)Block(Walk(cells: $"[\"{twelve}\"]", step: Literal))["cells"]![0]!);
        Refused(Walk(cells: $"[\"{twelve}a\"]"), Path + "13: walk-it cell \"");
    }

    [Theory]
    [InlineData("[~]", "13: walk-it cell \"~\" is not an integer, null or quoted text")]
    [InlineData("\n  -\n  - 1", "14: walk-it cell \"\" is not an integer, null or quoted text")]
    [InlineData("[9007199254740992]", "13: walk-it cell 9007199254740992 is outside -9007199254740991 to 9007199254740991")]
    [InlineData("[-9007199254740992]", "13: walk-it cell -9007199254740992 is outside -9007199254740991 to 9007199254740991")]
    [InlineData("[123456789012345678901234567890]", "13: walk-it cell 123456789012345678901234567890 is outside")]
    [InlineData("[007]", "13: walk-it cell \"007\" is not an integer")]
    [InlineData("[+1]", "13: walk-it cell \"\\u002B1\" is not an integer")]
    [InlineData("[0x1F]", "13: walk-it cell \"0x1F\" is not an integer")]
    [InlineData("[true]", "13: walk-it cell \"true\" is not an integer")]
    [InlineData("[abc]", "13: walk-it cell \"abc\" is not an integer")]
    [InlineData("[\"abcdefghijklm\"]", "13: walk-it cell \"abcdefghijklm\" is text of at most 12 characters with no control character")]
    [InlineData("[\"a\\a\"]", "13: walk-it cell \"a\\u0007\" is text of at most 12 characters")]
    [InlineData("\n  - |\n    abc", "14: walk-it cell is written as a block scalar (| or >)")]
    [InlineData("[&a 1]", "13: walk-it cell carries an anchor (&name), which is not accepted")]
    [InlineData("[*a]", "13: walk-it cell is an alias (*name), which is not accepted")]
    [InlineData("[!!int 1]", "13: walk-it cell carries a tag (!name), which is not accepted")]
    [InlineData("[! 1]", "13: walk-it cell carries a tag (!name), which is not accepted")]
    [InlineData("[[1]]", "13: walk-it cell is a single value, not a list or a mapping")]
    [InlineData("4", "13: walk-it cells is a list of 1 to 10")]
    [InlineData("!!seq [4]", "13: walk-it cells carries a tag (!name)")]
    [InlineData("&c [4]", "13: walk-it cells carries an anchor (&name)")]
    public void ACellIsRefusedInAnyOtherForm(string cells, string expected) =>
        Refused(Walk(cells: cells), Path + expected);

    [Theory]
    [InlineData("\"\\uD800\"", "walk-it block is not valid YAML: ")]
    [InlineData("\"\\uDC00\"", "walk-it block is not valid YAML: ")]
    [InlineData("\"\\uDE00\\uD83D\"", "walk-it block is not valid YAML: its structure could not be read here")]
    [InlineData("\"\\U0000D800\"", "walk-it block is not valid YAML: ")]
    [InlineData("\"\\U00110000\"", "walk-it block is not valid YAML: ")]
    [InlineData("\"\\uD83D\\uDE00\"", Pair)]
    [InlineData("\"\\\\\\uD83D\\uDE00\"", Pair)]
    public void AnEscapedSurrogateIsAnOrdinaryRefusal(string cell, string expected)
    {
        var result = Run(Walk(cells: $"[{cell}]"));

        Assert.StartsWith(Path + "13: " + expected, Assert.Single(result.Diagnostics).ToString(), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    [Theory]
    [InlineData("[\"\\\\uD83D\"]", "[\"\\\\uD83D\"]")]
    [InlineData("['\\uD83D']", "[\"\\\\uD83D\"]")]
    [InlineData("[\"\\U0001F600\"]", "[\"\\uD83D\\uDE00\"]")]
    public void OnlyAnEscapeNamingASurrogateIsRefused(string cells, string expected) =>
        Assert.Equal(expected, Block(Walk(cells: cells, step: Literal))["cells"]!.ToJsonString());

    // Characters outside the BMP earlier in the document must not move the escape check off its
    // scalar, or the pair below would be read from the title line and pass.
    [Fact]
    public void TheEscapeCheckReadsTheScalarItself()
    {
        var title = "title: " + string.Concat(Enumerable.Repeat("\U0001F600", 30));

        Refused(Walk(cells: "[\"\\uD83D\\uDE00\"]").Replace("title: Shift", title, StringComparison.Ordinal), Path + "13: " + Pair);
    }

    [Theory]
    [InlineData("42", "42")]
    [InlineData("\"null\"", "\"null\"")]
    public void AWrittenValueIsTypedLikeACell(string value, string expected) =>
        Assert.Equal(expected, Block(Walk(step: $"{{ dst: 0, value: {value}, note: Write. }}"))["sequences"]![0]!["steps"]![0]!["value"]!.ToJsonString());

    [Theory]
    [InlineData("null", "walk-it value \"null\" is not an integer or quoted text")]
    public void AWrittenValueIsRefusedInAnyOtherForm(string value, string expected) =>
        Refused(Walk(step: $"{{ dst: 0, value: {value}, note: Write. }}"), Path + "18: " + expected);

    [Theory]
    [InlineData("|\n          x", "walk-it value is written as a block scalar (| or >)")]
    public void AWrittenValueInBlockStyleIsHeldToTheSameRules(string value, string expected) =>
        Refused(Walk(step: "dst: 0\n        note: Write.\n        value: " + value), Path + "20: " + expected);

    [Theory]
    [InlineData("\"true\"")]
    [InlineData("True")]
    [InlineData("yes")]
    [InlineData("false")]
    public void LostIsOnlyThePlainWordTrue(string lost) =>
        Refused(Walk(step: $"{{ dst: 2, src: 1, note: Copy., lost: {lost} }}"), Path + "18: walk-it lost ");

    [Theory]
    [InlineData("!!bool true", "walk-it lost carries a tag")]
    [InlineData("&l true", "walk-it lost carries an anchor")]
    [InlineData("", "walk-it lost \"\" is written as plain true, or the key is left out")]
    public void LostTakesNoMarkingAndIsNeverEmpty(string lost, string expected) =>
        Refused(Walk(step: $"{{ dst: 2, src: 1, note: Copy., lost: {lost} }}"), Path + "18: " + expected);

    [Theory]
    [InlineData("dst: 0, src: 9", 0, 9)]
    [InlineData("dst: 9, src: -0", 9, 0)]
    public void AnIndexIsAPlainIntegerFromZeroToNine(string indices, int dst, int src)
    {
        var step = Block(Walk(cells: Ten, step: $"{{ {indices}, note: Copy. }}"))["sequences"]![0]!["steps"]![0]!;

        Assert.Equal(dst, (int)step["dst"]!);
        Assert.Equal(src, (int)step["src"]!);
    }

    [Theory]
    [InlineData("dst", "\"1\"", "walk-it dst \"1\" is a cell index, written as a plain integer without quotes")]
    [InlineData("dst", "01", "walk-it dst \"01\" is a cell index")]
    [InlineData("src", "99999999999999999999", "walk-it src \"99999999999999999999\" is a cell index")]
    [InlineData("dst", "10", "walk-it dst 10 is outside 0 to 9")]
    [InlineData("src", "-1", "walk-it src -1 is outside 0 to 9")]
    public void AnIndexIsRefusedInAnyOtherForm(string key, string index, string expected)
    {
        var step = string.Equals(key, "dst", StringComparison.Ordinal) ? $"{{ dst: {index}, src: 1, note: Copy. }}" : $"{{ dst: 2, src: {index}, note: Copy. }}";

        Refused(Walk(step: step), Path + "18: " + expected);
    }

    [Theory]
    [InlineData("{ dst: 2, src: 1, value: 3, note: Both. }", "18: a walk-it step copies with src or writes with value, exactly one of them")]
    [InlineData("{ dst: 2, note: Neither. }", "18: a walk-it step copies with src or writes with value, exactly one of them")]
    [InlineData("{ src: 1, note: Copy. }", "18: a walk-it step has no dst")]
    [InlineData("{ dst: 2, src: 1, note: Copy., extra: 1 }", "18: unknown key \"extra\" in a walk-it step; its keys are dst, src, value, note, lost")]
    [InlineData("{ dst: 2, src: 1, note: Copy., dst: 3 }", "18: duplicate key \"dst\" in a walk-it step")]
    [InlineData("{ dst: 2, src: 1, note: Copy., <<: { lost: true } }", "18: the merge key (<<) is not accepted")]
    [InlineData("{ dst: 2, src: 1, \"note\": Copy. }", "18: walk-it key \"note\" is written plain, without quotes")]
    [InlineData("{ dst: 2, src: 1, &k note: Copy. }", "18: a walk-it key carries an anchor")]
    [InlineData("{ dst: 2, src: 1, ? [note] : Copy. }", "18: a walk-it key is plain text, not a list or a mapping")]
    [InlineData("&s { dst: 2, src: 1, note: Copy. }", "18: a walk-it step carries an anchor")]
    [InlineData("[2, 1]", "18: a walk-it step is a mapping of dst, src, value, note, lost")]
    public void AStepIsAClosedMapping(string step, string expected) =>
        Refused(Walk(step: step), Path + expected);

    [Theory]
    [InlineData("  - name: safe\n    intro: Copy first.\n    steps: [{ dst: 2, src: 1, note: Copy. }]\n    extra: 1\n", "22: unknown key \"extra\" in a walk-it sequence; its keys are name, intro, steps")]
    [InlineData("  - name: safe\n    steps: [{ dst: 2, src: 1, note: Copy. }]\n", "19: a walk-it sequence has no intro")]
    [InlineData("  - name: \"\"\n    intro: Copy first.\n    steps: [{ dst: 2, src: 1, note: Copy. }]\n", "19: walk-it sequence name is empty")]
    [InlineData("  - name\n", "19: a walk-it sequence is a mapping of name, intro, steps")]
    public void ASequenceIsAClosedMapping(string extra, string expected) =>
        Refused(Walk(more: extra), Path + expected);

    [Theory]
    [InlineData("extra: 1\n", "19: unknown key \"extra\" in the walk-it block; its keys are title, cells, sequences")]
    [InlineData("...\n", "19: walk-it block takes no document end marker (...)")]
    [InlineData("---\ntitle: Second\n", "19: walk-it block holds one YAML document; a second is not accepted")]
    public void TheRootIsAClosedMappingInOneDocument(string tail, string expected) =>
        Refused(Walk() + tail, Path + expected);

    [Theory]
    [InlineData("---\n", "12: walk-it block takes no document marker (---) or directive")]
    [InlineData("%YAML 1.2\n---\n", "12: walk-it block takes no document marker (---) or directive")]
    [InlineData("!!map\n", "12: the walk-it block carries a tag")]
    public void TheDocumentTakesNoMarkerDirectiveOrNodeProperty(string head, string expected) =>
        Refused(head + Walk(), Path + expected);

    [Theory]
    [InlineData("", "12: walk-it block holds no YAML document")]
    [InlineData("- title: x", "12: the walk-it block is a mapping of title, cells, sequences")]
    [InlineData("title: x\ncells: [1]", "12: the walk-it block has no sequences")]
    [InlineData("{ title: x", ": walk-it block is not valid YAML: ")]
    public void AnythingButOneMappingIsRefused(string document, string expected) =>
        Refused(document, expected.StartsWith(':') ? expected : Path + expected);

    // The parser guards these states with a runtime error rather than a YAML error: the first in
    // its document start, the second in a plain scalar inside a flow list.
    [Theory]
    [InlineData("...\n]", "12: walk-it block is not valid YAML: its structure could not be read here")]
    [InlineData("cells: [@\n\n\"", "12: walk-it block is not valid YAML: its structure could not be read here")]
    public void AParserStateErrorIsAnOrdinaryRefusal(string document, string expected) =>
        Refused(document, Path + expected);

    // The parser's tag constructor rejects this global tag with a runtime argument error.
    [Fact]
    public void AParserArgumentErrorIsAnOrdinaryRefusal()
    {
        var result = Run("cells: [!![\n#");

        Assert.Equal(Path + "12: walk-it block is not valid YAML: its structure could not be read here", Assert.Single(result.Diagnostics).ToString());
        Assert.DoesNotContain("escape", Shown(result), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    [Theory]
    [InlineData("walk-it")]
    [InlineData("walk-it {#walk-shift} more")]
    [InlineData("walk-it {#walk-shift .wide}")]
    [InlineData("walk-it {#walk-shift #walk-other}")]
    [InlineData("walk-it {#walk-shift}{#walk-other}")]
    [InlineData("walk-it {#shift}")]
    [InlineData("walk-it {#walk-}")]
    [InlineData("walk-it {#walk-Shift}")]
    public void TheInfoStringIsWalkItAndOneWalkId(string info)
    {
        var result = Run(Walk(), info);

        Assert.Contains(Path + "11: a walk-it fence takes one {#id} that starts with walk- and nothing else", Shown(result), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    // Alias keys follow the general id grammar, so the bare prefix this fence refuses may be retired.
    [Fact]
    public void TheBareWalkPrefixMayBeRetiredToAWalkId()
    {
        var result = Site(("aliases.yml", "slugs: {}\nids:\n  walk-: walk-shift\n"));

        Assert.Empty(result.Diagnostics);
        var record = JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, Registries.AliasesOutput, StringComparison.Ordinal)).Bytes)!;
        Assert.Equal("""{"walk-":"walk-shift"}""", record["ids"]!.ToJsonString());
    }

    [Theory]
    [InlineData("Walk-it {#walk-shift}", "code fence language must be csharp or text")]
    [InlineData("walk-its {#walk-shift}", "code fence language must be csharp or text")]
    public void AnotherLanguageIsNotAWalkIt(string info, string expected) =>
        Assert.Contains(Path + "11: " + expected, Shown(Run(Walk(), info)), StringComparison.Ordinal);

    [Theory]
    [InlineData("title: null", "[{\"type\":\"text\",\"text\":\"null\"}]")]
    [InlineData("title: 'a *b*'", "[{\"type\":\"text\",\"text\":\"a \"},{\"type\":\"em\",\"content\":[{\"type\":\"text\",\"text\":\"b\"}]}]")]
    [InlineData("title: \"**a**\"", "[{\"type\":\"strong\",\"content\":[{\"type\":\"text\",\"text\":\"a\"}]}]")]
    [InlineData("title: |\n  one\n  two", "[{\"type\":\"text\",\"text\":\"one two\"}]")]
    [InlineData("title: \"a \\\\| b\"", "[{\"type\":\"text\",\"text\":\"a | b\"}]")]
    public void ATextFieldIsInlineMarkdownInAnyScalarStyle(string title, string expected) =>
        Assert.Equal(expected, Block(Walk().Replace("title: Shift", title, StringComparison.Ordinal))["title"]!.ToJsonString());

    [Theory]
    [InlineData("title: \"\"", "12: walk-it title is one paragraph of inline text")]
    [InlineData("title: \"a\\n\\nb\"", "12: walk-it title is one paragraph of inline text")]
    [InlineData("title: \"# a\"", "12: walk-it title is one paragraph of inline text")]
    [InlineData("title: \"[a]: #syn-a\"", "12: walk-it title is one paragraph of inline text")]
    [InlineData("title: \"<b>a</b>\"", "12: raw HTML is not allowed")]
    [InlineData("title: \"| a |\"", "12: a line that starts with | is read as a table")]
    [InlineData("title: \"[a](https://example.com)\"", "12: link target")]
    [InlineData("title: \"a \\uD83D\\uDE00\"", "12: walk-it title escapes a surrogate code point")]
    public void ATextFieldIsRefusedAsBodyTextWouldBe(string title, string expected) =>
        Refused(Walk().Replace("title: Shift", title, StringComparison.Ordinal), Path + expected);

    [Theory]
    [InlineData("intro: Copy first.", "intro: \"\"", "16: walk-it intro is one paragraph of inline text")]
    [InlineData("note: Copy.", "note: \"<i>x</i>\"", "18: raw HTML is not allowed")]
    [InlineData("note: Copy.", "note: \"[x](#nowhere)\"", "18: link target \"#nowhere\"")]
    public void IntroAndNoteAreHeldToTheSameRules(string from, string to, string expected) =>
        Refused(Walk().Replace(from, to, StringComparison.Ordinal), Path + expected);

    [Fact]
    public void AWalkItIsSpokenWhereSpeechIsRead()
    {
        var result = Compile(Chapter, Part + "\n```" + Info + "\n" + Walk() + "```\n", Repository.Schema);

        Assert.Equal(string.Empty, Shown(result));
        var part = JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/part.json", StringComparison.Ordinal)).Bytes)!;
        Assert.Equal(
            """[{"target":{"type":"block","blockId":"syn-a/b1"},"text":"Text."},{"target":{"type":"block","blockId":"syn-a/b2"},"text":"Shift"},{"target":{"type":"block","blockId":"syn-a/b2.1.s0"},"text":"Copy first."},{"target":{"type":"block","blockId":"syn-a/b2.1.s1"},"text":"Copy."}]""",
            part["sections"]![0]!["spoken"]!["segments"]!.ToJsonString());
    }

    [Fact]
    public void TheCommittedBlockUnionAdmitsTheBlock()
    {
        var result = Compile(Chapter + "```" + Info + "\n" + Walk() + "```\n", Part, Repository.Schema);

        Assert.Empty(result.Diagnostics);
        var chapter = JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/chapter.json", StringComparison.Ordinal)).Bytes)!;
        Assert.Equal("walk-it", (string?)chapter["intro"]![1]!["type"]);
    }

    // The fence opens on line 11 of the chapter, so the document's lines are 12 (title), 13
    // (cells), 14 (sequences), 15 to 17 (the first sequence), 18 (its step) and 19 onwards (more).
    private static string Walk(string cells = "[4, \"ab\", null]", string step = "{ dst: 2, src: 1, note: Copy. }", string more = "") =>
        $"title: Shift\ncells: {cells}\nsequences:\n  - name: safe\n    intro: Copy first.\n    steps:\n      - {step}\n{more}";

    private static CompileResult Run(string document, string info = Info) =>
        Compile(Chapter + Fence(document, info), Part, Repository.Schema);

    private static string Fence(string document, string info = Info) =>
        "```" + info + "\n" + document + (document.EndsWith('\n') ? string.Empty : "\n") + "```\n";

    private static CompileResult Compile(string chapter, string part, IContentSchema schema)
    {
        using var folder = new TempFolder();
        folder.Write("chapters/c/chapter.md", chapter);
        folder.Write("chapters/c/part.md", part);
        folder.Write("aliases.yml", "slugs: {}\nids: {}\n");
        folder.Write("patterns.yml", "patterns: []\n");
        return ContentCompiler.Compile(folder.Path, schema, folder.Path);
    }

    private static JsonNode Block(string document)
    {
        var block = Record(Chapter + Fence(document))["intro"]![1]!;
        Assert.Equal("walk-it", (string?)block["type"]);
        return block;
    }

    // The compiled record passes the schema in the compiler; it is checked again here so a test
    // never rests on the compiler having called the check.
    private static JsonNode Record(string chapter)
    {
        var result = Compile(chapter, Part, Repository.Schema);
        Assert.Empty(result.Diagnostics);
        var record = JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/chapter.json", StringComparison.Ordinal)).Bytes)!;
        Assert.Null(Repository.Schema.Validate(record.ToJsonString()));
        return record;
    }

    private static void Refused(string document, string expected)
    {
        var result = Run(document);
        Assert.Contains(expected, Shown(result), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    private static string Shown(CompileResult result) => string.Join('\n', result.Diagnostics.Select(d => d.ToString()));
}
