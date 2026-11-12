using System.Text.Json.Nodes;
using Markdig.Syntax.Inlines;
using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class LinkTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string PartHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n";
    private const string NotInternal = "is not an internal target; write [text](#id) or [text](ch-chapter#id)";

    // The section opens at line 7 of a part, so its first body block sits at line 9.
    private const string Section = "## Good {#syn-good}\n\n";

    // Targets the nested-looking cases name: a code block and a text block.
    private const string Anchors = "```csharp {#syn-a1 group=g spoken=\"Runs\"}\nint x = 1;\n```\n\n```text {#syn-note spoken=\"Shows\"}\nx\n```\n";

    [Theory]
    [InlineData("https://learn.microsoft.com/en-us/dotnet/")]
    [InlineData("http://example.com")]
    [InlineData("//example.com/x")]
    [InlineData("JavaScript:alert(1)")]
    [InlineData("data:text/html,x")]
    [InlineData("vbscript:x")]
    [InlineData("mailto:a@b.c")]
    [InlineData("/chapters/x")]
    [InlineData("example.com")]
    [InlineData("ch-test/x#syn-good")]
    [InlineData("ch-test.x#syn-good")]
    [InlineData("ch-test%23syn-good")]
    [InlineData("ch-test?x#syn-good")]
    [InlineData("#syn-good@x")]
    public void ExternalTargetIsRefused(string target) =>
        AssertRefused($"See [this]({target}).\n", $"chapters/c/part.md:9: link target \"{target}\" {NotInternal}");

    [Theory]
    [InlineData("See [this](javascript&#58;alert(1)).\n", "javascript:alert(1)")]
    [InlineData("See [this](\\\\example.com\\x).\n", "\\example.com\\x")]
    [InlineData("See [this]( javascript:x).\n", "javascript:x")]
    [InlineData("See [this](< javascript:x>).\n", " javascript:x")]
    [InlineData("See [this](<java script:x>).\n", "java script:x")]
    [InlineData("See [this](<\tjavascript:x>).\n", "\\u0009javascript:x")]
    [InlineData("See [this](<\u0001javascript:x>).\n", "\\u0001javascript:x")]
    [InlineData("See [this](<java\u007F" + "script:x>).\n", "java\\u007f" + "script:x")]
    [InlineData("See [this](< #syn-good>).\n", " #syn-good")]
    [InlineData("See [this][r].\n\n[r]: https://example.com\n", "https://example.com")]
    public void DisguisedExternalTargetIsRefused(string body, string shown) =>
        AssertRefused(body, $"chapters/c/part.md:9: link target \"{shown}\" {NotInternal}");

    [Fact]
    public void AutolinkIsRefused() =>
        AssertRefused("A <https://example.com> link.\n", "chapters/c/part.md:9: unsupported Markdown: autolink");

    // A definition no link uses still renders nothing, but its target is held to the same form.
    [Fact]
    public void UnusedDefinitionWithAUrlIsRefused() =>
        AssertRefused("Text.\n\n[r]: https://example.com\n", $"chapters/c/part.md:11: link target \"https://example.com\" {NotInternal}");

    [Theory]
    [InlineData("#Syn-good")]
    [InlineData("#1abc")]
    [InlineData("#syn-var/b2")]
    [InlineData("#syn-var/b2.i1")]
    [InlineData("#syn-good#syn-good")]
    [InlineData("#")]
    [InlineData("ch-test#")]
    [InlineData("Ch-test#syn-good")]
    [InlineData("test#syn-good")]
    [InlineData("#javascript:alert(1)")]
    public void TargetOutsideTheIdGrammarIsRefused(string target) =>
        AssertRefused($"See [this]({target}).\n", $"chapters/c/part.md:9: link target \"{target}\" {NotInternal}");

    [Fact]
    public void PositionalIdsNeverMatchTheIdGrammar()
    {
        Assert.False(ContentIds.IsValid("syn-var/b2"));
        Assert.False(ContentIds.IsValid("syn-var/b2.i1"));
        Assert.False(ContentIds.IsValid("intro/b1"));
    }

    [Fact]
    public void FortyNineCharacterIdIsRefused()
    {
        var target = "#" + new string('a', 49);

        AssertRefused($"See [this]({target}).\n", $"chapters/c/part.md:9: link target \"{target}\" {NotInternal}");
    }

    [Fact]
    public void FortyEightCharacterIdIsAdmittedByForm() =>
        Assert.Empty(Compile(Part(Section + $"See [this](ch-other#{new string('a', 48)}).\n")).Diagnostics);

    [Fact]
    public void IntroTargetIsRefused() =>
        AssertRefused("See [this](#intro).\n", "chapters/c/part.md:9: link target \"#intro\" names \"intro\", which is not a link target");

    [Theory]
    [InlineData("ch-arrays")]
    [InlineData("ch-test")]
    public void ChapterOnlyTargetIsRefused(string target) =>
        AssertRefused($"See [this]({target}).\n", $"chapters/c/part.md:9: link target \"{target}\" names a chapter but no #id; link to a section or block id in it");

    [Fact]
    public void TitledLinkIsRefused() =>
        AssertRefused("See [this](#syn-good \"title\").\n", "chapters/c/part.md:9: link target \"#syn-good\" has a title, which links do not take");

    [Fact]
    public void EmptyLinkTextIsRefused() =>
        AssertRefused("See [](#syn-good).\n", "chapters/c/part.md:9: link text is empty");

    [Theory]
    [InlineData("#ch-arrays")]
    [InlineData("#syn-missing")]
    [InlineData("ch-test#syn-missing")]
    [InlineData("#g")]
    public void LocalTargetWithoutAnAnchorInTheFileIsRefused(string target) =>
        AssertRefused(
            $"See [this]({target}).\n\n```csharp {{#syn-a1 group=g spoken=\"Runs\"}}\nint x = 1;\n```\n",
            $"chapters/c/part.md:9: link target \"{target}\" names no section or block id in this file");

    [Fact]
    public void CurrentChapterTargetOnlyInASiblingFileIsRefused()
    {
        var result = Compile(
            ("chapters/c/chapter.md", Chapter + "\n## Elsewhere {#syn-elsewhere}\n"),
            ("chapters/c/part.md", PartHead + Section + "See [this](ch-test#syn-elsewhere).\n"));

        Assert.Contains("chapters/c/part.md:9: link target \"ch-test#syn-elsewhere\" names no section or block id in this file", Lines(result), StringComparer.Ordinal);
        Assert.Empty(result.Files);
    }

    [Theory]
    [InlineData("[a [b](#syn-good)](#syn-a1)", "[a ", "](#syn-a1)")]
    [InlineData("[a [b [c](#syn-good)](#syn-a1)](#syn-note)", "[a [b ", "](#syn-a1)](#syn-note)")]
    [InlineData("[*a [b](#syn-good)*](#syn-a1)", "[", "](#syn-a1)")]
    [InlineData("[a [b][r]](#syn-a1)\n\n[r]: #syn-good", "[a ", "](#syn-a1)")]
    public void NestedLookingLinkCompilesToLiteralTextAroundOneLink(string markdown, string before, string after)
    {
        var body = Section + markdown + "\n\n" + Anchors;
        var result = Compile(Part(body));

        Assert.Empty(result.Diagnostics);
        var content = Paragraph(result, 0);
        Assert.Single(LinkSpans(content));
        Assert.All(LinkSpans(content), link => Assert.Empty(LinkSpans(link["content"]!.AsArray())));
        Assert.Equal(before, (string?)Flatten(content).First()["text"]);
        Assert.Equal(after, (string?)content[^1]!["text"]);
    }

    [Fact]
    public void ReferenceLinkToAnAnchorCompiles()
    {
        var result = Compile(Part(Section + "See [this][r].\n\n[r]: #syn-good\n"));

        Assert.Empty(result.Diagnostics);
        var link = Paragraph(result, 0)[1]!;
        Assert.Equal("link", (string?)link["type"]);
        Assert.Equal("syn-good", (string?)link["id"]);
        Assert.Null(link["chapter"]);
    }

    [Fact]
    public void OtherChapterTargetIsCheckedOnlyByForm()
    {
        var result = Compile(Part(Section + "See [this](ch-elsewhere#not-yet-checked).\n"));

        Assert.Empty(result.Diagnostics);
        var link = Paragraph(result, 0)[1]!;
        Assert.Equal("ch-elsewhere", (string?)link["chapter"]);
        Assert.Equal("not-yet-checked", (string?)link["id"]);
    }

    [Fact]
    public void FixtureLinksCompileToIdsWithNoUrlField()
    {
        var files = Repository.Compile(Repository.Fixture).Files.ToDictionary(f => f.RelativePath, f => JsonNode.Parse(f.Bytes)!, StringComparer.Ordinal);

        var chapterLinks = Links(files["chapters/fixture-basics/chapter.json"]).ToList();
        Assert.Contains(chapterLinks, l => Is(l["id"], "fix-parts") && l["chapter"] is null);
        Assert.Contains(chapterLinks, l => Is(l["id"], "fix-note") && Is(l["chapter"], "ch-fixture"));
        Assert.Contains(chapterLinks, l => Is(l["id"], "second-start") && Is(l["chapter"], "ch-second"));
        var strong = chapterLinks.Single(l => Is(l["id"], "fix-links"))["content"]![0]!;
        Assert.Equal("strong", (string?)strong["type"]);
        Assert.Contains(strong["content"]!.AsArray(), s => Is(s!["type"], "em"));

        var partLinks = Links(files["chapters/fixture-basics/syntax.json"]).ToList();
        Assert.Contains(partLinks, l => Is(l["id"], "syn-fix-sum1") && Is(l["chapter"], "ch-fixture"));
        Assert.Contains(partLinks, l => Is(l["id"], "syn-fix-sum") && l["chapter"] is null);

        var all = files.Values.SelectMany(Links).ToList();
        Assert.All(all, l => Assert.Empty(LinkSpans(l["content"]!.AsArray())));
        Assert.All(all, l => Assert.Empty(l.Select(p => p.Key).Except(["type", "kind", "id", "chapter", "content"], StringComparer.Ordinal)));
        Assert.All(chapterLinks, l => Assert.Equal("anchor", (string?)l["kind"]));
        Assert.Contains(partLinks, l => Is(l["id"], "err-fixture-cs0165") && Is(l["kind"], "error") && l["chapter"] is null);
    }

    [Fact]
    public void FixtureAnchorTablesHoldSectionAndBlockIdsOnly()
    {
        using var folder = new TempFolder();
        Repository.CopyTree(Repository.Fixture, folder.Path, "\n");
        var text = File.ReadAllText(Path.Combine(folder.Path, "chapters", "fixture-basics", "chapter.md"));
        var diagnostics = new List<Diagnostic>();

        var file = SourceFile.Parse("chapter.md", text, isChapter: true, diagnostics);

        Assert.Empty(diagnostics);
        Assert.Equal(["fix-parts", "fix-links", "fix-note"], file.Anchors, StringComparer.Ordinal);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    public void NestedLinkNodeIsAContentError(int depth)
    {
        var outer = new LinkInline("#syn-y", string.Empty);
        ContainerInline parent = outer;
        for (var i = 1; i < depth; i++)
        {
            var emphasis = new EmphasisInline { DelimiterChar = '*', DelimiterCount = i };
            parent.AppendChild(emphasis);
            parent = emphasis;
        }

        var inner = new LinkInline("#syn-x", string.Empty);
        inner.AppendChild(new LiteralInline("b"));
        parent.AppendChild(inner);

        var diagnostic = SourceFile.NestedLink("part.md", 9, outer);

        Assert.Equal("part.md:9: a link cannot hold another link", diagnostic?.ToString());
    }

    [Fact]
    public void LinkWithoutANestedLinkPassesTheNestedCheck()
    {
        var outer = new LinkInline("#syn-y", string.Empty);
        var emphasis = new EmphasisInline { DelimiterChar = '*', DelimiterCount = 1 };
        emphasis.AppendChild(new LiteralInline("a"));
        outer.AppendChild(emphasis);

        Assert.Null(SourceFile.NestedLink("part.md", 9, outer));
    }

    [Theory]
    [InlineData("## Shared {#syn-shared}\n\n```csharp {#syn-shared group=g spoken=\"Runs\"}\nint x = 1;\n```\n", 9)]
    [InlineData("## Shared {#syn-shared}\n\n```text {#syn-shared spoken=\"Shows\"}\nx\n```\n", 9)]
    [InlineData(Section + "```csharp {#syn-a1 group=g spoken=\"Runs\"}\nint x = 1;\n```\n\n```csharp {#syn-a1 group=g spoken=\"Runs\"}\nint y = 2;\n```\n", 13)]
    [InlineData(Section + "```text {#syn-a1 spoken=\"Shows\"}\nx\n```\n\n```text {#syn-a1 spoken=\"Shows\"}\ny\n```\n", 13)]
    public void DuplicateImmutableIdInOneFileFailsWithNoOutput(string body, int line)
    {
        var id = body.Contains("syn-shared", StringComparison.Ordinal) ? "syn-shared" : "syn-a1";
        var first = line == 9 ? 7 : 9;

        var result = Compile(Part(body + "\nSee [this](#" + id + ").\n"));

        Assert.Contains($"chapters/c/part.md:{line}: duplicate id \"{id}\" (first used at chapters/c/part.md:{first})", Lines(result), StringComparer.Ordinal);
        Assert.DoesNotContain(result.Diagnostics, d => d.Message.StartsWith("link target", StringComparison.Ordinal));
        Assert.Empty(result.Files);
    }

    [Fact]
    public void LinkSpanWithAnHrefIsASchemaViolation()
    {
        var (document, link) = CompiledLink();
        link["href"] = "https://example.com";

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    [Fact]
    public void CompiledLinkSpanIsSchemaValid()
    {
        var (document, _) = CompiledLink();

        Assert.Null(Repository.Schema.Validate(document.ToJsonString()));
    }

    [Theory]
    [InlineData("")]
    [InlineData("em")]
    [InlineData("strong em")]
    public void LinkAtAnyDepthInsideLinkContentIsASchemaViolation(string wrappers)
    {
        var (document, link) = CompiledLink();
        JsonNode inner = new JsonObject { ["type"] = "link", ["id"] = "syn-good", ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = "b" }) };
        foreach (var wrapper in wrappers.Split(' ', StringSplitOptions.RemoveEmptyEntries).Reverse())
        {
            inner = new JsonObject { ["type"] = wrapper, ["content"] = new JsonArray(inner) };
        }

        link["content"]!.AsArray().Add(inner);

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    [Theory]
    [InlineData("chapter", "test")]
    [InlineData("chapter", "ch-Test")]
    [InlineData("id", "syn-good/b1")]
    public void LinkSpanFieldOutsideItsGrammarIsASchemaViolation(string field, string value)
    {
        var (document, link) = CompiledLink();
        link[field] = value;

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    private static (JsonNode Document, JsonObject Link) CompiledLink()
    {
        var result = Compile(Part(Section + "See [this](ch-test#syn-good).\n"));
        Assert.Empty(result.Diagnostics);
        var document = JsonNode.Parse(result.Files.Single(f => f.RelativePath.EndsWith("part.json", StringComparison.Ordinal)).Bytes)!;
        return (document, document["sections"]![0]!["body"]![0]!["content"]![1]!.AsObject());
    }

    private static JsonArray Paragraph(CompileResult result, int index)
    {
        var document = JsonNode.Parse(result.Files.Single(f => f.RelativePath.EndsWith("part.json", StringComparison.Ordinal)).Bytes)!;
        return document["sections"]![0]!["body"]![index]!["content"]!.AsArray();
    }

    private static IEnumerable<JsonObject> LinkSpans(JsonArray spans) =>
        Flatten(spans).Where(s => Is(s["type"], "link"));

    // Every span at any depth, in document order.
    private static IEnumerable<JsonObject> Flatten(JsonArray spans)
    {
        foreach (var span in spans.Select(s => s!.AsObject()))
        {
            yield return span;
            if (span["content"] is JsonArray inner)
            {
                foreach (var child in Flatten(inner))
                {
                    yield return child;
                }
            }
        }
    }

    // Every link span anywhere in a compiled document.
    private static IEnumerable<JsonObject> Links(JsonNode node)
    {
        if (node is JsonObject obj && Is(obj["type"], "link"))
        {
            yield return obj;
        }

        var children = node switch
        {
            JsonObject o => o.Select(p => p.Value),
            JsonArray a => a.AsEnumerable(),
            _ => [],
        };
        foreach (var child in children.OfType<JsonNode>().SelectMany(Links))
        {
            yield return child;
        }
    }

    private static bool Is(JsonNode? node, string value) => string.Equals((string?)node, value, StringComparison.Ordinal);

    private static void AssertRefused(string body, string expected)
    {
        var result = Compile(Part(Section + body));

        Assert.Contains(expected, Lines(result), StringComparer.Ordinal);
        Assert.Empty(result.Files);
    }

    private static List<string> Lines(CompileResult result) => [.. result.Diagnostics.Select(d => d.ToString())];

    private static (string Path, string Text)[] Part(string body) => [("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead + body)];

    private static CompileResult Compile(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        foreach (var (path, text) in files)
        {
            folder.Write(path, text);
        }

        return Repository.Compile(folder.Path);
    }
}
