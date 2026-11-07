namespace SharpLadder.Content;

// Usage: SharpLadder.Content <schema folder> <content root> <output folder>
// Exit codes: 0 compiled, 1 content errors, 2 usage or environment error.
internal static class Cli
{
    private const string Stage = "content compiler";

    public static int Run(IReadOnlyList<string> args, TextWriter output)
    {
        try
        {
            return Compile(args, output);
        }
        catch (BoundaryException e)
        {
            return Fail(output, 2, [e.Message]);
        }
        catch (Exception e)
        {
            // The last boundary: nothing ends the run without a diagnostic and a documented exit code.
            return Fail(output, 2, [$"unexpected error: {e.GetType().Name}: {e.Message}"]);
        }
    }

    private static int Compile(IReadOnlyList<string> args, TextWriter output)
    {
        if (args.Count != 3)
        {
            return Fail(output, 2, ["usage: SharpLadder.Content <schema folder> <content root> <output folder>"]);
        }

        var forms = args
            .Select(a => KernelPath.EntryProblem(a) is { } problem ? $"{a}: {problem}" : null)
            .OfType<string>()
            .ToList();
        if (forms.Count > 0)
        {
            return Fail(output, 2, forms);
        }

        using var schemaFolder = Folder.OpenRoot(args[0], args[0]);
        using var contentRoot = Folder.OpenRoot(args[1], ContentCompiler.DisplayPath(Environment.CurrentDirectory, args[1]));
        var schemaTree = InputTree.Read(schemaFolder);
        var contentTree = InputTree.Read(contentRoot);
        var target = OutputTarget.Prepare(args[2], [(contentTree, "content root"), (schemaTree, "schema folder")]);
        var (schema, schemaProblems) = SchemaSet.Load(schemaTree);
        if (schema is null)
        {
            return Fail(output, 2, schemaProblems.Select(p => "schema: " + p));
        }

        var result = ContentCompiler.Compile(contentTree, schema);
        if (result.Diagnostics.Count > 0)
        {
            return Fail(output, 1, result.Diagnostics.Select(d => d.ToString()));
        }

        var problem = OutputWriter.Write(target, result.Files);
        if (problem is not null)
        {
            return Fail(output, 2, [$"{args[2]}: output not written: {problem}"]);
        }

        output.WriteLine($"{result.Files.Count} files, output digest sha256:{OutputDigest.Compute(result.Files)}");
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
