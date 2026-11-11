namespace SharpLadder.Content;

// Usage: SharpLadder.Content <schema folder> <content root> <output folder>
//        SharpLadder.Content generate|compare|update|test-records <schema folder> <content root>
//            <compiled folder> <generated folder> <staging folder>
//        SharpLadder.Content validate <schema folder> (one JSON document on standard input)
// Exit codes: 0 success, 1 content errors, drift or invalid input, 2 usage or environment error.
// test-records reports on standard error only; standard output carries the envelope alone.
internal static class Cli
{
    private static readonly string[] PayloadModeNames = ["generate", "compare", "update", "test-records"];

    public static int Run(IReadOnlyList<string> args, TextWriter output) =>
        Run(args, new CliStreams(output, output, () => Stream.Null, () => Stream.Null));

    // betweenDestinations runs after update publishes the first destination; tests change the file system there.
    public static int Run(IReadOnlyList<string> args, CliStreams io, Action? betweenDestinations = null)
    {
        var mode = args.Count > 0 && (PayloadModeNames.Contains(args[0], StringComparer.Ordinal) || string.Equals(args[0], "validate", StringComparison.Ordinal)) ? args[0] : null;
        var report = string.Equals(mode, "test-records", StringComparison.Ordinal) ? io.Error : io.Output;
        var stage = mode is null ? "content compiler" : "content " + mode;
        try
        {
            return mode switch
            {
                null => Compile(args, report, stage),
                "validate" => Validate(args, io, stage),
                _ => Paths(args, 6, report, stage) ?? PayloadModes.Run(mode, args.Skip(1).ToList(), io, report, stage, betweenDestinations),
            };
        }
        catch (BoundaryException e)
        {
            return Fail(report, stage, 2, [e.Message]);
        }
        catch (Exception e)
        {
            // The last boundary: nothing ends the run without a diagnostic and a documented exit code.
            return Fail(report, stage, 2, [$"unexpected error: {e.GetType().Name}: {e.Message}"]);
        }
    }

    public static int Fail(TextWriter output, string stage, int code, IEnumerable<string> lines)
    {
        foreach (var line in lines)
        {
            output.WriteLine("  " + line);
        }

        output.WriteLine("FAIL " + stage);
        return code;
    }

    // Null when the count is right and every path is in the accepted absolute form.
    private static int? Paths(IReadOnlyList<string> args, int count, TextWriter output, string stage)
    {
        if (args.Count != count)
        {
            return Fail(output, stage, 2, ["usage: see the head of Cli.cs for the arguments of each mode"]);
        }

        var forms = args
            .Skip(count == 3 ? 0 : 1)
            .Select(a => KernelPath.EntryProblem(a) is { } problem ? $"{a}: {problem}" : null)
            .OfType<string>()
            .ToList();
        return forms.Count > 0 ? Fail(output, stage, 2, forms) : null;
    }

    private static int Compile(IReadOnlyList<string> args, TextWriter output, string stage)
    {
        if (args.Count != 3)
        {
            return Fail(output, stage, 2, ["usage: SharpLadder.Content <schema folder> <content root> <output folder>"]);
        }

        if (Paths(args, 3, output, stage) is { } refused)
        {
            return refused;
        }

        using var schemaFolder = Folder.OpenRoot(args[0], args[0]);
        using var contentRoot = Folder.OpenRoot(args[1], ContentCompiler.DisplayPath(Environment.CurrentDirectory, args[1]));
        var schemaTree = InputTree.Read(schemaFolder);
        var contentTree = InputTree.Read(contentRoot);
        var target = OutputTarget.Prepare(args[2], [(contentTree, "content root"), (schemaTree, "schema folder")]);
        var (schema, schemaProblems) = SchemaSet.Load(schemaTree);
        if (schema is null)
        {
            return Fail(output, stage, 2, schemaProblems.Select(p => "schema: " + p));
        }

        var result = ContentCompiler.Compile(contentTree, schema);
        if (result.Diagnostics.Count > 0)
        {
            return Fail(output, stage, 1, result.Diagnostics.Select(d => d.ToString()));
        }

        var problem = OutputWriter.Write(target, result.Files);
        if (problem is not null)
        {
            return Fail(output, stage, 2, [$"{args[2]}: output not written: {problem}"]);
        }

        output.WriteLine($"{result.Files.Count} files, output digest sha256:{OutputDigest.Compute(result.Files)}");
        output.WriteLine("PASS " + stage);
        return 0;
    }

    // A utility for one document; the round trip reads committed files through test-records instead.
    private static int Validate(IReadOnlyList<string> args, CliStreams io, string stage)
    {
        if (Paths(args, 2, io.Output, stage) is { } refused)
        {
            return refused;
        }

        using var schemaFolder = Folder.OpenRoot(args[1], args[1]);
        var (schema, problems) = SchemaSet.Load(InputTree.Read(schemaFolder));
        if (schema is null)
        {
            return Fail(io.Output, stage, 2, problems.Select(p => "schema: " + p));
        }

        using var input = io.OpenStandardInput();
        using var buffer = new MemoryStream();
        input.CopyTo(buffer);
        var (envelope, refusals) = TestRecords.Build(new Dictionary<string, byte[]>(StringComparer.Ordinal) { ["compiled/stdin.json"] = buffer.ToArray() }, schema);
        if (envelope is null)
        {
            return Fail(io.Output, stage, 1, refusals.Select(r => r.Replace("compiled/stdin.json", "standard input", StringComparison.Ordinal)));
        }

        io.Output.WriteLine("PASS " + stage);
        return 0;
    }
}
