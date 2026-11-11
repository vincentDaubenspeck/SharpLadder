namespace SharpLadder.Content;

// The payload modes over the input roots, the committed folders and a fresh staging folder.
// Generation always writes into staging first, and only a fully written staging tree is compared
// or published; compare and test-records never write the committed folders.
internal static class PayloadModes
{
    private const string CompiledRole = "committed compiled folder";
    private const string GeneratedRole = "committed generated folder";
    private const string StagingRole = "staging folder";

    public static int Run(string mode, IReadOnlyList<string> paths, CliStreams io, TextWriter report, string stage, Action? betweenDestinations)
    {
        using var schemaFolder = Folder.OpenRoot(paths[0], paths[0]);
        using var contentFolder = Folder.OpenRoot(paths[1], paths[1]);
        List<(InputTree Tree, string Role)> inputs = [(InputTree.Read(schemaFolder), "schema folder"), (InputTree.ReadContent(contentFolder), "content root")];
        CheckTreesApart(inputs);
        if (string.Equals(mode, "update", StringComparison.Ordinal))
        {
            return Update(inputs, paths, report, stage, betweenDestinations);
        }

        using var held = new Held();
        var committed = ReadCommitted(mode, paths, inputs, held, out var absent);
        List<(InputTree Tree, string Role)> roots = [.. inputs, .. committed.Select(c => (c.Tree, c.Role))];
        CheckTreesApart(roots);
        var staging = OutputTarget.Prepare(paths[4], roots);
        foreach (var (target, role) in absent)
        {
            staging.CheckApart(target, role);
        }

        var (files, schema, code, problems) = Payload.Generate(inputs[0].Tree, inputs[1].Tree);
        if (files is null)
        {
            return Cli.Fail(report, stage, code, problems);
        }

        if (OutputWriter.Write(staging, files) is { } written)
        {
            return Cli.Fail(report, stage, 2, [$"{paths[4]}: staging not written: {written}"]);
        }

        using var stagingRoot = Folder.OpenRoot(paths[4], paths[4]);
        var fresh = ReadBack(InputTree.Read(stagingRoot), files);

        return string.Equals(mode, "generate", StringComparison.Ordinal)
            ? Pass(report, stage, $"{files.Count} files written to staging, manifest sha256:{ManifestHash(files)}")
            : Check(mode, fresh, committed, schema!, io, report, stage);
    }

    // The committed folders, read before anything is written so staging can be kept out of them;
    // generate alone accepts an absent one, which it keeps apart by path instead.
    private static List<(InputTree Tree, string Role, string Prefix)> ReadCommitted(string mode, IReadOnlyList<string> paths, List<(InputTree Tree, string Role)> inputs, Held held, out List<(OutputTarget Target, string Role)> absent)
    {
        var committed = new List<(InputTree Tree, string Role, string Prefix)>();
        absent = [];
        foreach (var (path, role, prefix) in new[] { (paths[2], CompiledRole, Payload.CompiledFolder), (paths[3], GeneratedRole, Payload.GeneratedFolder) })
        {
            if (string.Equals(mode, "generate", StringComparison.Ordinal) && IsAbsent(path))
            {
                absent.Add((OutputTarget.Prepare(path, inputs), role));
                continue;
            }

            committed.Add((InputTree.Read(held.Keep(Folder.OpenRoot(path, path))), role, prefix + "/"));
        }

        return committed;
    }

    private static int Check(string mode, Dictionary<string, byte[]> fresh, List<(InputTree Tree, string Role, string Prefix)> committed, IContentSchema schema, CliStreams io, TextWriter report, string stage)
    {
        var current = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var (tree, _, prefix) in committed)
        {
            Payload.Collect(tree, prefix, current);
        }

        var drift = Payload.Compare(fresh, current);
        if (drift.Count > 0)
        {
            return Cli.Fail(report, stage, 1, drift);
        }

        if (string.Equals(mode, "compare", StringComparison.Ordinal))
        {
            return Pass(report, stage, $"{current.Count} committed files equal fresh output");
        }

        // The envelope is built from the committed bytes the comparison just accepted.
        var (envelope, refusals) = TestRecords.Build(current, schema);
        if (envelope is null)
        {
            return Cli.Fail(report, stage, 1, refusals);
        }

        TestRecords.Write(io.OpenStandardOutput, envelope);
        return 0;
    }

    // Both destinations are checked before generation; each is written only from the re-read
    // staging tree, the compiled folder first; a failure after it names what was published.
    private static int Update(List<(InputTree Tree, string Role)> inputs, IReadOnlyList<string> paths, TextWriter report, string stage, Action? betweenDestinations)
    {
        var (compiledPath, generatedPath, stagingPath) = (paths[2], paths[3], paths[4]);
        var compiled = OutputTarget.Prepare(compiledPath, inputs);
        var generated = OutputTarget.Prepare(generatedPath, inputs);
        var staging = OutputTarget.Prepare(stagingPath, inputs);
        compiled.CheckApart(generated, "generated destination");
        generated.CheckApart(compiled, "compiled destination");
        compiled.CheckApart(staging, StagingRole);
        generated.CheckApart(staging, StagingRole);

        var (files, _, code, problems) = Payload.Generate(inputs[0].Tree, inputs[1].Tree);
        if (files is null)
        {
            return Cli.Fail(report, stage, code, problems);
        }

        if (OutputWriter.Write(staging, files) is { } written)
        {
            return Cli.Fail(report, stage, 2, [$"{stagingPath}: staging not written: {written}", "nothing was published"]);
        }

        using var stagingRoot = Folder.OpenRoot(stagingPath, stagingPath);
        var stagingTree = InputTree.Read(stagingRoot);
        _ = ReadBack(stagingTree, files);
        List<(InputTree Tree, string Role)> sources = [.. inputs, (stagingTree, StagingRole)];
        if (Publish(compiledPath, sources, files, Payload.CompiledFolder) is { } first)
        {
            return Cli.Fail(report, stage, 2, [$"{compiledPath}: not written: {first}", "nothing was published"]);
        }

        string? second;
        try
        {
            betweenDestinations?.Invoke();
            second = Publish(generatedPath, sources, files, Payload.GeneratedFolder);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or BoundaryException)
        {
            second = e.Message;
        }

        if (second is not null)
        {
            string[] lines =
            [
                $"{generatedPath}: not written: {second}",
                $"partial publication: {compiledPath} was written and {generatedPath} was not; nothing is certified; remove {compiledPath} by hand before running update again",
            ];
            return Cli.Fail(report, stage, 2, lines);
        }

        return Pass(report, stage, $"{files.Count} files published, manifest sha256:{ManifestHash(files)}");
    }

    // Null on success, else the reason the destination holds nothing new.
    private static string? Publish(string destination, List<(InputTree Tree, string Role)> sources, IReadOnlyList<OutputFile> files, string folder)
    {
        var prefix = folder + "/";
        try
        {
            var target = OutputTarget.Prepare(destination, sources);
            var mine = files
                .Where(f => f.RelativePath.StartsWith(prefix, StringComparison.Ordinal))
                .Select(f => f with { RelativePath = f.RelativePath[prefix.Length..] })
                .ToList();
            return OutputWriter.Write(target, mine);
        }
        catch (BoundaryException e)
        {
            return e.Message;
        }
    }

    // Staging read back through the boundary must hold exactly what this run wrote.
    private static Dictionary<string, byte[]> ReadBack(InputTree tree, IReadOnlyList<OutputFile> files)
    {
        var back = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        Payload.Collect(tree, string.Empty, back);
        if (back.Count != files.Count || !files.All(f => back.TryGetValue(f.RelativePath, out var bytes) && bytes.AsSpan().SequenceEqual(f.Bytes)))
        {
            throw new BoundaryException($"{tree.Root.Display}: the staging folder no longer holds what this run wrote");
        }

        return back;
    }

    private static void CheckTreesApart(List<(InputTree Tree, string Role)> roots)
    {
        for (var i = 0; i < roots.Count; i++)
        {
            for (var j = 0; j < roots.Count; j++)
            {
                if (i != j && roots[i].Tree.FolderIds.Contains(roots[j].Tree.Root.Id))
                {
                    throw new BoundaryException($"{roots[j].Tree.Root.Display}: the {roots[j].Role} must lie outside the {roots[i].Role}, and must not be it");
                }
            }
        }
    }

    // A link that leads nowhere is not absent; opening it as a root then fails.
    private static bool IsAbsent(string path)
    {
        using var followed = KernelPath.TryOpen(path, path);
        using var unfollowed = KernelPath.TryOpen(path, path, follow: false);
        return followed is null && unfollowed is null;
    }

    private static string ManifestHash(IReadOnlyList<OutputFile> files) =>
        Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(files.Single(f => string.Equals(f.RelativePath, Payload.ManifestPath, StringComparison.Ordinal)).Bytes));

    private static int Pass(TextWriter report, string stage, string summary)
    {
        report.WriteLine(summary);
        report.WriteLine("PASS " + stage);
        return 0;
    }

    private sealed class Held : IDisposable
    {
        private readonly List<Folder> _folders = [];

        public Folder Keep(Folder folder)
        {
            _folders.Add(folder);
            return folder;
        }

        public void Dispose()
        {
            foreach (var folder in _folders)
            {
                folder.Dispose();
            }
        }
    }
}
