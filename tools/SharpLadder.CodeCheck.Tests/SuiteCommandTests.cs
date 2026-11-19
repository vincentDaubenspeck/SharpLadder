using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// Suites through the command and over the committed fixtures: the reference root as the command
// opens it, and a start-up fault in each kind of suite run read as a tool fault.
public sealed class SuiteCommandTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    private const string Drill = "drill-fix-stop-word";

    private static string Content => Fixtures.Root("all-containers");

    private static string Solutions => Fixtures.Root("all-containers-reference");

    // The practice fixture's chapters hold blocks written for the compiler, not for a run, so its
    // pair is checked through the suite runner: every subject's starter, reference and wrong runs.
    [Fact]
    public void ContentFixturePairPassesEverySuiteRun()
    {
        var fixtures = Path.Combine(Checker.RepositoryRoot, "tools", "SharpLadder.Content.Tests", "fixtures");
        var (diagnostics, suites) = PlanSource.ReadSuites(Checker.SchemaFolder, Path.Combine(fixtures, "content"));
        Assert.Empty(diagnostics);
        var solutions = SolutionRoot.Read(Path.Combine(fixtures, "reference"), "reference", [.. suites.Select(s => s.Subject)]);
        Assert.Empty(solutions.Failures);
        var runner = new SuiteRunner(Locations.FromRepository(Checker.RepositoryRoot), Runs.Backend(), new SuiteCompiler(fixture.References), RunLimits.Launch);
        var failures = new List<string>();

        runner.Check(suites, solutions, failures);

        Assert.Empty(failures);
        Assert.Equal(17, runner.Runs);
    }

    [Fact]
    public void FixtureWithItsReferenceRootPasses()
    {
        var (code, lines) = Run(Solutions);

        Assert.Equal(0, code);
        Assert.Equal(["3 suite runs", "PASS code check"], lines[^2..]);
    }

    [Fact]
    public void AbsentReferenceRootFailsEachSubject()
    {
        using var parent = new TempFolder();
        var root = Path.Combine(parent.Path, "reference");

        var (code, lines) = Run(root);

        Assert.Equal(1, code);
        Assert.Equal([$"  {Checker.Shown(root)}: {Drill}: reference file missing ({Drill}.reference.cs)", "FAIL code check"], lines);
    }

    [Fact]
    public void OrphanSolutionFailsTheCommand()
    {
        using var copy = Copy();
        copy.Write("drill-fix-absent.reference.cs", "// reference: drill-fix-absent\n");

        var (code, lines) = Run(copy.Path);

        Assert.Equal(1, code);
        Assert.Equal(2, lines.Length);
        Assert.StartsWith($"  {Checker.Shown(copy.Path)}/drill-fix-absent.reference.cs: ", lines[0], StringComparison.Ordinal);
    }

    [Fact]
    public void FileAtTheReferenceRootIsAToolFault()
    {
        using var parent = new TempFolder();
        parent.Write("reference", "not a folder\n");
        var root = Path.Combine(parent.Path, "reference");

        var (code, lines) = Run(root);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(root)}: not a folder", "FAIL code check"], lines);
    }

    // Groups run first; the fault meets the starter, the reference or the wrong solution.
    [Theory]
    [InlineData(0, $"/practice/drills/{Drill}.md starter")]
    [InlineData(1, $"/{Drill}.reference.cs")]
    [InlineData(2, $"/{Drill}.empty-input.wrong.cs")]
    public void StartUpFaultInASuiteRunExitsTwo(int run, string name)
    {
        var (_, groups) = Fixtures.Assemble("all-containers");
        var backend = new FaultAt(groups.Count(g => g.Blocks[0].Fail is null) + run);

        var (code, lines) = Checker.RunWith(Checker.RepositoryRoot, backend, RunLimits.Launch, Checker.SchemaFolder, Content, Solutions);

        Assert.Equal(2, code);
        Assert.Equal("FAIL code check", lines[^1]);
        Assert.EndsWith($"{name}: exited with status 3 before its start record", lines[^2], StringComparison.Ordinal);
    }

    private static (int Code, string[] Lines) Run(string reference) =>
        Checker.RunWith(Checker.RepositoryRoot, null, RunLimits.Launch, Checker.SchemaFolder, Content, reference);

    private static TempFolder Copy()
    {
        var copy = new TempFolder();
        foreach (var file in Directory.GetFiles(Solutions))
        {
            File.Copy(file, Path.Combine(copy.Path, Path.GetFileName(file)));
        }

        return copy;
    }

    // This OS's backend, whose start-up fault seam meets only the child started at the given index.
    private sealed class FaultAt(int faulted) : IRunBackend
    {
        private readonly IRunBackend _plain = Runs.Backend();
        private readonly IRunBackend _faulty = Pid.Watch([], WindowsFault.StartUp, LinuxFault.StartUp);
        private int _started;

        public bool ReportsProcessGroup => _plain.ReportsProcessGroup;

        public string Canonical(string directory) => _plain.Canonical(directory);

        public IRunningChild Start(ChildLaunch launch, OutputSink output) => (_started++ == faulted ? _faulty : _plain).Start(launch, output);
    }
}
