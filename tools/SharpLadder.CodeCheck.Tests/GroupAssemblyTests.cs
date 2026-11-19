using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// Fixture content read through the compiler and assembled: grouping, ownership and program shape.
public sealed class GroupAssemblyTests
{
    private const string Build = "chapters/groups/build.md";
    private const string Syntax = "chapters/groups/syntax.md";

    [Fact]
    public void RepeatedNamesInOneApproachFormOneProgramInDocumentOrder()
    {
        var (shown, groups) = Fixtures.Assemble("groups");
        var file = shown + "/" + Build;

        var loop = Fixtures.Single(groups, Build, "loop");

        Assert.Equal("way-loop", loop.Approach);
        Assert.Equal(
            $"#line 18 \"{file}\"\n"
            + "global::SharpLadderHarness.Enter(\"loop-1\"); var total = 0;\n"
            + $"#line 26 \"{file}\"\n"
            + "global::SharpLadderHarness.Enter(\"loop-3\"); foreach (var n in new[] { 3, 4 }) total += n;\n"
            + $"#line 25 \"{file}\"\n"
            + "if (!(total == 7)) global::SharpLadderHarness.CheckFailed(\"loop-3\"); global::SharpLadderHarness.CheckPassed(\"loop-3\");\n"
            + "#line default\n"
            + "global::SharpLadderHarness.End();\n",
            loop.Text);
        Assert.Equal(["loop-3"], loop.ExpectedChecks);
        Assert.Null(loop.ThrowsBlock);
    }

    [Fact]
    public void NonadjacentMembersFormOneProgram()
    {
        var (_, groups) = Fixtures.Assemble("groups");

        Assert.Equal(["loop-1", "loop-3"], Fixtures.Ids(Fixtures.Single(groups, Build, "loop")));
        Assert.Equal(["loop-2"], Fixtures.Ids(Fixtures.Single(groups, Build, "loop-note")));
    }

    [Fact]
    public void SameGroupNameInTwoFilesGivesTwoPrograms()
    {
        var (_, groups) = Fixtures.Assemble("groups");

        Assert.Equal(
            ["chapters/groups/build.md way-loop loop-1 loop-3", "chapters/groups/syntax.md - syn-loop-1"],
            groups.Where(g => string.Equals(g.Key.Group, "loop", StringComparison.Ordinal)).Select(g => $"{g.Key.DocumentId} {g.Approach ?? "-"} {string.Join(' ', Fixtures.Ids(g))}"),
            StringComparer.Ordinal);
    }

    [Fact]
    public void IdenticalSymbolsInAlternativeApproachesLandInSeparatePrograms()
    {
        var (_, groups) = Fixtures.Assemble("groups");

        var loop = Fixtures.Single(groups, Build, "loop");
        var sum = Fixtures.Single(groups, Build, "sum");

        Assert.Equal("way-sum", sum.Approach);
        Assert.Contains("var total = 0;", loop.Text, StringComparison.Ordinal);
        Assert.Contains("var total = new[] { 3, 4 }.Sum();", sum.Text, StringComparison.Ordinal);
        Assert.DoesNotContain("var total = new[]", loop.Text, StringComparison.Ordinal);
        Assert.DoesNotContain("var total = 0;", sum.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void ApproachGroupGetsNoSetupFromTheLead()
    {
        var (_, groups) = Fixtures.Assemble("groups");

        var setup = Fixtures.Single(groups, Build, "sum-lead");

        Assert.Equal("way-sum", setup.Approach);
        Assert.Equal(["sum-2"], Fixtures.Ids(setup));
        Assert.DoesNotContain("var numbers", setup.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void EveryApproachGroupIsAssembledWhateverThePickerShows()
    {
        var (_, groups) = Fixtures.Assemble("groups");

        var broken = Fixtures.Single(groups, Build, "broken");

        Assert.Equal("way-broken", broken.Approach);
        Assert.Contains("var missing = ;", broken.Text, StringComparison.Ordinal);
        Assert.Equal(
            ["lead -", "loop way-loop", "loop-note way-loop", "sum way-sum", "sum-lead way-sum", "broken way-broken"],
            groups.Where(g => string.Equals(g.Key.DocumentId, Build, StringComparison.Ordinal)).Select(g => $"{g.Key.Group} {g.Approach ?? "-"}"),
            StringComparer.Ordinal);
    }

    [Fact]
    public void LabelsAndApproachOrderChangeNothing()
    {
        var (_, first) = Fixtures.Assemble("groups");
        var (_, second) = Fixtures.Assemble("groups-reordered");

        Assert.Equal(Summary(first), Summary(second), StringComparer.Ordinal);
    }

    [Fact]
    public void LeadGroupIsAssembledOutsideEveryApproach()
    {
        var (shown, groups) = Fixtures.Assemble("groups");

        var lead = Fixtures.Single(groups, Build, "lead");

        Assert.Null(lead.Approach);
        Assert.Equal(
            $"#line 12 \"{shown}/{Build}\"\n"
            + "global::SharpLadderHarness.Enter(\"lead-1\"); var numbers = new[] { 3, 4 };\n"
            + "#line default\n"
            + "global::SharpLadderHarness.End();\n",
            lead.Text);
    }

    [Fact]
    public void OrdinaryFileIsAssembledWithItsChecksAndTypeTail()
    {
        var (shown, groups) = Fixtures.Assemble("groups");
        var file = shown + "/" + Syntax;

        var point = Fixtures.Single(groups, Syntax, "point");

        Assert.Equal(
            $"#line 17 \"{file}\"\n"
            + "using System.Text;\n"
            + "global::SharpLadderHarness.Enter(\"point-1\"); var p = new Point(1, 2);\n"
            + "var text = new StringBuilder().Append(p.X).ToString();\n"
            + $"#line 16 \"{file}\"\n"
            + "if (!(p.X == 1)) global::SharpLadderHarness.CheckFailed(\"point-1\"); global::SharpLadderHarness.CheckPassed(\"point-1\");\n"
            + $"#line 23 \"{file}\"\n"
            + "global::SharpLadderHarness.End(); record Point(int X, int Y);\n"
            + "#line default\n",
            point.Text);
        Assert.Equal(["point-1"], point.ExpectedChecks);
        Assert.Equal(["syn-loop-1"], Fixtures.Ids(Fixtures.Single(groups, Syntax, "loop")));
    }

    [Fact]
    public void EveryContainerKindIsCollectedAndAssembled()
    {
        var root = Fixtures.Root("all-containers");
        var (diagnostics, blocks) = PlanSource.Read(Checker.SchemaFolder, root);
        Assert.Empty(diagnostics);

        var result = Assembler.Assemble(blocks);

        Assert.Equal(
            [
                "chapters/fixture-basics/build.md build-fix-lead1 Section -",
                "chapters/fixture-basics/build.md build-fix-loop1 Approach build-fix-loop",
                "chapters/fixture-basics/build.md build-fix-sum1 Approach build-fix-sum",
                "chapters/fixture-basics/cards.md tally-fix-code1 Card -",
                "chapters/fixture-basics/cards.md tally-fix-why1 Card -",
                "chapters/fixture-basics/chapter.md fix-intro-code1 Intro -",
                "chapters/fixture-basics/chapter.md fix-parts-code1 Section -",
                "chapters/fixture-basics/drill.md ramp-fix-start-code1 Drill -",
                "chapters/fixture-basics/gotchas.md gotcha-fix-key1 Section -",
                "chapters/fixture-basics/gotchas.md gotcha-fix-out1 Section -",
                "chapters/fixture-basics/syntax.md syn-fix-sum1 Section -",
                "chapters/fixture-basics/syntax.md syn-fix-sum2 Section -",
                "errors/err-fixture-cs0165.md fix-shape-code1 ErrorEntry -",
                "glossary/term-fixture-set.md fix-set1 GlossaryEntry -",
            ],
            blocks.Select(b => $"{b.DocumentId} {b.BlockId} {b.Container} {b.Approach ?? "-"}"),
            StringComparer.Ordinal);
        Assert.Empty(result.Failures);
        Assert.Equal(
            blocks.Select(b => b.BlockId).Order(StringComparer.Ordinal),
            result.Groups.SelectMany(g => g.Blocks).Select(b => b.BlockId).Order(StringComparer.Ordinal));
        var key = Fixtures.Single(result.Groups, "chapters/fixture-basics/gotchas.md", "fix-key");
        Assert.Equal("gotcha-fix-key1", key.ThrowsBlock?.BlockId);
        Assert.Contains("global::SharpLadderHarness.Enter(\"gotcha-fix-key1\", typeof(KeyNotFoundException)); var stock", key.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void MixedOwnershipExitsOneWithTheCompilersLines()
    {
        var root = Fixtures.Root("mixed-owner");

        var (code, lines) = Checker.Check(Checker.RepositoryRoot, root);

        Assert.Equal(1, code);
        Assert.Equal(
            [
                $"  {Checker.Shown(root)}/chapters/mixed-owner/build.md:17: group \"outside-first\" is also used at line 11; the code of an approach forms groups of its own",
                $"  {Checker.Shown(root)}/chapters/mixed-owner/build.md:31: group \"approach-first\" is also used at line 21; the code of an approach forms groups of its own",
                "FAIL code check",
            ],
            lines);
    }

    [Fact]
    public void BlockWithoutIdOrGroupExitsOneWithTheCompilersLines()
    {
        var root = Fixtures.Root("missing-id-group");

        var (code, lines) = Checker.Check(Checker.RepositoryRoot, root);

        Assert.Equal(1, code);
        Assert.Equal(
            [
                $"  {Checker.Shown(root)}/chapters/missing-id-group/chapter.md:13: csharp fence needs an {{#id}}",
                $"  {Checker.Shown(root)}/chapters/missing-id-group/chapter.md:17: csharp fence needs a group",
                "FAIL code check",
            ],
            lines);
    }

    // Each group without its line numbers or chapter folder, in a fixed order.
    private static List<string> Summary(IReadOnlyList<GroupProgram> groups) =>
    [
        .. groups
            .Select(g => string.Join(
                " | ",
                g.Key.DocumentId[(g.Key.DocumentId.LastIndexOf('/') + 1)..],
                g.Key.Group,
                g.Approach ?? "-",
                string.Join(' ', Fixtures.Ids(g)),
                string.Join(' ', g.ExpectedChecks),
                string.Join('\n', g.Text.Split('\n').Where(l => !l.StartsWith("#line ", StringComparison.Ordinal)))))
            .Order(StringComparer.Ordinal),
    ];
}
