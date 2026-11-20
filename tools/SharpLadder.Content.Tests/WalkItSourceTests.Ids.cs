using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <content>
/// Walk ids across the site: the walk prefix is reserved for them, each is registered with every
/// other id, and a retired one is aliased by the rules that hold for section ids.
/// </content>
public sealed partial class WalkItSourceTests
{
    private const string Other = "---\nid: ch-other\nslug: other\ntitle: Other\norder: 2\ntargets: { csharp: 14, dotnet: 10 }\n---\n\nIntro text.\n\n";
    private const string OtherPart = "---\nkind: syntax\nchapter: ch-other\norder: 1\n---\n\n## Title {#syn-b}\n\nText.\n";
    private const string Build = "---\nkind: build\nchapter: ch-test\norder: 2\n---\n\n## Build {#build-a}\n\n";
    private const string SecondWay = "### Second way {#build-two approach=\"two\"}\n\nTwo text.\n\n";

    public static TheoryData<string, string> RefusedBlocks() => new()
    {
        { "cells: [!![\n#", "12: walk-it block is not valid YAML: its structure could not be read here" },
        { Walk(step: "{ dst: 2, src: 2, note: Copy. }"), "18: " + SelfCopy(2) },
    };

    [Fact]
    public void AWalkIdIsAnAnchorOnItsPage()
    {
        var result = Site(("chapters/c/chapter.md", Chapter.Replace("Intro text.", "Intro [text](#walk-shift).", StringComparison.Ordinal) + Fence(Walk())));

        Assert.Empty(result.Diagnostics);
        Assert.NotEmpty(result.Files);
    }

    // The control for the anchor above: the walk id is live on another page, and this valid page holds the link.
    [Fact]
    public void AWalkIdIsNoAnchorOnAnotherPage()
    {
        var result = Site(("chapters/c/part.md", Part.Replace("Text.", "[Text](#walk-shift).", StringComparison.Ordinal)));

        Assert.Equal("chapters/c/part.md:9: link target \"#walk-shift\" names no section or block id in this file", Shown(result));
        Assert.Empty(result.Files);
    }

    // A see list names whole pages and entries, so a live walk id is not one; syn-a is the control.
    [Theory]
    [InlineData("syn-a", "")]
    [InlineData("walk-shift", "glossary/term-a.md:5: see names \"walk-shift\", which is no live section, chapter, card, glossary entry or error entry")]
    public void AWalkIdIsNotASeeTarget(string see, string expected)
    {
        var result = Site(("glossary/term-a.md", $"---\nid: term-a\nterm: A\nshort: S.\nsee: [{see}]\n---\n\nBody.\n"));

        Assert.Equal(expected, Shown(result));
        Assert.Equal(expected.Length == 0, result.Files.Count > 0);
    }

    [Fact]
    public void AWalkIdTwiceInOneFileIsRefused()
    {
        var result = Site(("chapters/c/chapter.md", Chapter + Fence(Walk()) + "\n" + Fence(Walk())));

        Assert.Equal(Path + "21: duplicate id \"walk-shift\" (first used at " + Path + "11)", Shown(result));
        Assert.Empty(result.Files);
    }

    [Fact]
    public void AWalkIdInTwoChaptersIsRefused()
    {
        var result = Site(("chapters/d/chapter.md", Other + Fence(Walk())), ("chapters/d/part.md", OtherPart));

        Assert.Equal("chapters/d/chapter.md:11: duplicate id \"walk-shift\" (first used at " + Path + "11)", Shown(result));
        Assert.Empty(result.Files);
    }

    [Theory]
    [InlineData("chapters/c/part.md", Part + "\n## Walk {#walk-free}\n\nText.\n", 11)]
    [InlineData("chapters/c/part.md", Part + "\n```csharp {#walk-free group=g spoken=\"S\"}\nx();\n```\n", 11)]
    [InlineData("chapters/c/build.md", Build + "### First way {#walk-free approach=\"one\"}\n\nOne text.\n\n" + SecondWay, 9)]
    public void AnIdOfAnotherKindMayNotTakeTheWalkPrefix(string path, string text, int line)
    {
        var result = Site((path, text));

        Assert.Equal($"{path}:{line}: id \"walk-free\" starts with walk-, which only a walk-it block may", Shown(result));
        Assert.Empty(result.Files);
    }

    [Fact]
    public void TheWalkPrefixIsReservedWhenNoWalkItIsWritten()
    {
        var result = Site(("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", Part + "\n## Walk {#walk-free}\n\nText.\n"));

        Assert.Equal("chapters/c/part.md:11: id \"walk-free\" starts with walk-, which only a walk-it block may", Shown(result));
        Assert.Empty(result.Files);
    }

    // The walk id is live, so the prefix rule passes and the repeat is what refuses, as for cards.
    [Theory]
    [InlineData("\n## Walk {#walk-shift}\n\nText.\n")]
    [InlineData("\n```csharp {#walk-shift group=g spoken=\"S\"}\nx();\n```\n")]
    public void AnotherIdThatRepeatsAWalkIdIsRefusedAsARepeat(string more)
    {
        var result = Site(("chapters/c/part.md", Part + more));

        Assert.Equal("chapters/c/part.md:11: duplicate id \"walk-shift\" (first used at " + Path + "11)", Shown(result));
        Assert.Empty(result.Files);
    }

    [Theory]
    [InlineData("  walk-old: walk-shift\n", """{"walk-old":"walk-shift"}""")]
    [InlineData("  walk-older: walk-old\n  walk-old: walk-shift\n", """{"walk-old":"walk-shift","walk-older":"walk-shift"}""")]
    [InlineData("  walk-old: walk-shift\n  old-title: syn-a\n", """{"old-title":"syn-a","walk-old":"walk-shift"}""")]
    public void ARetiredWalkIdEndsAtALiveWalkId(string ids, string expected)
    {
        var result = Site(("aliases.yml", "slugs: {}\nids:\n" + ids));

        Assert.Empty(result.Diagnostics);
        var record = JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, Registries.AliasesOutput, StringComparison.Ordinal)).Bytes)!;
        Assert.Equal(expected, record["ids"]!.ToJsonString());
    }

    [Theory]
    [InlineData("  walk-shift: walk-new\n", "aliases.yml:3: \"walk-shift\" is in use, so it cannot be retired")]
    [InlineData("  walk-old: walk-gone\n", "aliases.yml:3: \"walk-old\" ends at \"walk-gone\", which is not a walk id")]
    [InlineData("  walk-old: syn-a\n", "aliases.yml:3: \"walk-old\" ends at \"syn-a\", which is not a walk id")]
    [InlineData("  walk-old: old-title\n  old-title: syn-a\n", "aliases.yml:3: \"walk-old\" ends at \"syn-a\", which is not a walk id")]
    [InlineData("  old-title: walk-shift\n", "aliases.yml:3: \"old-title\" ends at \"walk-shift\", which is not a section id")]
    [InlineData("  walk-: syn-a\n", "aliases.yml:3: \"walk-\" ends at \"syn-a\", which is not a walk id")]
    [InlineData("  walk-a: walk-b\n  walk-b: walk-a\n", "aliases.yml:3: \"walk-a\" leads back to \"walk-a\"")]
    public void AWalkAliasIsHeldToTheRulesOfASectionAlias(string ids, string expected)
    {
        var result = Site(("aliases.yml", "slugs: {}\nids:\n" + ids));

        Assert.Contains(expected, Shown(result), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    [Fact]
    public void ALinkToARetiredWalkIdIsRefusedAndNamesItsEnd()
    {
        var result = Site(
            ("chapters/c/chapter.md", Chapter.Replace("Intro text.", "Intro [text](#walk-old).", StringComparison.Ordinal) + Fence(Walk())),
            ("aliases.yml", "slugs: {}\nids:\n  walk-old: walk-shift\n"));

        Assert.Equal(Path + "9: link target \"#walk-old\" names the retired id \"walk-old\"; link to \"walk-shift\"", Shown(result));
        Assert.Empty(result.Files);
    }

    // A read refusal stops link checks, so an unresolved link on another page adds no diagnostic.
    [Theory]
    [MemberData(nameof(RefusedBlocks))]
    public void ARefusedWalkItStopsBeforeLinksAreChecked(string refused, string expected)
    {
        var linked = Chapter.Replace("Intro text.", "Intro [text](#walk-shift).", StringComparison.Ordinal);
        var other = ("chapters/d/chapter.md", Other + Fence(refused));
        var otherPart = ("chapters/d/part.md", OtherPart);

        var noBlock = Site(("chapters/c/chapter.md", linked), other, otherPart);

        Assert.Equal("chapters/d/chapter.md:" + expected, Shown(noBlock));
        Assert.Empty(noBlock.Files);
    }

    // Two compiles of one accepted site, each from its own folder, give the same files byte for byte.
    [Fact]
    public void AnAcceptedWalkItCompilesToTheSameFilesTwice()
    {
        var aliases = ("aliases.yml", "slugs: {}\nids:\n  walk-old: walk-shift\n");
        var first = Site(aliases);
        var second = Site(aliases);

        Assert.Empty(first.Diagnostics);
        Assert.Contains(first.Files, f => Encoding.UTF8.GetString(f.Bytes).Contains("\"walk-it\"", StringComparison.Ordinal));
        Assert.Equal(Listed(first), Listed(second));

        static string Listed(CompileResult result) => string.Join('\n', result.Files.Select(f => f.RelativePath + " " + Convert.ToBase64String(f.Bytes)));
    }

    // The accepted chapter with its walk-it in the intro, with any file replaced or added.
    private static CompileResult Site(params (string Path, string Text)[] files)
    {
        var all = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["chapters/c/chapter.md"] = Chapter + Fence(Walk()),
            ["chapters/c/part.md"] = Part,
            ["aliases.yml"] = "slugs: {}\nids: {}\n",
            ["patterns.yml"] = "patterns: []\n",
        };
        foreach (var (path, text) in files)
        {
            all[path] = text;
        }

        using var folder = new TempFolder();
        foreach (var (path, text) in all)
        {
            folder.Write(path, text);
        }

        return ContentCompiler.Compile(folder.Path, Repository.Schema, folder.Path);
    }
}
