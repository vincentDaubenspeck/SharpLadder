using System.Diagnostics;
using System.Globalization;
using Xunit;
using static SharpLadder.CodeCheck.Tests.Runs;

namespace SharpLadder.CodeCheck.Tests;

// What exists only on Linux: the preflight the process-group design rests on, cleanup through the
// retained pgid once the leader is gone, and a process table that cannot be listed.
public sealed class LinuxLifecycleTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    private const string LinuxOnly = "process groups and /proc exist only on Linux";

    // The backend has no fallback: setsid runs the muxer in place only in a child that does not
    // already lead its process group, which a child started by .NET must not.
    [Fact]
    public void PreflightSetsidIsPresentAndAStartedChildLeadsNoGroup()
    {
        Assert.SkipUnless(OperatingSystem.IsLinux(), LinuxOnly);
        Assert.True(System.IO.File.Exists("/usr/bin/setsid"), "/usr/bin/setsid is missing");

        var start = new ProcessStartInfo("/usr/bin/cat") { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add("/proc/self/stat");
        string stat;
        int pid;
        using (var cat = Process.Start(start)!)
        {
            cat.StandardInput.Close();
            stat = cat.StandardOutput.ReadToEnd();
            cat.WaitForExit();
            pid = cat.Id;
        }

        var processGroup = stat[(stat.LastIndexOf(')') + 2)..].Split(' ')[2];
        Assert.Equal(pid, int.Parse(stat[..stat.IndexOf(' ', StringComparison.Ordinal)], CultureInfo.InvariantCulture));
        Assert.NotEqual(pid, int.Parse(processGroup, CultureInfo.InvariantCulture));
    }

    // When the group is signalled its leader is already gone and its descendant still runs; the one
    // kill through the retained pgid ends the descendant.
    [Fact]
    public void LeaderExitCleanupReachesTheGroupThroughItsRetainedPgid()
    {
        Assert.SkipUnless(OperatingSystem.IsLinux(), LinuxOnly);
        using var folder = new TempFolder();
        var started = new List<Pid>();
        var signals = new List<(int Group, bool LeaderAlive, bool DescendantsAlive)>();
        var group = Compile(fixture.Descendants, Block("leader-exit", 10, Descendants.Sleeper(folder.Path) + "Environment.Exit(0);\n"));

        var failure = Run(group, Pid.Watch(started, signalled: pgid => signals.Add((pgid, started[0].Alive, Pid.Ready(folder.Path).All(p => p.Alive)))));

        Assert.Equal("chapters/run/blocks.md:11 leader-exit ended early", failure);
        var leader = Assert.Single(started);
        Assert.Equal((leader.Id, false, true), Assert.Single(signals));
        Pid.AllDead(started, folder.Path, 1);
    }

    // A group that would pass still fails: a table that cannot be listed is never an empty group.
    [Fact]
    public void ProcessTableThatCannotBeListedFailsInsteadOfPassing()
    {
        Assert.SkipUnless(OperatingSystem.IsLinux(), LinuxOnly);
        var started = new List<Pid>();
        var group = Compile(fixture.Compiler, Block("listed", 10, "int value = 1;\n", check: "value == 1"));

        var problem = Assert.Throws<ToolProblem>(() => Run(group, Pid.Watch(started, onLinux: LinuxFault.Enumeration)));

        Assert.Equal("the process table could not be listed (DirectoryNotFoundException)", problem.Message);
        Assert.False(Assert.Single(started).Alive);
    }
}
