using System.Diagnostics;
using Xunit;
using static SharpLadder.CodeCheck.Tests.Runs;

namespace SharpLadder.CodeCheck.Tests;

// The tree-kill variants and the run folder's deletion: every process a group starts is dead when
// the checker returns, a run folder that cannot be deleted fails the run, and the checker returns in
// time. Its own class so a repeat run of the timing-sensitive tests can select it by name.
public sealed class TreeCleanupTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    // The launch deadline, the cleanup proof bound, the run folder's deletion budget and the test's
    // own return allowance.
    private static readonly TimeSpan Returns = TimeSpan.FromSeconds(5 + 2 + 2 + 5);

    // The injected deletion deadline, and separately the scheduling allowance for the throw after it.
    private static readonly TimeSpan DeletionLimit = TimeSpan.FromMilliseconds(300);
    private static readonly TimeSpan DeletionMargin = TimeSpan.FromSeconds(2);

    [Fact]
    public void PersistentDescendantOfAWaitingGroupIsEnded()
    {
        using var folder = new TempFolder();
        var (failure, started) = RunTimed(Block("persistent", 10, Descendants.Sleeper(folder.Path) + "Thread.Sleep(Timeout.Infinite);\n"));

        Assert.Equal("chapters/run/blocks.md:11 persistent timed out after 5 s", failure);
        Pid.AllDead(started, folder.Path, 1);
    }

    [Fact]
    public void OrphanedDescendantIsEnded()
    {
        using var folder = new TempFolder();
        var (failure, started) = RunTimed(Block("orphaned", 10, Descendants.Orphan(folder.Path) + "Thread.Sleep(Timeout.Infinite);\n"));

        Assert.Equal("chapters/run/blocks.md:11 orphaned timed out after 5 s", failure);
        Pid.AllDead(started, folder.Path, 2);
    }

    [Fact]
    public void DescendantOutlivingItsLeaderIsEnded()
    {
        using var folder = new TempFolder();
        var (failure, started) = RunTimed(Block("leader", 10, Descendants.Sleeper(folder.Path) + "Environment.Exit(0);\n"));

        Assert.Equal("chapters/run/blocks.md:11 leader ended early", failure);
        Pid.AllDead(started, folder.Path, 1);
    }

    [Fact]
    public void NormalEndWithALiveDescendantPassesOnItsRecords()
    {
        using var folder = new TempFolder();
        var (failure, started) = RunTimed(Block("lingering", 10, Descendants.Sleeper(folder.Path) + "int ended = 1;\n", check: "ended == 1"));

        Assert.Null(failure);
        Pid.AllDead(started, folder.Path, 1);
    }

    [Fact]
    public void BothStreamsFloodedTogetherFailOnTheCap()
    {
        using var folder = new TempFolder();
        var flood = "var chunk = new byte[16384];\n"
            + "var output = Task.Run(() => { using var stream = Console.OpenStandardOutput(); for (var i = 0; i < 64; i++) stream.Write(chunk); });\n"
            + "var error = Task.Run(() => { using var stream = Console.OpenStandardError(); for (var i = 0; i < 64; i++) stream.Write(chunk); });\n"
            + "Task.WaitAll(output, error);\n";
        var (failure, started) = RunTimed(Block("flood", 10, Descendants.Sleeper(folder.Path) + flood));

        // Either stream may pass its cap first; a serial read would leave the other blocked to the deadline.
        string?[] either = ["chapters/run/blocks.md:11 flood wrote more than 64 KiB to standard output", "chapters/run/blocks.md:11 flood wrote more than 64 KiB to standard error"];
        Assert.Contains(failure, either, StringComparer.Ordinal);
        Pid.AllDead(started, folder.Path, 1);
    }

    [Fact]
    public void LockedRunFolderFailsOnItsDeletionDeadline()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "a file open without delete sharing blocks its deletion only on Windows");
        using var folder = new TempFolder();
        using var locked = new FileStream(Path.Combine(folder.Path, "locked"), FileMode.CreateNew, FileAccess.Write, FileShare.None);

        var clock = Stopwatch.StartNew();
        var problem = Assert.Throws<ToolProblem>(() => ChildRun.DeleteRunFolder(folder.Path, Deadline.After(DeletionLimit)));
        var elapsed = clock.Elapsed;

        var cause = Assert.IsType<IOException>(problem.InnerException);
        Assert.Equal("The process cannot access the file 'locked' because it is being used by another process.", cause.Message);
        Assert.Equal($"the run folder {folder.Path} could not be deleted: IOException: {cause.Message}", problem.Message);
        Assert.InRange(elapsed, DeletionLimit, DeletionLimit + DeletionMargin);
    }

    private (string? Failure, List<Pid> Started) RunTimed(SourceBlock block)
    {
        RequireBackend();
        var group = Compile(fixture.Descendants, block);
        var started = new List<Pid>();
        var clock = Stopwatch.StartNew();
        var failure = Run(group, Pid.Watch(started));
        Assert.InRange(clock.Elapsed, TimeSpan.Zero, Returns);
        return (failure, started);
    }
}
