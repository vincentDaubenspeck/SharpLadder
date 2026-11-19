using System.Reflection.PortableExecutable;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// Fixture content read through the compiler, assembled and compiled; nothing is run.
public sealed class CompileFixtureTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    private const string Build = "chapters/groups/build.md";

    [Fact]
    public void IdenticalSymbolsInAlternativeApproachesCompileApart()
    {
        var (_, groups) = Fixtures.Assemble("groups");

        foreach (var name in new[] { "loop", "sum" })
        {
            var outcome = fixture.Compiler.Compile(Fixtures.Single(groups, Build, name));

            Assert.Empty(outcome.Failures);
            using var pe = new PEReader(Assert.IsType<CompiledGroup>(outcome.Ready).Image);
            Assert.Contains(pe.ReadDebugDirectory(), e => e.Type == DebugDirectoryEntryType.EmbeddedPortablePdb);
        }
    }

    [Fact]
    public void ApproachGroupRelyingOnLeadSetupFailsAtItsLine()
    {
        var (shown, groups) = Fixtures.Assemble("groups");

        var outcome = fixture.Compiler.Compile(Fixtures.Single(groups, Build, "sum-lead"));

        Assert.Null(outcome.Ready);
        Assert.Equal(
            [$"{shown}/{Build}:36 sum-2 error CS0103: The name 'numbers' does not exist in the current context"],
            outcome.Failures.Select(f => f.ToString()),
            StringComparer.Ordinal);
    }

    [Fact]
    public void BrokenAlternativeThePickerDoesNotShowStillFails()
    {
        var (shown, groups) = Fixtures.Assemble("groups");

        var outcome = fixture.Compiler.Compile(Fixtures.Single(groups, Build, "broken"));

        Assert.Null(outcome.Ready);
        Assert.Equal(
            [$"{shown}/{Build}:42 broken-1 error CS1525: Invalid expression term ';'"],
            outcome.Failures.Select(f => f.ToString()),
            StringComparer.Ordinal);
    }

    [Fact]
    public void EveryContainerKindCompiles()
    {
        var (_, groups) = Fixtures.Assemble("all-containers");

        var outcomes = groups.ToDictionary(g => $"{g.Key.DocumentId} {g.Key.Group}", fixture.Compiler.Compile, StringComparer.Ordinal);

        Assert.All(outcomes.Values, o => Assert.Empty(o.Failures));
        Assert.Equal(
            ["chapters/fixture-basics/gotchas.md fix-out"],
            outcomes.Where(o => o.Value.Ready is null).Select(o => o.Key),
            StringComparer.Ordinal);
    }

    [Fact]
    public void ExactThrowsTypeResolvesAtItsBlock()
    {
        var (_, groups) = Fixtures.Assemble("all-containers");

        var key = fixture.Compiler.Compile(Fixtures.Single(groups, "chapters/fixture-basics/gotchas.md", "fix-key")).Ready?.Throws;

        Assert.Equal(
            ("gotcha-fix-key1", "System.Collections.Generic.KeyNotFoundException", "System.Runtime"),
            (key?.Block.BlockId, key?.TypeName, key?.Assembly));
    }
}
