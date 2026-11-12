using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Term: a link to a live glossary entry, resolved at compilation, holding its entry's short text.
public sealed class TermTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string PartHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## Title {#syn-a}\n\n";
    private const string Glossary = "---\nid: term-a\nterm: A term\nshort: What it means.\n---\n";
    private const string Part = "chapters/c/part.md";

    [Fact]
    public void ATermCompilesToItsEntryIdAndShortTextAndSpeaksOnlyItsSurface()
    {
        var section = Section(Run(("glossary/term-a.md", Glossary), (Part, PartHead + "Use the [*span* type](#term-a) here.\n")));

        Assert.Equal(
            """{"type":"term","id":"term-a","short":"What it means.","content":[{"type":"em","content":[{"type":"text","text":"span"}]},{"type":"text","text":" type"}]}""",
            section["body"]![0]!["content"]![1]!.ToJsonString());
        Assert.Contains(Segments(section), s => string.Equals(s, "Use the span type here.", StringComparison.Ordinal));
        Assert.DoesNotContain(Segments(section), s => s.Contains("What it means", StringComparison.Ordinal));
    }

    [Fact]
    public void AChangedShortTextChangesEveryReferencingRecordAndNoSpeech()
    {
        var text = PartHead + "One [term](#term-a).\n\n## Other {#syn-b}\n\nTwo [term](#term-a).\n";
        var before = Run(("glossary/term-a.md", Glossary), (Part, text));
        var after = Run(("glossary/term-a.md", Glossary.Replace("What it means.", "Something else.", StringComparison.Ordinal)), (Part, text));

        Assert.Empty(before.Diagnostics);
        Assert.Empty(after.Diagnostics);
        var old = Sections(before);
        var changed = Sections(after);
        Assert.All(old, s => Assert.Equal("What it means.", (string)s["body"]![0]!["content"]![1]!["short"]!));
        Assert.All(changed, s => Assert.Equal("Something else.", (string)s["body"]![0]!["content"]![1]!["short"]!));
        Assert.Equal(old.Select(s => s["spoken"]!.ToJsonString()), changed.Select(s => s["spoken"]!.ToJsonString()), StringComparer.Ordinal);
    }

    [Fact]
    public void AGlossaryEntryMayHoldATermForItself()
    {
        var result = Run(("glossary/term-a.md", Glossary + "\nSee [this term](#term-a).\n"));

        Assert.Empty(result.Diagnostics);
        Assert.Equal(
            """{"type":"term","id":"term-a","short":"What it means.","content":[{"type":"text","text":"this term"}]}""",
            Json(result, "glossary/term-a.json")["body"]![0]!["content"]![1]!.ToJsonString());
    }

    [Fact]
    public void ATermStandsInAListItemAndATableCell()
    {
        var result = Run(("glossary/term-a.md", Glossary), (Part, PartHead + "- a [term](#term-a)\n- b\n\n| Name | Use |\n| --- | --- |\n| [term](#term-a) | x |\n"));

        Assert.Empty(result.Diagnostics);
        var body = Section(result)["body"]!;
        Assert.Equal("term", (string)body[0]!["items"]![0]!["content"]![1]!["type"]!);
        Assert.Equal("term", (string)body[1]!["rows"]![0]![0]![0]!["type"]!);
    }

    [Fact]
    public void AnInternalLinkWithoutTheTermPrefixStaysALink() =>
        Assert.Equal("link", (string)Section(Run(("glossary/term-a.md", Glossary), (Part, PartHead + "See [here](#syn-a).\n")))["body"]![0]!["content"]![1]!["type"]!);

    [Theory]
    [InlineData("See [it](#term-b).\n", "chapters/c/part.md:9: Term target \"#term-b\" names no glossary entry")]
    [InlineData("See [it](ch-test#term-a).\n", "chapters/c/part.md:9: link target \"ch-test#term-a\" names a glossary entry, which belongs to no chapter; write [text](#term-a)")]
    [InlineData("See [it](ch-other#term-a).\n", "link target \"ch-other#term-a\" names a glossary entry, which belongs to no chapter")]
    [InlineData("## A [term](#term-a) here {#syn-b}\n\nText.\n", "chapters/c/part.md:9: a heading title may not hold a Term; link the term in the text below it")]
    [InlineData("## A *[term](#term-a)* here {#syn-b}\n\nText.\n", "a heading title may not hold a Term")]
    [InlineData("## Other {#term-x}\n\nText.\n", "id \"term-x\" starts with term-, which only a glossary entry id may")]
    [InlineData("## Other {#err-x}\n\nText.\n", "id \"err-x\" starts with err-, which only an error entry id may")]
    [InlineData("```csharp {#term-x1 group=g spoken=\"S\"}\nx();\n```\n", "id \"term-x1\" starts with term-, which only a glossary entry id may")]
    public void ATermOutsideItsRulesIsRefused(string text, string expected) =>
        Refused(expected, ("glossary/term-a.md", Glossary), (Part, PartHead + text));

    // An id alias ends at a section, so a retired Term id can only lead to one.
    [Fact]
    public void ATermToARetiredIdIsRefusedAndNamesItsSuccessor() =>
        Refused(
            "chapters/c/part.md:9: link target \"#term-old\" names the retired id \"term-old\"; link to \"syn-a\"",
            ("aliases.yml", "slugs: {}\nids:\n  term-old: syn-a\n"),
            ("glossary/term-a.md", Glossary),
            (Part, PartHead + "See [it](#term-old).\n"));

    [Fact]
    public void AnAliasNeverEndsAtAGlossaryEntry() =>
        Refused(
            "aliases.yml:3: \"term-old\" ends at \"term-a\", which is not a section id",
            ("aliases.yml", "slugs: {}\nids:\n  term-old: term-a\n"),
            ("glossary/term-a.md", Glossary),
            (Part, PartHead + "See [it](#term-a).\n"));

    [Fact]
    public void ACardOrApproachTitleMayNotHoldATerm()
    {
        const string cards = "---\nkind: cards\nchapter: ch-test\norder: 1\n---\n\n## Cards {#cards-a}\n\n### One [term](#term-a) {#card-one}\n\n- reach: R.\n- build: B.\n- why: W.\n";
        const string build = "---\nkind: build\nchapter: ch-test\norder: 1\n---\n\n## Build {#build-a}\n\n### First [term](#term-a) {#build-one approach=\"one\"}\n\nOne.\n\n### Second {#build-two approach=\"two\"}\n\nTwo.\n";

        Refused("chapters/c/part.md:9: a heading title may not hold a Term", ("glossary/term-a.md", Glossary), (Part, cards));
        Refused("chapters/c/part.md:9: a heading title may not hold a Term", ("glossary/term-a.md", Glossary), (Part, build));
    }

    [Theory]
    [InlineData("See [a [b](#syn-a) c](#term-a).\n")]
    [InlineData("See [a [b](#term-a) c](#syn-a).\n")]
    [InlineData("See [a **[b](#term-a)** c](#term-a).\n")]
    public void NoLinkHoldsATermAndNoTermHoldsALink(string text)
    {
        var result = Run(("glossary/term-a.md", Glossary), (Part, PartHead + text));

        if (result.Diagnostics.Count == 0)
        {
            Assert.False(Nested(Section(result), false));
        }
        else
        {
            Assert.Empty(result.Files);
        }
    }

    [Fact]
    public void ACompiledTermIsSchemaValid() =>
        Assert.Null(Repository.Schema.Validate(CompiledTerm().Document.ToJsonString()));

    [Theory]
    [InlineData("link", "")]
    [InlineData("link", "em")]
    [InlineData("link", "strong em")]
    [InlineData("term", "")]
    [InlineData("term", "em")]
    [InlineData("term", "strong em")]
    public void ALinkOrTermAtAnyDepthInsideATermIsASchemaViolation(string kind, string wrappers)
    {
        var (document, term) = CompiledTerm();
        term["content"]!.AsArray().Add(Wrapped(Opener(kind), wrappers));

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    [Theory]
    [InlineData("")]
    [InlineData("em")]
    [InlineData("strong em")]
    public void ATermAtAnyDepthInsideALinkIsASchemaViolation(string wrappers)
    {
        var (document, term) = CompiledTerm();
        var link = new JsonObject { ["type"] = "link", ["kind"] = "anchor", ["id"] = "syn-a", ["content"] = Text("a") };
        link["content"]!.AsArray().Add(Wrapped(Opener("term"), wrappers));
        var paragraph = term.Parent!.AsArray();
        paragraph[paragraph.IndexOf(term)] = link;

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    [Theory]
    [InlineData("id", "syn-a")]
    [InlineData("id", "err-a")]
    [InlineData("id", "term-")]
    [InlineData("id", "term-a\n")]
    [InlineData("short", "")]
    [InlineData("chapter", "ch-test")]
    [InlineData("kind", "anchor")]
    public void ATermFieldOutsideItsGrammarIsASchemaViolation(string field, string value)
    {
        var (document, term) = CompiledTerm();
        term[field] = value;

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    [Fact]
    public void ATermWithoutItsShortTextOrWithAnOverlongOneIsASchemaViolation()
    {
        var (missing, without) = CompiledTerm();
        without.Remove("short");
        var (overlong, longer) = CompiledTerm();
        longer["short"] = new string('a', 201);
        var (longest, atLimit) = CompiledTerm();
        atLimit["short"] = new string('a', 200);

        Assert.NotNull(Repository.Schema.Validate(missing.ToJsonString()));
        Assert.NotNull(Repository.Schema.Validate(overlong.ToJsonString()));
        Assert.Null(Repository.Schema.Validate(longest.ToJsonString()));
    }

    private static JsonArray Text(string text) => new(new JsonObject { ["type"] = "text", ["text"] = text });

    private static JsonObject Opener(string kind) => string.Equals(kind, "link", StringComparison.Ordinal)
        ? new JsonObject { ["type"] = "link", ["kind"] = "anchor", ["id"] = "syn-a", ["content"] = Text("b") }
        : new JsonObject { ["type"] = "term", ["id"] = "term-a", ["short"] = "s", ["content"] = Text("b") };

    private static JsonNode Wrapped(JsonNode inner, string wrappers)
    {
        foreach (var wrapper in wrappers.Split(' ', StringSplitOptions.RemoveEmptyEntries).Reverse())
        {
            inner = new JsonObject { ["type"] = wrapper, ["content"] = new JsonArray(inner) };
        }

        return inner;
    }

    private static (JsonNode Document, JsonObject Term) CompiledTerm()
    {
        var result = Run(("glossary/term-a.md", Glossary), (Part, PartHead + "Use the [term](#term-a) here.\n"));
        Assert.Empty(result.Diagnostics);
        var document = Json(result, Part.Replace(".md", ".json", StringComparison.Ordinal));
        return (document, document["sections"]![0]!["body"]![0]!["content"]![1]!.AsObject());
    }

    // True when a link or Term sits at any depth inside another link or Term.
    private static bool Nested(JsonNode? node, bool inside)
    {
        switch (node)
        {
            case JsonArray array:
                return array.Any(item => Nested(item, inside));
            case JsonObject obj:
                var type = obj["type"]?.GetValueKind() == System.Text.Json.JsonValueKind.String ? (string?)obj["type"] : null;
                var opens = type is "link" or "term";
                if (opens && inside)
                {
                    return true;
                }

                return obj.Any(pair => Nested(pair.Value, inside || opens));
            default:
                return false;
        }
    }

    private static List<string> Segments(JsonNode section) =>
        [.. section["spoken"]!["segments"]!.AsArray().Select(s => (string)s!["text"]!)];

    private static JsonNode Section(CompileResult result)
    {
        Assert.Empty(result.Diagnostics);
        return Sections(result)[0];
    }

    private static List<JsonNode> Sections(CompileResult result) =>
        [.. Json(result, "chapters/c/part.json")["sections"]!.AsArray().Select(s => s!)];

    private static JsonNode Json(CompileResult result, string path) =>
        JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, path, StringComparison.Ordinal)).Bytes)!;

    private static void Refused(string expected, params (string Path, string Text)[] files)
    {
        var result = Run(files);

        Assert.Contains(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    // A chapter and a plain part stand beside the files under test unless a test writes its own.
    private static CompileResult Run(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        (string Path, string Text)[] basis = [("chapters/c/chapter.md", Chapter), (Part, PartHead + "Text.\n")];
        foreach (var (path, text) in basis.Where(b => !files.Any(f => string.Equals(f.Path, b.Path, StringComparison.Ordinal))).Concat(files))
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return Repository.Compile(folder.Path);
    }
}
