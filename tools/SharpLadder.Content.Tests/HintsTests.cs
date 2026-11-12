using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Hints: ladders whose cues alone are public, and a catalogue that holds nothing they hide.
public sealed class HintsTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string Patterns = "patterns:\n  - id: pat-hidden-tally\n    title: Hidden Tally Title\n    summary: Hidden summary.\n  - id: pat-other\n    title: Other title\n    summary: Other summary.\n";
    private const string Head = "---\nkind: hints\nchapter: ch-test\norder: 2\n---\n\n";
    private const string Alpha = "## Hidden heading {#ladder-alpha}\n\ncue: Public cue one.\npattern: pat-hidden-tally\napproach: secret approach\n\n1. {#r1} First *hidden* rung.\n2. {#r2} Second `code` **rung**.\n";
    private const string Beta = "\n## Other heading {#ladder-beta}\n\ncue: Public cue two.\npattern: pat-other\napproach: second way\n\n1. {#r1} Only rung.\n";
    private const string Part = "chapters/c/hints.md";
    private const string Syntax = "chapters/c/syntax.md";
    private const string SyntaxHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## Title {#syn-a}\n\n";

    // Every string a ladder hides, each of which its catalogue must leave out.
    private static readonly string[] Hidden =
    [
        "Hidden heading", "Other heading", "secret approach", "second way", "pat-hidden-tally", "pat-other",
        "Hidden Tally Title", "Other title", "First", "hidden", "Second", "code", "Only rung", "r1", "r2",
        "rungs", "pattern", "approach", "title",
    ];

    [Fact]
    public void AHintsPartCompilesToItsFullRecordAndACatalogueOfCuesAlone()
    {
        var result = Run((Part, Head + Alpha + Beta));

        Assert.Empty(result.Diagnostics);
        var full = Json(result, "chapters/c/hints.json");
        Assert.Equal(
            """{"id":"ladder-alpha","title":[{"type":"text","text":"Hidden heading"}],"cue":{"blockId":"ladder-alpha/b1","text":"Public cue one."},"pattern":"pat-hidden-tally","approach":"secret approach","rungs":[{"id":"r1","content":[{"type":"text","text":"First "},{"type":"em","content":[{"type":"text","text":"hidden"}]},{"type":"text","text":" rung."}]},{"id":"r2","content":[{"type":"text","text":"Second "},{"type":"code","text":"code"},{"type":"text","text":" "},{"type":"strong","content":[{"type":"text","text":"rung"}]},{"type":"text","text":"."}]}]}""",
            full["sections"]![0]!.ToJsonString());
        Assert.DoesNotContain("\"spoken\"", full.ToJsonString(), StringComparison.Ordinal);

        var catalogue = Json(result, "chapters/c/hints.catalogue.json");
        Assert.Equal("hints-catalogue", (string)catalogue["type"]!);
        Assert.Equal("ladder-alpha,ladder-beta", string.Join(',', catalogue["ladders"]!.AsArray().Select(l => (string)l!["id"]!)));
        var first = catalogue["ladders"]![0]!;
        Assert.Equal("""{"blockId":"ladder-alpha/b1","text":"Public cue one."}""", first["cue"]!.ToJsonString());
        Assert.Equal(
            """[{"target":{"type":"block","blockId":"ladder-alpha/b1"},"text":"Public cue one."}]""",
            first["spoken"]!["segments"]!.ToJsonString());
        Assert.StartsWith("sha256:", (string)first["spoken"]!["audio"]!, StringComparison.Ordinal);
        var text = catalogue.ToJsonString();
        Assert.All(Hidden, hidden => Assert.DoesNotContain(hidden, text, StringComparison.Ordinal));
    }

    [Fact]
    public void TheCatalogueIsItsOwnKindAndThePartStatesItsPartKind()
    {
        var result = Run((Part, Head + Alpha));

        var part = result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/hints.json", StringComparison.Ordinal));
        var catalogue = result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/hints.catalogue.json", StringComparison.Ordinal));
        Assert.Equal(RecordKind.Part, part.Kind);
        Assert.Equal("hints", part.Part);
        Assert.Equal(RecordKind.HintsCatalogue, catalogue.Kind);
        Assert.Null(catalogue.Part);
    }

    [Fact]
    public void AnIdOfOnlyIgnoredWordsSharesNothing() =>
        Assert.Empty(Run((Part, Head + Alpha.Replace("ladder-alpha", "ladder-a-for-the-of", StringComparison.Ordinal))).Diagnostics);

    [Theory]
    [InlineData("## H {#hint-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "ladder id \"hint-a\" must start with ladder-")]
    [InlineData("## H {#ladder-a spoken=\"S\"}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "a ladder heading takes its {#id} and nothing else")]
    [InlineData("## See [it](#syn-a) {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "a ladder heading holds text, code, *em* and **strong** only")]
    [InlineData("Text first.\n\n" + "## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "a part file holds nothing before its first ## heading")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\n\n1. {#r1} R.\n", "a hints section is its ## heading, then the lines cue:, pattern: and approach: in that order")]
    [InlineData("## H {#ladder-a}\n\npattern: pat-other\ncue: C.\napproach: way\n\n1. {#r1} R.\n", "a hints section is its ## heading")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\n\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "a hints section is its ## heading")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n- {#r1} R.\n", "a hints section is its ## heading")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n\nMore text.\n", "a hints section is its ## heading")]
    [InlineData("## H {#ladder-a}\n\ncue: A *marked* cue.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "the cue, pattern and approach lines are plain text")]
    [InlineData("## H {#ladder-a}\n\ncue: C.  \npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "the cue, pattern and approach lines are plain text")]
    [InlineData("## H {#ladder-a}\n\ncue:\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "the cue line holds no text")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: hash set\napproach: way\n\n1. {#r1} R.\n", "pattern \"hash set\" is no pattern id; name one from patterns.yml")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-missing\napproach: way\n\n1. {#r1} R.\n", "chapters/c/hints.md:10: pattern \"pat-missing\" is not in patterns.yml")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. R.\n", "a rung is one paragraph that starts with its id: 1. {#r1} text")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#a1} R.\n", "a rung is one paragraph that starts with its id")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1}R.\n", "a rung is one paragraph that starts with its id")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n\n   More.\n", "a rung is one paragraph that starts with its id")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n2. {#r1} S.\n", "rung id \"r1\" is used twice in ladder \"ladder-a\"")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n2. {#r1} R.\n", "a rung list starts at 1")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} See [it](#syn-a).\n", "a rung holds text, code, *em* and **strong** only")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} A [term](#term-a).\n", "a rung holds text, code, *em* and **strong** only")]
    [InlineData("## H {#ladder-a}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} &#32;\n", "a rung holds text")]
    [InlineData("## H {#ladder-secret-x}\n\ncue: C.\npattern: pat-hidden-tally\napproach: secret approach\n\n1. {#r1} R.\n", "ladder id \"ladder-secret-x\" shares \"secret\" with its approach, pattern id or pattern title, which stay hidden")]
    [InlineData("## H {#ladder-x-tally}\n\ncue: C.\npattern: pat-hidden-tally\napproach: way\n\n1. {#r1} R.\n", "ladder id \"ladder-x-tally\" shares \"tally\" with its approach")]
    [InlineData("## H {#ladder-title-of-x}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {#r1} R.\n", "ladder id \"ladder-title-of-x\" shares \"title\" with its approach")]
    public void AHintsPartOutsideItsRulesIsRefused(string text, string expected) =>
        Refused(expected, ("glossary/term-a.md", "---\nid: term-a\nterm: A term\nshort: S.\n---\n"), (Part, Head + text));

    [Fact]
    public void ARungIdLongerThanTheLimitIsRefused() =>
        Refused(
            $"rung id \"r{new string('1', 48)}\" is longer than 48 characters",
            (Part, Head + $"## H {{#ladder-a}}\n\ncue: C.\npattern: pat-other\napproach: way\n\n1. {{#r{new string('1', 48)}}} R.\n"));

    [Fact]
    public void OnlyALadderTakesTheLadderPrefix() =>
        Refused("id \"ladder-x\" starts with ladder-, which only a ladder id may", (Part, Head + Alpha), (Syntax, SyntaxHead + "Text.\n\n## Other {#ladder-x}\n\nText.\n"));

    [Fact]
    public void ALadderIdIsUniqueSiteWide() =>
        Refused("duplicate id \"ladder-alpha\"", (Part, Head + Alpha + Alpha.Replace("## Hidden heading", "\n## Again", StringComparison.Ordinal)));

    // The registry refuses the repeated id, and the word rule still reads both of its titles.
    [Fact]
    public void ALadderOnARepeatedPatternIdIsReportedWithoutACrash()
    {
        var patterns = "patterns:\n  - { id: pat-twice, title: First, summary: S }\n  - { id: pat-twice, title: Second sweep, summary: S }\n";
        var text = Head + "## H {#ladder-sweep-x}\n\ncue: C.\npattern: pat-twice\napproach: way\n\n1. {#r1} R.\n";
        Refused("patterns.yml:3: duplicate id \"pat-twice\" (first used at patterns.yml:2)", ("patterns.yml", patterns), (Part, text));
        Refused("ladder id \"ladder-sweep-x\" shares \"sweep\" with its approach", ("patterns.yml", patterns), (Part, text));
    }

    // Opening a ladder is a reveal, so nothing may lead to one until reveals exist.
    [Fact]
    public void NoLinkSeeOrAliasLeadsToALadder()
    {
        Refused("link target \"#ladder-alpha\" names the ladder \"ladder-alpha\", which cannot be linked", (Part, Head + Alpha), (Syntax, SyntaxHead + "See [it](#ladder-alpha).\n"));
        Refused("see names \"ladder-alpha\"", (Part, Head + Alpha), ("glossary/term-a.md", "---\nid: term-a\nterm: A term\nshort: S.\nsee: [ladder-alpha]\n---\n"));
        Refused("ends at \"ladder-alpha\", which is not a section id", (Part, Head + Alpha), ("aliases.yml", "slugs: {}\nids:\n  old-x: ladder-alpha\n"));
    }

    private static JsonNode Json(CompileResult result, string path) =>
        JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, path, StringComparison.Ordinal)).Bytes)!;

    private static void Refused(string expected, params (string Path, string Text)[] files)
    {
        var result = Run(files);

        Assert.Contains(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    // A chapter, a plain part and the pattern registry stand beside the files under test.
    private static CompileResult Run(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        (string Path, string Text)[] basis = [("chapters/c/chapter.md", Chapter), (Syntax, SyntaxHead + "Text.\n"), ("patterns.yml", Patterns)];
        foreach (var (path, text) in basis.Where(b => !files.Any(f => string.Equals(f.Path, b.Path, StringComparison.Ordinal))).Concat(files))
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return Repository.Compile(folder.Path);
    }
}
