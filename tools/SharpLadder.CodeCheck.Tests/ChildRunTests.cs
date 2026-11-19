using Xunit;
using static SharpLadder.CodeCheck.Tests.Runs;

namespace SharpLadder.CodeCheck.Tests;

// The shared child lifecycle with a standard output sink, through this OS's backend and its seams.
// Only the race tests carry the repeat trait, so a repeat run selects exactly them.
public sealed class ChildRunTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    public const string RepeatTrait = "Repeat";

    public const string Race = "race";

    private const string Pattern = "var data = new byte[{0}];\nfor (var i = 0; i < data.Length; i++) { data[i] = (byte)(i % 251); }\nusing var stdout = Console.OpenStandardOutput();\n";

    // The 16 KiB read buffer splits this output into several chunks, whatever the timing.
    [Fact]
    [Trait(RepeatTrait, Race)]
    public void SinkReceivesStandardOutputInOrderUpToTheCap()
    {
        var group = Compile(fixture.Compiler, Block("chunks", 10, Source(70000) + "using var stderr = Console.OpenStandardError();\nfor (var at = 0; at < data.Length; at += 7000) { stdout.Write(data, at, 7000); stderr.Write(data, at, 10); Thread.Sleep(20); }\n"));
        var sink = new Received();

        var end = RunWith(group, sink.Add);

        Assert.Equal(new ChildState.CapPassed(OutputStream.StandardOutput), end.State);
        Assert.Equal(Expected(RunLimits.OutputCapBytes), sink.Bytes);
        Assert.True(sink.Chunks > 1, "the output arrived in one chunk");
    }

    // The direct child exits as soon as it has written, so its exit is seen before the drain ends.
    [Fact]
    [Trait(RepeatTrait, Race)]
    public void ExitIsReportedOnlyAfterTheDrainHasEnded()
    {
        var group = Compile(fixture.Compiler, Block("exit", 10, Source(60000) + "stdout.Write(data);\n"));
        var sink = new Received();

        var end = RunWith(group, sink.Add);

        Assert.Equal(new ChildState.Exited(0), end.State);
        Assert.Equal(Expected(60000), sink.Bytes);
    }

    [Fact]
    [Trait(RepeatTrait, Race)]
    public void TimeoutKillsTheChildWhileItWrites()
    {
        var started = new List<Pid>();
        var group = Compile(fixture.Compiler, Block("writer", 10, "using var stdout = Console.OpenStandardOutput();\nfor (var i = 0; i < 1000000; i++) { stdout.Write(\"x\"u8); Thread.Sleep(5); }\n"));
        var sink = new Received();

        var end = RunWith(group, sink.Add, Pid.Watch(started));

        Assert.IsType<ChildState.StillRunning>(end.State);
        Assert.False(Assert.Single(started).Alive);
        Assert.NotEmpty(sink.Bytes);
        Assert.All(sink.Bytes, b => Assert.Equal((byte)'x', b));
    }

    [Fact]
    [Trait(RepeatTrait, Race)]
    public void StartUpFaultCleansUpBeforeAnyOutput()
    {
        var started = new List<Pid>();
        var group = Compile(fixture.Compiler, Block("start-up", 10, "Console.Write(\"never\");\n"));
        var sink = new Received();

        var problem = Assert.Throws<ToolProblem>(() => RunWith(group, sink.Add, Pid.Watch(started, WindowsFault.StartUp, LinuxFault.StartUp)));

        Assert.Equal("run: exited with status 3 before its start record", problem.Message);
        Assert.False(Assert.Single(started).Alive);
        Assert.Empty(sink.Bytes);
    }

    [Fact]
    public void SinkFaultEndsTheRunAsAToolFault()
    {
        var started = new List<Pid>();
        var group = Compile(fixture.Compiler, Block("faulty", 10, "Console.Write(\"handed on\");\n"));

        var problem = Assert.Throws<ToolProblem>(() => RunWith(group, _ => throw new InvalidOperationException("the sink broke"), Pid.Watch(started)));

        Assert.Equal("the code group's standard output could not be read (InvalidOperationException: the sink broke)", problem.Message);
        Assert.False(Assert.Single(started).Alive);
    }

    private static string Source(int length) => Pattern.Replace("{0}", length.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal);

    private static byte[] Expected(int length) => [.. Enumerable.Range(0, length).Select(i => (byte)(i % 251))];

    private static RunEnd RunWith(CompiledGroup group, OutputSink sink, IRunBackend? backend = null)
    {
        var chosen = backend ?? Backend();
        return new ChildRun(Locations.FromRepository(Checker.RepositoryRoot), chosen)
            .Run(group.Image, "run", token => new ResultReader(token, group, chosen.ReportsProcessGroup), sink, RunLimits.Launch);
    }

    // Written on the drain's thread; read only after the run has returned, once the drain has ended.
    private sealed class Received
    {
        private readonly List<byte> _bytes = [];

        public int Chunks { get; private set; }

        public byte[] Bytes => [.. _bytes];

        public void Add(ReadOnlySpan<byte> chunk)
        {
            _bytes.AddRange(chunk);
            Chunks++;
        }
    }
}
