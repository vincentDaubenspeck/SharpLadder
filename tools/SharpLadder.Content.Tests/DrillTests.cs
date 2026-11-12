using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Drill: one section per ramp rung, its prose, then the labelled drills in recommended order.
public sealed class DrillTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string Head = "---\nkind: drill\nchapter: ch-test\norder: 2\n---\n\n";
    private const string Warm = "## One idea {#ramp-warm rung=warm-up}\n\nEach drill uses one idea.\n\n1. [Count the letters](#drill-count)\n2. [Find a first pair](#drill-pair)\n";
    private const string Easy = "\n## Two ideas {#ramp-easy rung=easy}\n\nFirst paragraph.\n\nSecond paragraph.\n\n1. [Join two lists](#drill-join)\n";
    private const string Part = "chapters/c/drill.md";
    private const string Syntax = "chapters/c/syntax.md";
    private const string SyntaxHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## Title {#syn-a}\n\n";

    [Fact]
    public void ADrillPartCompilesToRungsWithProseAndLabelledDrills()
    {
        var result = Run((Part, Head + Warm + Easy));

        Assert.Empty(result.Diagnostics);
        var part = Json(result, "chapters/c/drill.json");
        Assert.Equal("drill", (string)part["kind"]!);
        var first = part["sections"]![0]!;
        Assert.Equal("ramp-warm,2.1,warm-up", string.Join(',', (string)first["id"]!, (string)first["number"]!, (string)first["rung"]!));
        Assert.Equal(
            """{"blockId":"ramp-warm/b2","items":[{"blockId":"ramp-warm/b2.i1","id":"drill-count","label":"Count the letters"},{"blockId":"ramp-warm/b2.i2","id":"drill-pair","label":"Find a first pair"}]}""",
            first["drills"]!.ToJsonString());
        Assert.Equal(
            """[{"target":{"type":"block","blockId":"ramp-warm/b1"},"text":"Each drill uses one idea."},{"target":{"type":"block","blockId":"ramp-warm/b2.i1"},"text":"Count the letters"},{"target":{"type":"block","blockId":"ramp-warm/b2.i2"},"text":"Find a first pair"}]""",
            first["spoken"]!["segments"]!.ToJsonString());
        var second = part["sections"]![1]!;
        Assert.Equal("ramp-easy/b3", (string)second["drills"]!["blockId"]!);
        Assert.Equal(2, second["body"]!.AsArray().Count);
        Assert.Equal(
            "id,number,title,rung,body,drills,spoken",
            string.Join(',', first.AsObject().Select(p => p.Key)));
    }

    [Fact]
    public void TheDrillPartStatesItsPartKind()
    {
        var result = Run((Part, Head + Warm));

        var part = result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/drill.json", StringComparison.Ordinal));
        Assert.Equal(RecordKind.Part, part.Kind);
        Assert.Equal("drill", part.Part);
    }

    [Fact]
    public void AbsentRungsAreLeftOutAndEveryRungMayStandAlone()
    {
        foreach (var rung in new[] { "foundations", "warm-up", "easy", "medium", "hard" })
        {
            Assert.Empty(Run((Part, Head + $"## R {{#ramp-a rung={rung}}}\n\nProse.\n\n1. [Label](#drill-a)\n")).Diagnostics);
        }

        Assert.Empty(Run((Part, Head + "## A {#ramp-a rung=foundations}\n\nP.\n\n1. [L](#drill-a)\n\n## B {#ramp-b rung=hard}\n\nP.\n\n1. [L](#drill-b)\n")).Diagnostics);
    }

    [Theory]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n\n## B {#ramp-b rung=warm-up}\n\nP.\n\n1. [L](#drill-b)\n", "rung \"warm-up\" comes after \"easy\"; rungs follow the ramp order foundations, warm-up, easy, medium, hard")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n\n## B {#ramp-b rung=easy}\n\nP.\n\n1. [L](#drill-b)\n", "rung \"easy\" is used twice in this drill part")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n\n## B {#ramp-b rung=hard}\n\nP.\n\n1. [L](#drill-b)\n\n## C {#ramp-c rung=easy}\n\nP.\n\n1. [L](#drill-c)\n", "rung \"easy\" is used twice in this drill part")]
    [InlineData("## A {#ramp-a rung=tricky}\n\nP.\n\n1. [L](#drill-a)\n", "rung \"tricky\" is not a ramp rung; write one of foundations, warm-up, easy, medium, hard")]
    [InlineData("## A {#ramp-a rung=Easy}\n\nP.\n\n1. [L](#drill-a)\n", "rung \"Easy\" is not a ramp rung")]
    [InlineData("## A {#ramp-a}\n\nP.\n\n1. [L](#drill-a)\n", "a drill section heading is written ## Title {#id rung=name}, with nothing else beside the id")]
    [InlineData("## A {#ramp-a rung=easy speech=skip spoken=\"S\"}\n\nP.\n\n1. [L](#drill-a)\n", "a drill section heading is written ## Title {#id rung=name}")]
    [InlineData("## A {#ramp-a rung}\n\nP.\n\n1. [L](#drill-a)\n", "a drill section heading is written ## Title {#id rung=name}")]
    [InlineData("## A {#ramp-a rung=easy}\n\n1. [L](#drill-a)\n", "a drill section is its ## heading, at least one paragraph of prose, then one ordered list of drill links")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n", "a drill section is its ## heading, at least one paragraph of prose")]
    [InlineData("## A {#ramp-a rung=easy}\n", "a drill section is its ## heading, at least one paragraph of prose")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n- [L](#drill-a)\n", "a drill section is its ## heading, at least one paragraph of prose")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n\nAfter.\n", "a drill section is its ## heading, at least one paragraph of prose")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n2. [L](#drill-a)\n", "a drill list starts at 1")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. Text and [L](#drill-a)\n", "a drill list item is one link and nothing else: 1. [label](#drill-id)")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a) and text\n", "a drill list item is one link and nothing else")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n\n   More.\n", "a drill list item is one link and nothing else")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. Plain text\n", "a drill list item is one link and nothing else")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#syn-a)\n", "drill link target \"#syn-a\" names no drill; write [label](#drill-id)")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](ch-test#drill-a)\n", "drill link target \"ch-test#drill-a\" names no drill")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-)\n", "drill link target \"#drill-\" names no drill")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#Drill-a)\n", "is not an internal target")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](https://example.com/drill-a)\n", "is not an internal target")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [`code` label](#drill-a)\n", "a drill label is plain text")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [A *marked* label](#drill-a)\n", "a drill label is plain text")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [&#32;](#drill-a)\n", "a drill label is plain text")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n2. [M](#drill-a)\n", "drill \"drill-a\" is listed twice in this drill part")]
    [InlineData("## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n\n## B {#ramp-b rung=hard}\n\nP.\n\n1. [M](#drill-a)\n", "drill \"drill-a\" is listed twice in this drill part")]
    [InlineData("## A {#drill-x rung=easy}\n\nP.\n\n1. [L](#drill-a)\n", "id \"drill-x\" starts with drill-, which only a drill file may")]
    [InlineData("Text first.\n\n## A {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n", "a part file holds nothing before its first ## heading")]
    [InlineData("## {#ramp-a rung=easy}\n\nP.\n\n1. [L](#drill-a)\n", "a drill section title holds text")]
    public void ADrillPartOutsideItsRulesIsRefused(string text, string expected) =>
        Refused(expected, (Part, Head + text));

    [Fact]
    public void OnlyADrillFileTakesTheDrillPrefix() =>
        Refused("id \"drill-x\" starts with drill-, which only a drill file may", (Part, Head + Warm), (Syntax, SyntaxHead + "Text.\n\n## Other {#drill-x}\n\nText.\n"));

    // Drill files arrive in a later stage, so an ordinary link to one has nothing to reach yet.
    [Fact]
    public void AnOrdinaryLinkToADrillIsRefused() =>
        Assert.NotEmpty(Run((Part, Head + Warm), (Syntax, SyntaxHead + "See [it](#drill-count).\n")).Diagnostics);

    private static JsonNode Json(CompileResult result, string path) =>
        JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, path, StringComparison.Ordinal)).Bytes)!;

    private static void Refused(string expected, params (string Path, string Text)[] files)
    {
        var result = Run(files);

        Assert.Contains(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    // A chapter and a plain part stand beside the files under test.
    private static CompileResult Run(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        (string Path, string Text)[] basis = [("chapters/c/chapter.md", Chapter), (Syntax, SyntaxHead + "Text.\n")];
        foreach (var (path, text) in basis.Where(b => !files.Any(f => string.Equals(f.Path, b.Path, StringComparison.Ordinal))).Concat(files))
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return Repository.Compile(folder.Path);
    }
}
