using SharpLadder.Content;

namespace SharpLadder.CodeCheck;

// Usage: SharpLadder.CodeCheck <schema folder> <content root>, both absolute, run from the
// repository root, whose tools/ and .tools/ hold the pins, the reference set and the runtime.
// Each code group runs in a child process, which is not a sandbox, so only reviewed content runs.
// Exit codes: 0 all pass, 1 content failures, 2 usage, tool or environment error.
internal static class Cli
{
    private const string Stage = "code check";

    private static readonly string[] Usage =
    [
        "usage: SharpLadder.CodeCheck <schema folder> <content root>, both absolute, run from the repository root",
        "each code group runs in a child process, which is not a sandbox: run only reviewed content",
    ];

    public static int Run(IReadOnlyList<string> args, TextWriter output) => Run(args, output, Environment.CurrentDirectory);

    // Tests give a stand-in repository root; the checker itself always uses the current folder.
    internal static int Run(IReadOnlyList<string> args, TextWriter output, string repositoryRoot)
    {
        try
        {
            return Check(args, output, repositoryRoot);
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

    private static int Check(IReadOnlyList<string> args, TextWriter output, string repositoryRoot)
    {
        // Another OS has no process lifecycle here, and a required check is never skipped.
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsWindows())
        {
            return Fail(output, 2, ["the code check runs on Linux and Windows only"]);
        }

        if (args.Count != 2)
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

        if (plan.Blocks.Count == 0)
        {
            return Pass(output, 0);
        }

        var assembled = Assembler.Assemble([.. plan.Blocks.Select(PlanSource.Copy)]);
        if (assembled.Failures.Count > 0)
        {
            return Fail(output, 1, assembled.Failures.Select(f => f.ToString()));
        }

        return RunGroups(output, assembled.Groups, new GroupCompiler(references.References), new GroupRunner(locations, Backend()));
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

    // One group at a time in the assembler's order; a tool failure stops the run, after the content
    // failures already found.
    private static int RunGroups(TextWriter output, IReadOnlyList<GroupProgram> groups, GroupCompiler compiler, GroupRunner runner)
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
        }
        catch (ToolProblem e)
        {
            return Fail(output, 2, [.. failures, e.Message]);
        }

        return failures.Count > 0 ? Fail(output, 1, failures) : Pass(output, groups.Count);
    }

    private static int Pass(TextWriter output, int groups)
    {
        output.WriteLine(groups == 1 ? "1 group" : $"{groups} groups");
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
