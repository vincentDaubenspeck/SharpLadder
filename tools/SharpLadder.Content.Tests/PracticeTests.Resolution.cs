using System.Text;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <content>What a practice record names, the drill part's links to the drill files, and practice/problems.yml with its index mode.</content>
public sealed partial class PracticeTests
{
    private const string DrillPartPath = "chapters/c/drill.md";
    private const string DrillPart = "---\nkind: drill\nchapter: ch-test\norder: 2\n---\n\n## One idea {#ramp-a rung=warm-up}\n\nEach drill uses one idea.\n\n1. [Count letters](#drill-a)\n";
    private const string Review = "  count: 2\n  review:\n    one: { sectionId: ramp-a, label: L, walkId: walk-x }\n";
    private const string Walk = "\n```walk-it {#walk-x}\ntitle: Count one more\ncells: [0]\nsequences:\n  - name: once\n    intro: The count starts at zero.\n"
        + "    steps:\n      - { dst: 0, value: 1, note: One item is counted. }\n```\n";

    public static TheoryData<string, string, string, string> ResolutionRefusals() => new()
    {
        { ProblemPath, "ladders: [ladder-a]", "ladders: [ladder-zz]", $"{ProblemPath}:8: ladders names \"ladder-zz\", which is no ladder" },
        { ProblemPath, "patternTags: [pat-a]", "patternTags: [pat-zz]", $"{ProblemPath}:7: patternTags names \"pat-zz\", which is no pattern in patterns.yml" },
        { ProblemPath, "chapter: ch-test", "chapter: ch-zz", $"{ProblemPath}:3: chapter names \"ch-zz\", which is no chapter" },
        { DrillPath, "ideas: [term-a]", "ideas: [term-zz]", $"{DrillPath}:7: ideas names \"term-zz\", which is no glossary entry" },
        { DrillPath, "prerequisites: []", "prerequisites: [drill-zz]", $"{DrillPath}:8: prerequisites names \"drill-zz\", which is no drill file" },
        { DrillPath, "prepares: [prob-0001]", "prepares: [prob-0002]", $"{DrillPath}:9: prepares names \"prob-0002\", which is no problem file" },
        { DrillPath, "variationOf: null", "variationOf: drill-zz", $"{DrillPath}:10: variationOf names \"drill-zz\", which is no drill file" },
        { DrillPath, "prepares: [prob-0001]", "prepares: []", $"{DrillPath}:9: prepares names nothing; a warm-up drill prepares at least one problem, and only a foundations drill may prepare none" },
        { DrillPath, "prerequisites: []", "prerequisites: [drill-a]", $"{DrillPath}:8: prerequisites form a cycle: drill-a -> drill-a" },
        { DrillPartPath, "(#drill-a)", "(#drill-zz)", $"{DrillPartPath}:11: drill link target \"#drill-zz\" names no drill file\n{DrillPath}:3: drill \"drill-a\" is listed in no drill part of the chapter \"ch-test\"; list it once under the rung warm-up" },
        { DrillPartPath, "rung=warm-up", "rung=easy", $"{DrillPartPath}:11: drill \"drill-a\" is a warm-up drill, listed under the rung easy" },
        { ProblemPath, "  count: 2\n", "  count: 2\n  review:\n    one: { sectionId: sec-zz, label: L }\n", $"{ProblemPath}:9: tests.review \"one\" sectionId \"sec-zz\" names no section" },
        { IndexPath, "Vowel words", "Old words", $"{IndexPath}: the problem index differs from the problem files; write the output of SharpLadder.Content index <schema folder> <content root> to it" },
    };

    [Theory]
    [MemberData(nameof(ResolutionRefusals))]
    public void ANameThatDoesNotResolveIsRefused(string path, string from, string to, string expected) =>
        Exactly(expected, (path, Basis.Single(b => string.Equals(b.Path, path, StringComparison.Ordinal)).Text!.Replace(from, to, StringComparison.Ordinal)));

    // A link that names the record's own chapter must name an anchor of the file, as a bare one must.
    [Theory]
    [InlineData(ProblemPath, 19, "#sec-definitely-missing")]
    [InlineData(ProblemPath, 19, "ch-test#sec-definitely-missing")]
    [InlineData(DrillPath, 21, "#sec-definitely-missing")]
    [InlineData(DrillPath, 21, "ch-test#sec-definitely-missing")]
    public void AnOwnChapterLinkToNoAnchorIsRefused(string path, int line, string target) =>
        Exactly(
            $"{path}:{line}: link target \"{target}\" names no section or block id in this file",
            (path, Basis.Single(b => string.Equals(b.Path, path, StringComparison.Ordinal)).Text!.Replace("start with a vowel.", $"start with a vowel. See [missing]({target}).", StringComparison.Ordinal)));

    [Fact]
    public void TwoLaddersOfASubjectWithOneApproachLabelAreRefused()
    {
        var second = "\n## Track what came back {#ladder-b}\n\ncue: You want the earliest word seen once.\npattern: pat-a\napproach: Tally first\n\n1. {#r1} Which words came back?\n";

        Exactly(
            $"{ProblemPath}:8: ladders \"ladder-a\" and \"ladder-b\" share the approach label \"Tally first\"; each ladder of a subject needs its own",
            ("chapters/c/hints.md", PracticeClosure.Hints + second),
            (ProblemPath, Problem.Replace("ladders: [ladder-a]", "ladders: [ladder-a, ladder-b]", StringComparison.Ordinal)));
    }

    [Fact]
    public void APrerequisiteCycleIsRefusedOnce() =>
        Exactly(
            $"{DrillPath}:8: prerequisites form a cycle: drill-a -> drill-b -> drill-a",
            (DrillPath, Drill.Replace("prerequisites: []", "prerequisites: [drill-b]", StringComparison.Ordinal)),
            ("practice/drills/drill-b.md", Drill.Replace("drill-a", "drill-b", StringComparison.Ordinal).Replace("prerequisites: []", "prerequisites: [drill-a]", StringComparison.Ordinal)),
            ("practice/drills/drill-b.tests.cs", Suite),
            (DrillPartPath, DrillPart + "2. [Count again](#drill-b)\n"));

    [Fact]
    public void ADrillOfAnotherChapterIsRefusedInThePart() =>
        Exactly(
            $"{DrillPartPath}:11: drill \"drill-a\" belongs to the chapter \"ch-other\", not \"ch-test\"\n{DrillPath}:3: drill \"drill-a\" is listed in no drill part of the chapter \"ch-other\"; list it once under the rung warm-up",
            ("chapters/d/chapter.md", Chapter.Replace("ch-test", "ch-other", StringComparison.Ordinal).Replace("slug: test", "slug: other", StringComparison.Ordinal)),
            (DrillPath, Drill.Replace("chapter: ch-test", "chapter: ch-other", StringComparison.Ordinal)));

    [Fact]
    public void ADrillListedInTwoPartsOfItsChapterIsRefused() =>
        Exactly(
            $"chapters/c/more.md:11: drill \"drill-a\" is listed twice in its chapter (first at {DrillPartPath}:11)",
            ("chapters/c/more.md", DrillPart.Replace("order: 2", "order: 3", StringComparison.Ordinal).Replace("ramp-a", "ramp-b", StringComparison.Ordinal)));

    [Fact]
    public void ADrillListedInNoPartIsRefused() =>
        Exactly(
            $"practice/drills/drill-b.md:3: drill \"drill-b\" is listed in no drill part of the chapter \"ch-test\"; list it once under the rung warm-up",
            ("practice/drills/drill-b.md", Drill.Replace("drill-a", "drill-b", StringComparison.Ordinal)),
            ("practice/drills/drill-b.tests.cs", Suite));

    [Fact]
    public void AReviewWalkMustStandInsideItsSection()
    {
        Assert.Empty(Run((ProblemPath, Problem.Replace("  count: 2\n", Review, StringComparison.Ordinal)), (DrillPartPath, DrillPart.Replace("\n1. [", Walk + "\n1. [", StringComparison.Ordinal))).Diagnostics);
        Exactly(
            $"{ProblemPath}:9: tests.review \"one\" walkId \"walk-x\" names no walk-it inside the section \"ramp-a\"",
            (ProblemPath, Problem.Replace("  count: 2\n", Review, StringComparison.Ordinal)),
            ("chapters/c/chapter.md", Chapter + Walk));
    }

    [Theory]
    [InlineData(true, "practice/problems.yml: the problem index is missing; write the output of SharpLadder.Content index <schema folder> <content root> to it")]
    [InlineData(false, "practice/problems.yml: no problem file exists, so SharpLadder.Content index <schema folder> <content root> prints nothing; delete this file")]
    public void AnAbsentOrOrphanIndexIsRefused(bool withProblems, string expected)
    {
        (string Path, string? Text)[] files = withProblems
            ? [(IndexPath, null)]
            : [(IndexPath, PracticeClosure.Index), (ProblemPath, null), (ProblemSuite, null), (DrillPath, null), (DrillSuite, null), (DrillPartPath, null)];

        Exactly(expected, files);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Old words")]
    public void TheIndexModePrintsTheIndexWithNoneOrAStaleOnePresent(string? stale)
    {
        using var folder = Tree((IndexPath, stale is null ? null : PracticeClosure.Index.Replace("Vowel words", stale, StringComparison.Ordinal)));

        var (code, output, error) = Index(folder.Path);

        Assert.Equal(0, code);
        Assert.Equal(PracticeClosure.Index, Encoding.UTF8.GetString(output));
        Assert.Equal("PASS content index\n", error.ReplaceLineEndings("\n"));
    }

    [Fact]
    public void TheIndexModeReproducesTheCommittedFixtureIndex()
    {
        var (code, output, _) = Index(Repository.Fixture);

        Assert.Equal(0, code);
        Assert.Equal(System.IO.File.ReadAllBytes(Path.Combine(Repository.Fixture, "practice", "problems.yml")), output);
    }

    [Fact]
    public void TheIndexModeReportsOnStandardErrorOnly()
    {
        using var folder = Tree((ProblemPath, Problem.Replace("ladders: [ladder-a]", "ladders: [ladder-zz]", StringComparison.Ordinal)));

        var (code, output, error) = Index(folder.Path);

        Assert.Equal(1, code);
        Assert.Empty(output);
        Assert.Contains("ladders names \"ladder-zz\", which is no ladder", error, StringComparison.Ordinal);
        Assert.EndsWith("FAIL content index", error.TrimEnd(), StringComparison.Ordinal);
    }

    private static (int Code, byte[] Output, string Error) Index(string root)
    {
        byte[] written = [];
        using var report = new StringWriter();
        using var error = new StringWriter();

        var code = Cli.Run(["index", Repository.SchemaFolder, root], new CliStreams(report, error, () => new CapturingStream(b => written = b), () => Stream.Null));

        Assert.Equal(string.Empty, report.ToString());
        return (code, written, error.ToString());
    }

    private static void Exactly(string expected, params (string Path, string? Text)[] files)
    {
        var result = Run(files);

        Assert.Equal(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())));
        Assert.Empty(result.Files);
    }
}
