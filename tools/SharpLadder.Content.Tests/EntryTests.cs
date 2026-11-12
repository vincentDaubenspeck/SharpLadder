using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Glossary and error entries: closed front matter, labelled fields, entry identity and links.
public sealed class EntryTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string PartHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## Title {#syn-a}\n\n";
    private const string TermHead = "---\nid: term-a\nterm: A term\nshort: What it means.\n---\n";
    private const string ErrorHead = "---\nid: err-a\nkind: compiler\ncode: CS0001\nwrote: A thing\ngot: A message\n---\n\n";
    private const string BodyRule = "an error entry's body is one list of two fields, \"- cause:\" then \"- hint:\", and nothing else";

    [Fact]
    public void AGlossaryEntryCompilesToItsFieldsAndBody()
    {
        var entry = Entry("glossary/term-a.md", "---\nid: term-a\nterm: \"Span<T> & <b>\"\nshort: What it means.\nsee: [syn-a, ch-test]\n---\n\nFirst.\n\n- one\n- two\n");

        Assert.Equal(
            """{"type":"glossary","id":"term-a","term":"Span<T> & <b>","short":"What it means.","see":["syn-a","ch-test"],"body":[{"type":"paragraph","blockId":"term-a/b1","content":[{"type":"text","text":"First."}]},{"type":"list","blockId":"term-a/b2","ordered":false,"items":[{"blockId":"term-a/b2.i1","content":[{"type":"text","text":"one"}]},{"blockId":"term-a/b2.i2","content":[{"type":"text","text":"two"}]}]}]}""",
            Relaxed(entry));
    }

    [Fact]
    public void AGlossaryEntryMayHoldNoBody() =>
        Assert.Equal("""{"type":"glossary","id":"term-a","term":"A term","short":"What it means.","see":[],"body":[]}""", Relaxed(Entry("glossary/term-a.md", TermHead)));

    [Fact]
    public void AnErrorEntryCompilesToItsFieldsInOneBlockCount()
    {
        var entry = Entry("errors/err-a.md", ErrorHead + "- cause: Because `x` is *unset*.\n\n  More cause.\n- hint:\n\n  ```text {#a-shape spoken=\"A shape\"}\n  a = b;\n  ```\n");

        Assert.Equal(
            """{"type":"error","kind":"compiler","id":"err-a","code":"CS0001","wrote":"A thing","got":"A message","see":[],"cause":[{"type":"paragraph","blockId":"err-a/b1","content":[{"type":"text","text":"Because "},{"type":"code","text":"x"},{"type":"text","text":" is "},{"type":"em","content":[{"type":"text","text":"unset"}]},{"type":"text","text":"."}]},{"type":"paragraph","blockId":"err-a/b2","content":[{"type":"text","text":"More cause."}]}],"hint":[{"type":"text","blockId":"err-a/b3","id":"a-shape","spoken":"A shape","source":"a = b;"}]}""",
            Relaxed(entry));
    }

    [Theory]
    [InlineData("code:\n")]
    [InlineData("code: \"\"\n")]
    [InlineData("")]
    public void AWrongOutputEntryCompilesWithoutACode(string code)
    {
        var entry = Entry("errors/err-a.md", "---\nid: err-a\nkind: wrong-output\n" + code + "wrote: A thing\ngot: A result\n---\n\n- cause: One.\n- hint: Two.\n");

        Assert.Equal("wrong-output", (string?)entry["kind"]);
        Assert.False(entry.AsObject().ContainsKey("code"));
    }

    [Theory]
    [InlineData("- cause: `x` first.\n- hint: Two.\n", 1, 1)]
    [InlineData("- cause: **Bold** first.\n- hint: A [link](#err-a) to itself.\n", 1, 1)]
    [InlineData("- cause: One.\n\n  1. a\n  2. b\n- hint: Two.\n", 2, 1)]
    [InlineData("- cause:\n\n  | A |\n  | - |\n  | 1 |\n\n- hint: Two.\n", 1, 1)]
    [InlineData("- cause: One.\n\n  Two.\n\n  Three.\n- hint:\n\n  Four.\n", 3, 1)]
    [InlineData("- cause: a: b, c: d.\n- hint: hint: again.\n", 1, 1)]
    public void FieldsHoldTheirBlocks(string body, int cause, int hint)
    {
        var entry = Entry("errors/err-a.md", ErrorHead + body);

        Assert.Equal(cause, entry["cause"]!.AsArray().Count);
        Assert.Equal(hint, entry["hint"]!.AsArray().Count);
        var ids = entry["cause"]!.AsArray().Concat(entry["hint"]!.AsArray()).Select(b => (string)b!["blockId"]!);
        Assert.Equal(Enumerable.Range(1, cause + hint).Select(n => $"err-a/b{n}"), ids, StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("- *cause*: One.\n- hint: Two.\n", "errors/err-a.md:9: a field starts with its label in plain text and a colon; the labels are cause, hint")]
    [InlineData("- `cause:` One.\n- hint: Two.\n", "a field starts with its label in plain text and a colon")]
    [InlineData("- Cause: One.\n- hint: Two.\n", "a field starts with its label in plain text and a colon")]
    [InlineData("- cause\\: One.\n- hint: Two.\n", "a field starts with its label in plain text and a colon")]
    [InlineData("- cause: One.\n- note: Three.\n- hint: Two.\n", "errors/err-a.md:10: a field starts with its label in plain text and a colon")]
    [InlineData("- cause: One.\n- cause: Again.\n- hint: Two.\n", "errors/err-a.md:10: field \"cause\" is written twice")]
    [InlineData("- hint: Two.\n- cause: One.\n", "errors/err-a.md:10: field \"cause\" is out of order; the order is cause, hint")]
    [InlineData("- cause:\n- hint: Two.\n", "errors/err-a.md:9: field \"cause\" is empty")]
    [InlineData("- cause:  One.\n- hint: Two.\n", "write the text of \"cause\" after one space on the label's line")]
    [InlineData("- cause:One.\n- hint: Two.\n", "write the text of \"cause\" after one space on the label's line")]
    [InlineData("- cause:\n  One.\n- hint: Two.\n", "write the text of \"cause\" after one space on the label's line")]
    [InlineData("- cause:*One.*\n- hint: Two.\n", "write the text of \"cause\" after one space on the label's line")]
    [InlineData("1. cause: One.\n2. hint: Two.\n", "fields are written as a bullet list, one item for each of cause, hint")]
    [InlineData("- cause: One.\n", "an error entry needs the field \"hint\"; " + BodyRule)]
    [InlineData("- hint: Two.\n", "an error entry needs the field \"cause\"; " + BodyRule)]
    [InlineData("Before.\n\n- cause: One.\n- hint: Two.\n", "errors/err-a.md:9: " + BodyRule)]
    [InlineData("- cause: One.\n- hint: Two.\n\nAfter.\n", "errors/err-a.md:12: " + BodyRule)]
    [InlineData("## Head {#err-h}\n\n- cause: One.\n- hint: Two.\n", BodyRule)]
    [InlineData("", BodyRule)]
    [InlineData("- cause: One.\n\n  - a\n\n    b\n- hint: Two.\n", "a list item holds one paragraph only")]
    [InlineData("- cause: One.\n\n  > quoted\n- hint: Two.\n", "unsupported Markdown: block quote")]
    [InlineData("- cause: One.\n\n  ## Head\n- hint: Two.\n", "unsupported Markdown: HeadingBlock")]
    [InlineData("- cause: One.\n\n  ```python\n  x\n  ```\n- hint: Two.\n", "code fence language must be csharp or text")]
    [InlineData("- cause: One <b>x</b>.\n- hint: Two.\n", "raw HTML is not allowed")]
    [InlineData("- cause: One.\n  | not a table\n- hint: Two.\n", "a line that starts with | is read as a table")]
    public void AnythingElseWrittenAsFieldsIsRefused(string body, string expected) =>
        Refused(expected, ("errors/err-a.md", ErrorHead + body));

    [Theory]
    [InlineData("id: term-a\nterm: A\nterm: B\nshort: S.\n", "front matter: ")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nextra: 1\n", "front matter: ")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: syn-a\n", "front matter: ")]
    [InlineData("id: term-a\nterm: [A]\nshort: S.\n", "front matter: ")]
    [InlineData("id: term-a\nterm: A\nshort: \"one\\ntwo\"\n", "glossary/term-a.md:4: short holds a line break or a character that cannot be shown; write it on one line")]
    [InlineData("id: term-a\nterm: A\nshort: |\n  one\n  two\n", "short holds a line break")]
    [InlineData("id: term-a\nterm: \"a\\tb\"\nshort: S.\n", "glossary/term-a.md:3: term holds a line break")]
    [InlineData("id: term-a\nterm: \" \"\nshort: S.\n", "glossary/term-a.md:3: term is blank")]
    [InlineData("id: term-a\nterm:\nshort: S.\n", "glossary/term-a.md:3: front matter states no term")]
    [InlineData("id: term-a\nterm: A\n", "front matter states no short")]
    [InlineData("term: A\nshort: S.\n", "front matter states no id")]
    [InlineData("id: Term-a\nterm: A\nshort: S.\n", "glossary entry id \"Term-a\" is not lowercase letters")]
    [InlineData("id: term-\nterm: A\nshort: S.\n", "glossary entry id \"term-\" must start with term- and go on after it")]
    [InlineData("id: err-a\nterm: A\nshort: S.\n", "glossary entry id \"err-a\" must start with term-")]
    [InlineData("id: term-b\nterm: A\nshort: S.\n", "glossary/term-a.md:2: the file is named \"term-a.md\" and states the id \"term-b\"; name the file term-b.md")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [term-a]\n", "glossary/term-a.md:5: see names the entry's own id \"term-a\"")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [syn-a, syn-a]\n", "see names \"syn-a\" twice")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [Syn A]\n", "see names \"Syn A\", which is not lowercase letters")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [syn-a, ~]\n", "see names \"\", which is not lowercase letters")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [syn-missing]\n", "glossary/term-a.md:5: see names \"syn-missing\", which is no live section, chapter, card, glossary entry or error entry")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [syn-a1]\n", "see names \"syn-a1\", which is no live section")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [card-count-by-key]\n", "see names \"card-count-by-key\", which is no live section")]
    [InlineData("id: term-a\nterm: A\nshort: S.\nsee: [prob-0001]\n", "see names \"prob-0001\", which is no live section")]
    public void GlossaryFrontMatterOutsideItsRulesIsRefused(string yaml, string expected) =>
        Refused(expected, ("glossary/term-a.md", "---\n" + yaml + "---\n\nBody.\n"));

    [Fact]
    public void AShortTextIsAtMostTwoHundredCharacters()
    {
        var fits = "---\nid: term-a\nterm: A\nshort: " + new string('a', 200) + "\n---\n";

        Assert.Equal(200, ((string)Entry("glossary/term-a.md", fits)["short"]!).Length);
        Refused("glossary/term-a.md:4: short is 201 characters; at most 200 are allowed", ("glossary/term-a.md", fits.Replace("short: ", "short: a", StringComparison.Ordinal)));
    }

    [Theory]
    [InlineData("kind: build\ncode: C\n", "errors/err-a.md:3: error kind \"build\" is not admitted; write kind as one of compiler, runtime, wrong-output")]
    [InlineData("code: C\n", "front matter states no kind; write kind as one of compiler, runtime, wrong-output")]
    [InlineData("kind: compiler\n", "front matter states no code")]
    [InlineData("kind: compiler\ncode:\n", "errors/err-a.md:4: front matter states no code")]
    [InlineData("kind: runtime\ncode: \"\"\n", "errors/err-a.md:4: code is blank")]
    [InlineData("kind: runtime\ncode: \" \"\n", "code is blank")]
    [InlineData("kind: wrong-output\ncode: CS0001\n", "errors/err-a.md:4: a wrong-output entry names no code; leave code empty")]
    [InlineData("kind: wrong-output\ncode: \" \"\n", "a wrong-output entry names no code; leave code empty")]
    [InlineData("kind: compiler\ncode: C\ncause: Why\n", "front matter: ")]
    public void ErrorFrontMatterOutsideItsRulesIsRefused(string yaml, string expected) =>
        Refused(expected, ("errors/err-a.md", "---\nid: err-a\n" + yaml + "wrote: W\ngot: G\n---\n\n- cause: One.\n- hint: Two.\n"));

    [Theory]
    [InlineData("glossary/term-a.md", TermHead + "\n## Head {#term-h}\n\nBody.\n", "glossary/term-a.md:7: a glossary entry holds no headings")]
    [InlineData("glossary/sub/term-a.md", TermHead, "glossary/ holds only .md files, one entry each")]
    [InlineData("glossary/term-a.txt", TermHead, "glossary/ holds only .md files, one entry each")]
    [InlineData("errors/sub/err-a.md", TermHead, "errors/ holds only .md files, one entry each")]
    [InlineData("glossary/term-a.md", "No front matter.\n", "glossary/term-a.md:1: file must start with YAML front matter between --- lines")]
    [InlineData("glossary/term-a.md", TermHead + "\n```csharp {#syn-a1 group=g spoken=\"S\"}\nx();\n```\n", "duplicate id \"syn-a1\"")]
    [InlineData("glossary/term-a.md", TermHead + "\nSee [it](#term-zz).\n", "glossary/term-a.md:7: Term target \"#term-zz\" names no glossary entry")]
    [InlineData("glossary/term-a.md", TermHead + "\nSee [it](#syn-a).\n", "link target \"#syn-a\" names no section or block id in this file")]
    [InlineData("glossary/term-a.md", TermHead + "\nSee [it](#err-missing).\n", "link target \"#err-missing\" names no section or block id in this file")]
    [InlineData("glossary/term-a.md", TermHead + "\nSee [it](https://example.com).\n", "is not an internal target")]
    public void EntryFilesOutsideTheirRulesAreRefused(string path, string text, string expected) =>
        Refused(expected, (path, text));

    [Theory]
    [InlineData("See [it](#term-b).\n", "chapters/c/part.md:13: Term target \"#term-b\" names no glossary entry")]
    [InlineData("See [it](ch-test#err-a).\n", "link target \"ch-test#err-a\" names an error entry, which belongs to no chapter; write [text](#err-a)")]
    [InlineData("See [it](ch-other#err-a).\n", "link target \"ch-other#err-a\" names an error entry, which belongs to no chapter")]
    [InlineData("See [it](#err-b).\n", "link target \"#err-b\" names no section or block id in this file")]
    [InlineData("## Again {#term-a}\n\nText.\n", "duplicate id \"term-a\"")]
    [InlineData("## Again {#err-a}\n\nText.\n", "duplicate id \"err-a\"")]
    public void LinksAndIdsAreJudgedByWhatTheIdNames(string part, string expected) =>
        Refused(expected, ("glossary/term-a.md", TermHead), ("errors/err-a.md", ErrorHead + "- cause: One.\n- hint: Two.\n"), ("chapters/c/part.md", PartHead + "```csharp {#syn-a1 group=g spoken=\"S\"}\nx();\n```\n\n" + part));

    [Fact]
    public void ALinkToAnErrorEntryIsMarkedAsOneAndAnAnchorLinkAsAnAnchor()
    {
        var result = Run(("errors/err-a.md", ErrorHead + "- cause: One.\n- hint: Two.\n"), ("chapters/c/part.md", PartHead + "See [the error](#err-a) and [here](#syn-a) and [there](ch-test#syn-a).\n"));

        Assert.Empty(result.Diagnostics);
        var spans = Json(result, "chapters/c/part.json")["sections"]![0]!["body"]![0]!["content"]!.AsArray().Where(s => string.Equals((string?)s!["type"], "link", StringComparison.Ordinal));
        Assert.Equal(
            ["""{"type":"link","kind":"error","id":"err-a","content":[{"type":"text","text":"the error"}]}""", """{"type":"link","kind":"anchor","id":"syn-a","content":[{"type":"text","text":"here"}]}""", """{"type":"link","kind":"anchor","id":"syn-a","chapter":"ch-test","content":[{"type":"text","text":"there"}]}"""],
            spans.Select(s => s!.ToJsonString()),
            StringComparer.Ordinal);
    }

    [Fact]
    public void ARetiredIdIsRefusedUnderSee() =>
        Refused(
            "glossary/term-a.md:5: see names the retired id \"syn-old\"; name \"syn-a\"",
            ("aliases.yml", "slugs: {}\nids:\n  syn-old: syn-a\n"),
            ("glossary/term-a.md", "---\nid: term-a\nterm: A\nshort: S.\nsee: [syn-old]\n---\n"));

    [Fact]
    public void AnEntryIdIsNeverAnAliasOrAnAliasTarget()
    {
        Refused("term-a", ("aliases.yml", "slugs: {}\nids:\n  term-a: syn-a\n"), ("glossary/term-a.md", TermHead));
        Refused("term-a", ("aliases.yml", "slugs: {}\nids:\n  syn-old: term-a\n"), ("glossary/term-a.md", TermHead));
    }

    [Fact]
    public void EntriesCompileInPathOrderToTheSameBytesEveryTime()
    {
        (string Path, string Text)[] files = [("glossary/term-b.md", TermHead.Replace("term-a", "term-b", StringComparison.Ordinal)), ("glossary/term-a.md", TermHead), ("errors/err-a.md", ErrorHead + "- cause: One.\n- hint: Two.\n")];
        var first = Run(files);
        var second = Run([.. files.Reverse()]);

        Assert.Empty(first.Diagnostics);
        Assert.Equal(["aliases.json", "chapters/c/chapter.json", "chapters/c/part.json", "errors/err-a.json", "glossary/term-a.json", "glossary/term-b.json", "patterns.json"], first.Files.Select(f => f.RelativePath).Order(StringComparer.Ordinal), StringComparer.Ordinal);
        Assert.Equal(first.Files.Select(f => (f.RelativePath, Convert.ToHexString(f.Bytes))), second.Files.Select(f => (f.RelativePath, Convert.ToHexString(f.Bytes))));
        Assert.Equal([RecordKind.Error, RecordKind.Glossary, RecordKind.Glossary], first.Files.Where(f => f.Kind is RecordKind.Error or RecordKind.Glossary).Select(f => f.Kind!.Value));
        Assert.All(first.Files, f => Assert.Equal(f.Kind == RecordKind.Part ? "syntax" : null, f.Part));
    }

    private static string Relaxed(JsonNode node) =>
        node.ToJsonString(new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });

    private static JsonNode Entry(string path, string text)
    {
        var result = Run((path, text));
        Assert.Empty(result.Diagnostics);
        return Json(result, Path.ChangeExtension(path, ".json"));
    }

    private static JsonNode Json(CompileResult result, string path) =>
        JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, path, StringComparison.Ordinal)).Bytes)!;

    private static void Refused(string expected, params (string Path, string Text)[] files)
    {
        var result = Run(files);

        Assert.Contains(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    // A chapter and one part stand beside the files under test unless a test writes its own.
    private static CompileResult Run(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        (string Path, string Text)[] basis = [("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead + "```csharp {#syn-a1 group=g spoken=\"S\"}\nx();\n```\n\n## Other {#syn-b}\n\nText.\n")];
        foreach (var (path, text) in basis.Where(b => !files.Any(f => string.Equals(f.Path, b.Path, StringComparison.Ordinal))).Concat(files))
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return Repository.Compile(folder.Path);
    }
}
