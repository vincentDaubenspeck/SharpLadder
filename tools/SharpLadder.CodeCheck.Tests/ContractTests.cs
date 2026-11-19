using Xunit;

namespace SharpLadder.CodeCheck.Tests;

public sealed class ContractTests
{
    [Fact]
    public void UsageErrorsExitTwo()
    {
        var (code, lines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder);
        var (relativeCode, relativeLines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder, "content");

        Assert.Equal(2, code);
        Assert.Equal(
            [
                "  usage: SharpLadder.CodeCheck <schema folder> <content root>, both absolute, run from the repository root",
                "  each code group runs in a child process, which is not a sandbox: run only reviewed content",
                "FAIL code check",
            ],
            lines);
        Assert.Equal(2, relativeCode);
        Assert.Equal(2, relativeLines.Length);
        Assert.StartsWith("  content: not accepted; give ", relativeLines[0], StringComparison.Ordinal);
        Assert.Equal("FAIL code check", relativeLines[1]);
    }

    [Fact]
    public void ContentTheCompilerRejectsExitsOneWithItsLines()
    {
        using var root = Checker.EmptyRoot();
        root.Write("chapters/one/chapter.md", "# One\n");

        var (code, lines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder, root.Path);

        Assert.Equal(1, code);
        Assert.Equal(
            [
                $"  {Checker.Shown(root.Path)}/chapters/one/chapter.md:1: file must start with YAML front matter between --- lines",
                "FAIL code check",
            ],
            lines);
    }

    [Fact]
    public void RootWithoutChaptersPassesWithZeroGroups()
    {
        using var root = Checker.EmptyRoot();

        var (code, lines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder, root.Path);

        Assert.Equal(0, code);
        Assert.Equal(["0 groups", "PASS code check"], lines);
    }

    [Fact]
    public void RootWithoutChaptersStillFailsOnAnInvalidRegistry()
    {
        using var root = Checker.EmptyRoot();
        root.Write("patterns.yml", "patterns: {}\n");

        var (code, lines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder, root.Path);

        Assert.Equal(1, code);
        Assert.Equal(
            [
                $"  {Checker.Shown(root.Path)}/patterns.yml:1: patterns must be a list; write [] for none",
                "FAIL code check",
            ],
            lines);
    }
}
