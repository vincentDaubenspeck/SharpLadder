using SharpLadder.Content;

namespace SharpLadder.CodeCheck;

// Usage: SharpLadder.CodeCheck <schema folder> <content root> <reference root>, all absolute, run
// from the repository root, whose tools/ and .tools/ hold the pins, the reference set and the
// runtime. Each code group and each suite run is a child process, which is not a sandbox, so only
// reviewed content and reviewed solutions run. The leak scan has its own form, described in Leak.
// Exit codes: 0 all pass, 1 content failures, 2 usage, tool or environment error.
internal static class Cli
{
    private const string Stage = "code check";

    private static readonly string[] Usage =
    [
        "usage: SharpLadder.CodeCheck <schema folder> <content root> <reference root>, all absolute, run from the repository root",
        "each code group and suite run is a child process, which is not a sandbox: run only reviewed content",
    ];

    public static int Run(IReadOnlyList<string> args, TextWriter output) => Run(args, output, Environment.CurrentDirectory);

    // Tests give a stand-in repository root, and may give a backend and a shorter suite deadline; the
    // checker itself always uses the current folder, this OS's backend and RunLimits.Suite.
    internal static int Run(IReadOnlyList<string> args, TextWriter output, string repositoryRoot, IRunBackend? backend = null, TimeSpan? suiteLimit = null)
    {
        // A schema folder is an absolute path, so it is never the word leak.
        if (args.Count > 0 && string.Equals(args[0], "leak", StringComparison.Ordinal))
        {
            return Leak.Run([.. args.Skip(1)], output, repositoryRoot);
        }

        try
        {
            return Check(args, output, repositoryRoot, backend, suiteLimit);
        }
        catch (Exception e) when (e is ToolProblem or BoundaryException)
        {
            return Fail(output, 2, [e.Message]);
        }
        catch (Exception e)
        {
            // The last boundary: nothing ends the run without a diagnostic and a documented exit code.
            return Fail(output, 2, [$"unexpected error: {e.GetType().Name}: {e.Message}"]);
        }
    }

    private static int Check(IReadOnlyList<string> args, TextWriter output, string repositoryRoot, IRunBackend? backend, TimeSpan? suiteLimit)
    {
        // Another OS has no process lifecycle here, and a required check is never skipped.
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsWindows())
        {
            return Fail(output, 2, ["the code check runs on Linux and Windows only"]);
        }

        if (args.Count != 3)
        {
            return Fail(output, 2, Usage);
        }

        var forms = args
            .Select(a => KernelPath.EntryProblem(a) is { } problem ? $"{a}: {problem}" : null)
            .OfType<string>()
            .ToList();
        if (forms.Count > 0)
        {
            return Fail(output, 2, forms);
        }

        var locations = Locations.FromRepository(repositoryRoot);
        using var references = ReferenceSet.Load(locations);

        using var schemaFolder = Folder.OpenRoot(args[0], args[0]);
        using var contentRoot = Folder.OpenRoot(args[1], ContentCompiler.DisplayPath(Environment.CurrentDirectory, args[1]));
        var schemaTree = InputTree.Read(schemaFolder);
        var contentTree = InputTree.ReadContent(contentRoot);
        var (schema, schemaProblems) = SchemaSet.Load(schemaTree);
        if (schema is null)
        {
            return Fail(output, 2, schemaProblems.Select(p => "schema: " + p));
        }

        var plan = ContentCompiler.Plan(contentTree, schema);
        if (plan.Diagnostics.Count > 0)
        {
            return Fail(output, 1, plan.Diagnostics.Select(d => d.ToString()));
        }

        // Opened only here: no compile, payload or index command can reach the reference root.
        var suites = plan.Subjects.Select(PlanSource.Copy).ToList();
        var solutions = SolutionRoot.Read(args[2], ContentCompiler.DisplayPath(Environment.CurrentDirectory, args[2]), [.. suites.Select(s => s.Subject)]);

        var assembled = Assembler.Assemble([.. plan.Blocks.Select(PlanSource.Copy)]);
        if (assembled.Failures.Count > 0)
        {
            return Fail(output, 1, [.. assembled.Failures.Select(f => f.ToString()), .. solutions.Failures]);
        }

        var chosen = backend ?? Backend();
        var groups = new GroupRunner(locations, chosen);
        var suiteRunner = new SuiteRunner(locations, chosen, new SuiteCompiler(references.References), suiteLimit);
        return RunAll(output, assembled.Groups, new GroupCompiler(references.References), groups, suites, solutions, suiteRunner);
    }

    // The guard at the top of Check leaves Linux and Windows only.
    private static IRunBackend Backend()
    {
        if (OperatingSystem.IsWindows())
        {
            return new WindowsBackend();
        }

        return OperatingSystem.IsLinux() ? new LinuxBackend() : throw new ToolProblem("the code check runs on Linux and Windows only");
    }

    // One group at a time in the assembler's order, then the suites, unless the reference root failed;
    // a tool failure stops the run, after the content failures already found.
    private static int RunAll(TextWriter output, IReadOnlyList<GroupProgram> groups, GroupCompiler compiler, GroupRunner runner, IReadOnlyList<SuitePlan> suites, SolutionSet solutions, SuiteRunner suiteRunner)
    {
        var failures = new List<string>();
        try
        {
            foreach (var program in groups)
            {
                var outcome = compiler.Compile(program);
                failures.AddRange(outcome.Failures.Select(f => f.ToString()));
                if (outcome.Ready is { } ready && runner.Run(ready) is { } failure)
                {
                    failures.Add(failure.ToString());
                }
            }

            failures.AddRange(solutions.Failures);
            if (solutions.Failures.Count == 0)
            {
                suiteRunner.Check(suites, solutions, failures);
            }
        }
        catch (ToolProblem e)
        {
            return Fail(output, 2, [.. failures, e.Message]);
        }

        return failures.Count > 0 ? Fail(output, 1, failures) : Pass(output, groups.Count, suiteRunner.Runs);
    }

    private static int Pass(TextWriter output, int groups, int runs)
    {
        output.WriteLine(groups == 1 ? "1 group" : $"{groups} groups");
        output.WriteLine(runs == 1 ? "1 suite run" : $"{runs} suite runs");
        output.WriteLine("PASS " + Stage);
        return 0;
    }

    private static int Fail(TextWriter output, int code, IEnumerable<string> lines)
    {
        foreach (var line in lines)
        {
            output.WriteLine("  " + line);
        }

        output.WriteLine("FAIL " + Stage);
        return code;
    }
}
