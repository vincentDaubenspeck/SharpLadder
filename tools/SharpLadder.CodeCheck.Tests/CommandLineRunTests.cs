using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The command line end to end on content roots written here, with code groups that run.
public sealed class CommandLineRunTests
{
    private const string SyntaxHead = "---\nkind: syntax\nchapter: ch-run\norder: 3\n---\n\n";

    [Fact]
    public void PassingGroupExitsZero()
    {
        Runs.RequireBackend();
        using var root = Root(Chapter(string.Empty), SyntaxHead + Sum("total == 5"));

        var (code, lines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder, root.Path);

        Assert.Equal(0, code);
        Assert.Equal(["1 group", "PASS code check"], lines);
    }

    [Fact]
    public void FalseCheckAtRunTimeExitsOne()
    {
        Runs.RequireBackend();
        using var root = Root(Chapter(string.Empty), SyntaxHead + Sum("total == 6"));

        var (code, lines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder, root.Path);

        Assert.Equal(1, code);
        Assert.Equal([$"  {Checker.Shown(root.Path)}/chapters/run/syntax.md:9 sum-1 check is false: total == 6", "FAIL code check"], lines);
    }

    [Fact]
    public void GroupsRunOneAtATimeByFileThenFirstLine()
    {
        Runs.RequireBackend();
        var name = $"o-{Guid.NewGuid():N}.log";
        var log = Path.Combine(Path.GetTempPath(), name);
        using var root = Root(
            Chapter(Marking("start-1", "zeta", name)),
            SyntaxHead + "## Later letters {#syn-later}\n\n" + Marking("beta-1", "beta", name) + "\n" + Marking("alpha-1", "alpha", name));
        try
        {
            var (code, lines) = Checker.Run(Checker.RepositoryRoot, Checker.SchemaFolder, root.Path);

            Assert.Equal((0, "zeta+ zeta- beta+ beta- alpha+ alpha- "), (code, File.ReadAllText(log)));
            Assert.Equal(["3 groups", "PASS code check"], lines);
        }
        finally
        {
            File.Delete(log);
        }
    }

    // The checker as its own process inside a job the test holds, so the group's job nests in it.
    [Fact]
    public void CheckerInsideAnOuterJobRunsItsGroup()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "nested jobs exist only on Windows");
        using var root = Root(Chapter(string.Empty), SyntaxHead + Sum("total == 5"));
        var checker = Path.Combine(AppContext.BaseDirectory, "SharpLadder.CodeCheck.dll");
        var environment = Environment.GetEnvironmentVariables().Cast<System.Collections.DictionaryEntry>()
            .Select(e => new KeyValuePair<string, string>((string)e.Key, (string)e.Value!))
            .ToList();
        var launch = new ChildLaunch(Locations.FromRepository(Checker.RepositoryRoot).Muxer, ["exec", checker, Checker.SchemaFolder, root.Path], Checker.RepositoryRoot, environment);

        ChildState end;
        using (var outer = Runs.Backend().Start(launch))
        {
            end = outer.Wait(TimeSpan.FromMinutes(1));
            var cleanup = Deadline.After(RunLimits.Cleanup);
            outer.Terminate(cleanup);
            outer.AwaitReaders(cleanup);
        }

        Assert.Equal(new ChildState.Exited(0), end);
    }

    private static TempFolder Root(string chapter, string syntax)
    {
        var root = Checker.EmptyRoot();
        root.Write("chapters/run/chapter.md", chapter);
        root.Write("chapters/run/syntax.md", syntax);
        return root;
    }

    private static string Chapter(string start) =>
        "---\nid: ch-run\nslug: run\ntitle: Run\norder: 1\ntargets: { csharp: 14, dotnet: 10 }\n---\n\n"
        + "A chapter whose code blocks run.\n\n## Start {#run-start}\n\n" + (start.Length == 0 ? "The part beside this file holds the code.\n" : start);

    private static string Sum(string check) =>
        $"## Sum {{#syn-sum}}\n\n```csharp {{#sum-1 group=sum check=\"{check}\" spoken=\"Adds two numbers\"}}\nint total = 2 + 3;\n```\n";

    // A group that marks its start and end in a shared log, with a pause between, so overlap would show.
    private static string Marking(string id, string group, string name) =>
        $"```csharp {{#{id} group={group} spoken=\"Marks the log\"}}\n"
        + $"var log = Path.GetTempPath() + \"{name}\";\n"
        + $"File.AppendAllText(log, \"{group}+ \");\n"
        + "Thread.Sleep(50);\n"
        + $"File.AppendAllText(log, \"{group}- \");\n"
        + "```\n";
}
