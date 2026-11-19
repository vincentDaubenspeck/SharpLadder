using Xunit;
using static SharpLadder.CodeCheck.Tests.Runs;

namespace SharpLadder.CodeCheck.Tests;

// The child's lifecycle on both systems: each fault of the start, the release and the cleanup, the
// job's own faults on Windows, the output caps on both streams, and cleanup on the exit paths the
// tree-kill cases do not reach.
public sealed class LifecycleTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    private const string WindowsOnly = "the job and its faults exist only on Windows";

    private const string Waits = "int value = 1;\n";

    [Fact]
    public void FailedStartExitsTwoAndSignalsNothing()
    {
        var started = new List<Pid>();
        var signalled = new List<int>();
        var group = Compile(fixture.Compiler, Block("start", 10, Waits));

        var problem = Assert.Throws<ToolProblem>(() => Run(group, Pid.Watch(started, WindowsFault.Start, LinuxFault.Start, signalled.Add)));

        Assert.Equal(
            OperatingSystem.IsWindows()
                ? "the code group's process could not be started (Windows error 2)"
                : "the code group's process could not be started (Linux error 2)",
            problem.Message);
        Assert.Empty(started);
        Assert.Empty(signalled);
    }

    // Linux ends and reaps only the direct child: its group was never verified, so never signalled.
    [Fact]
    public void FailedStartUpExitsTwoAfterTheChildIsReaped()
    {
        var started = new List<Pid>();
        var signalled = new List<int>();
        var group = Compile(fixture.Compiler, Block("start-up", 10, Waits));

        var problem = Assert.Throws<ToolProblem>(() => Run(group, Pid.Watch(started, WindowsFault.StartUp, LinuxFault.StartUp, signalled.Add)));

        Assert.Equal("group \"start-up\" of chapters/run/blocks.md: exited with status 3 before its start record", problem.Message);
        Assert.False(Assert.Single(started).Alive);
        Assert.Empty(signalled);
    }

    // After verification Linux cleans up through the group, whose pgid is the child's own pid.
    [Fact]
    public void FailedReleaseWriteExitsTwoAfterTheJobIsEnded()
    {
        var started = new List<Pid>();
        var signalled = new List<int>();
        var group = Compile(fixture.Compiler, Block("release", 10, Waits));

        var problem = Assert.Throws<ToolProblem>(() => Run(group, Pid.Watch(started, WindowsFault.ReleaseWrite, LinuxFault.ReleaseWrite, signalled.Add)));

        Assert.Equal(
            OperatingSystem.IsWindows()
                ? "the release line could not be written to the code group (Windows error 6)"
                : "the release line could not be written to the code group (Linux error 9)",
            problem.Message);
        var child = Assert.Single(started);
        Assert.False(child.Alive);
        int[] groups = OperatingSystem.IsLinux() ? [child.Id] : [];
        Assert.Equal(groups, signalled);
    }

    [Fact]
    public void FailedAssignmentEndsTheSuspendedChild()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), WindowsOnly);
        var started = new List<Pid>();
        var group = Compile(fixture.Compiler, Block("assign", 10, Waits));

        var problem = Assert.Throws<ToolProblem>(() => Run(group, Pid.Watch(started, WindowsFault.Assignment)));

        Assert.Equal("the code group's process could not be put in its job (Windows error 6)", problem.Message);
        Assert.False(Assert.Single(started).Alive);
    }

    [Fact]
    public void FailedResumeEndsTheJob()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), WindowsOnly);
        var started = new List<Pid>();
        var group = Compile(fixture.Compiler, Block("resume", 10, Waits));

        var problem = Assert.Throws<ToolProblem>(() => Run(group, Pid.Watch(started, WindowsFault.Resume)));

        Assert.Equal("the code group's process could not be resumed in its job (Windows error 6)", problem.Message);
        Assert.False(Assert.Single(started).Alive);
    }

    [Fact]
    public void StandardOutputOfExactlyTheCapPasses() =>
        Assert.Null(Run(fixture.Compiler, Block("out-exact", 10, "using var stdout = Console.OpenStandardOutput();\nstdout.Write(new byte[65536]);\n")));

    [Fact]
    public void StandardOutputOneBytePastTheCapFails() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 out-over wrote more than 64 KiB to standard output",
            Run(fixture.Compiler, Block("out-over", 10, "using var stdout = Console.OpenStandardOutput();\nstdout.Write(new byte[65537]);\n")));

    [Fact]
    public void StandardErrorOfExactlyTheCapPasses() =>
        Assert.Null(Run(fixture.Compiler, Block("err-exact", 10, "using var stderr = Console.OpenStandardError();\nstderr.Write(new byte[65536]);\n")));

    [Fact]
    public void StandardErrorOneBytePastTheCapFails() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 err-over wrote more than 64 KiB to standard error",
            Run(fixture.Compiler, Block("err-over", 10, "using var stderr = Console.OpenStandardError();\nstderr.Write(new byte[65537]);\n")));

    // Normal return, early exit, cap overflow and timeout are proven by the tree-kill cases; the
    // content exception and the tool failure are proven here, each with a live descendant. The tool
    // failure is the job's failed process count on Windows and a process table that cannot be listed
    // on Linux.
    [Fact]
    public void ExceptionAndToolFailureEachEndEveryProcess()
    {
        using (var folder = new TempFolder())
        {
            var started = new List<Pid>();
            var group = Compile(fixture.Descendants, Block("thrower", 10, Descendants.Sleeper(folder.Path) + "throw new InvalidOperationException(\"after the descendant\");\n"));

            Assert.Equal("chapters/run/blocks.md:11 thrower threw System.InvalidOperationException, but it is not marked throws", Run(group, Pid.Watch(started)));
            Pid.AllDead(started, folder.Path, 1);
        }

        using (var folder = new TempFolder())
        {
            var started = new List<Pid>();
            var group = Compile(fixture.Descendants, Block("uncounted", 10, Descendants.Sleeper(folder.Path)));

            var problem = Assert.Throws<ToolProblem>(() => Run(group, Pid.Watch(started, WindowsFault.ProcessCount, LinuxFault.Enumeration)));

            Assert.Equal(
                OperatingSystem.IsWindows()
                    ? "the code group's job could not report its live processes (Windows error 24)"
                    : "the process table could not be listed (DirectoryNotFoundException)",
                problem.Message);
            Pid.AllDead(started, folder.Path, 1);
        }
    }
}
