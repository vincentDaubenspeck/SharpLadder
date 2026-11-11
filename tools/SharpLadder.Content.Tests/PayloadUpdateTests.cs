using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class PayloadUpdateTests
{
    [Fact]
    public void CompiledDestinationInsideTheGeneratedOneIsRefused()
    {
        using var work = new PayloadWorkspace(seed: false);

        var result = work.Run("update", compiled: Path.Combine(work.Generated, "compiled"));

        AssertNothingPublished(work, result);
        Assert.Contains("must lie outside the generated destination", result.Output, StringComparison.Ordinal);
    }

    [Fact]
    public void GeneratedDestinationInsideTheCompiledOneIsRefused()
    {
        using var work = new PayloadWorkspace(seed: false);

        var result = work.Run("update", generated: Path.Combine(work.Compiled, "generated"));

        AssertNothingPublished(work, result);
        Assert.Contains("must lie outside the", result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("compiled", "schema")]
    [InlineData("compiled", "content")]
    [InlineData("generated", "schema")]
    [InlineData("generated", "content")]
    public void DestinationInsideAnInputRootIsRefused(string destination, string root)
    {
        using var work = new PayloadWorkspace(seed: false);
        var inside = Path.Combine(work.RootOf(root), "out");

        var result = string.Equals(destination, "compiled", StringComparison.Ordinal)
            ? work.Run("update", compiled: inside)
            : work.Run("update", generated: inside);

        AssertNothingPublished(work, result);
        Assert.Contains($"{inside}: the output folder must lie outside the", result.Output, StringComparison.Ordinal);
        Assert.False(Directory.Exists(inside));
    }

    [Theory]
    [InlineData("compiled")]
    [InlineData("generated")]
    public void DestinationInsideTheStagingRootIsRefused(string destination)
    {
        using var work = new PayloadWorkspace(seed: false);
        var stage = work.NewStage();
        var inside = Path.Combine(stage, "out");

        var result = string.Equals(destination, "compiled", StringComparison.Ordinal)
            ? work.Run("update", stage, compiled: inside)
            : work.Run("update", stage, generated: inside);

        AssertNothingPublished(work, result);
        Assert.Contains($"{inside}: must lie outside the staging folder", result.Output, StringComparison.Ordinal);
        Assert.False(Directory.Exists(stage));
    }

    [Theory]
    [InlineData("compiled")]
    [InlineData("generated")]
    public void NonEmptyDestinationIsRefused(string destination)
    {
        using var work = new PayloadWorkspace(seed: false);
        var planted = PayloadWorkspace.Write(Path.Combine(work.RootOf(destination), "planted.txt"), "x\n");

        var result = work.Run("update");

        Assert.Equal(2, result.Code);
        Assert.Contains("output folder must be empty or absent", result.Output, StringComparison.Ordinal);
        Assert.Equal(["planted.txt"], Directory.EnumerateFileSystemEntries(Path.GetDirectoryName(planted)!).Select(Path.GetFileName), StringComparer.Ordinal);
        Assert.Single(Directory.EnumerateFiles(work.Web, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public void PublicationFailureAfterTheFirstDestinationIsReportedAndBlocksARetry()
    {
        using var work = new PayloadWorkspace(seed: false);
        var planted = Path.Combine(work.Generated, "planted.txt");

        var failed = work.Run("update", betweenDestinations: () => PayloadWorkspace.Write(planted, "x\n"));

        Assert.Equal(2, failed.Code);
        Assert.DoesNotContain("PASS", failed.Output, StringComparison.Ordinal);
        Assert.Contains($"  partial publication: {work.Compiled} was written and {work.Generated} was not; nothing is certified", failed.Output, StringComparison.Ordinal);
        Assert.Equal(10, Directory.EnumerateFiles(work.Compiled, "*", SearchOption.AllDirectories).Count());
        Assert.Equal(["planted.txt"], Directory.EnumerateFileSystemEntries(work.Generated).Select(Path.GetFileName), StringComparer.Ordinal);

        File.Delete(planted);
        var retry = work.Run("update");

        Assert.Equal(2, retry.Code);
        Assert.Contains($"{work.Compiled}: output folder must be empty or absent", retry.Output, StringComparison.Ordinal);
        Assert.Empty(Directory.EnumerateFileSystemEntries(work.Generated));
    }

    [Fact]
    public void ContentErrorPublishesNothing()
    {
        using var work = new PayloadWorkspace(seed: false);
        var chapter = Path.Combine(work.Content, "chapters", "fixture-second", "chapter.md");
        File.AppendAllText(chapter, "\n[broken](#no-such-anchor)\n");

        var result = work.Run("update");

        Assert.Equal(1, result.Code);
        Assert.False(Directory.Exists(work.Web));
    }

    private static void AssertNothingPublished(PayloadWorkspace work, CliResult result)
    {
        Assert.Equal(2, result.Code);
        Assert.EndsWith("FAIL content update\n", result.Output, StringComparison.Ordinal);
        Assert.False(Directory.Exists(work.Web) && Directory.EnumerateFiles(work.Web, "*", SearchOption.AllDirectories).Any());
    }
}
