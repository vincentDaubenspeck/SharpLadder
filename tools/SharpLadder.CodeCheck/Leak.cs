using SharpLadder.Content;

namespace SharpLadder.CodeCheck;

// Usage: SharpLadder.CodeCheck leak <schema folder> <content root> <reference root> <target>..., all
// absolute, run from the repository root. Each target is build output: a folder, walked without
// following a link, a docker save image (a file ending .tar, read by DockerSave), or any other file,
// scanned as one text. A target that is itself a link, or yields no file, is refused. No reference
// solution, wrong solution or marker line may reach one.
// Exit codes: 0 nothing found, 1 a finding or a reference root failure, 2 the scan cannot run.
internal static class Leak
{
    public const string ExclusionsShown = "tools/SharpLadder.CodeCheck/leak-exclusions.txt";

    private const string Stage = "leak";

    private static readonly string[] Usage =
    [
        "usage: SharpLadder.CodeCheck leak <schema folder> <content root> <reference root> <target>..., all absolute, run from the repository root",
    ];

    // Tests may give a lower bound on one file of a folder target; the command always uses
    // LeakText.MaxBytes.
    public static int Run(IReadOnlyList<string> args, TextWriter output, string repositoryRoot, long fileLimit = LeakText.MaxBytes)
    {
        // A scan that cannot finish still reports the findings made before it stopped.
        var findings = new List<string>();
        try
        {
            return Scan(args, output, repositoryRoot, fileLimit, findings);
        }
        catch (Exception e) when (e is ToolProblem or BoundaryException)
        {
            return Fail(output, 2, [.. findings, e.Message]);
        }
        catch (Exception e)
        {
            // The last boundary: nothing ends the scan without a diagnostic and a documented exit code.
            return Fail(output, 2, [.. findings, $"unexpected error: {e.GetType().Name}: {e.Message}"]);
        }
    }

    private static int Scan(IReadOnlyList<string> args, TextWriter output, string repositoryRoot, long fileLimit, List<string> findings)
    {
        if (args.Count < 4)
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

        var exclusions = Exclusions(repositoryRoot);
        var (diagnostics, suites) = PlanSource.ReadSuites(args[0], args[1]);
        if (diagnostics.Count > 0)
        {
            // The starters and suites filter the scan, so content the compiler refuses stops it.
            return Fail(output, 2, diagnostics);
        }

        var solutions = SolutionRoot.Read(args[2], ContentCompiler.DisplayPath(Environment.CurrentDirectory, args[2]), [.. suites.Select(s => s.Subject)]);
        if (solutions.Failures.Count > 0)
        {
            return Fail(output, 1, solutions.Failures);
        }

        var scanner = new LeakScanner(suites, solutions, exclusions, findings);
        var files = 0;
        foreach (var target in args.Skip(3))
        {
            // The count is summed, so a pass must not rest on another target's files.
            var display = ContentCompiler.DisplayPath(Environment.CurrentDirectory, target);
            var scanned = Target(target, display, scanner, fileLimit);
            files += scanned > 0 ? scanned : throw new ToolProblem($"{display}: holds no file to scan; a target must yield at least one");
        }

        if (findings.Count > 0)
        {
            return Fail(output, 1, findings);
        }

        output.WriteLine(files == 1 ? "1 file scanned" : $"{files} files scanned");
        output.WriteLine("PASS " + Stage);
        return 0;
    }

    // Each entry needs a comment line directly above it saying why the line is generic, so no line
    // is left out of the comparison without a recorded reason.
    private static HashSet<string> Exclusions(string repositoryRoot)
    {
        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(Path.Combine(repositoryRoot, "tools", "SharpLadder.CodeCheck", "leak-exclusions.txt"));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{ExclusionsShown}: missing or unreadable ({e.GetType().Name})", e);
        }

        var (text, refusal) = TextAdmission.Read(bytes, ExclusionsShown);
        if (refusal is not null)
        {
            throw new ToolProblem(refusal.ToString());
        }

        var entries = new HashSet<string>(StringComparer.Ordinal);
        var reason = false;
        foreach (var (line, index) in text!.Split('\n').Select((l, i) => (LeakText.Normalise(l), i)))
        {
            if (line.Length == 0 || line.StartsWith('#'))
            {
                reason = line.Length > 1;
                continue;
            }

            if (!reason)
            {
                throw new ToolProblem($"{ExclusionsShown}:{index + 1}: an entry needs a comment line directly above it saying why the line is generic");
            }

            entries.Add(line);
            reason = false;
        }

        return entries;
    }

    // The number of files scanned. A docker save image is read by its own walker, not as text.
    private static int Target(string path, string display, LeakScanner scanner, long fileLimit)
    {
        if (OwnAttributes(path, display) is { } attributes && attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw new ToolProblem($"{display}: links and reparse points are not accepted as a target or below one");
        }

        if (Directory.Exists(path))
        {
            return ScanFolder(path, display, scanner, fileLimit);
        }

        if (!File.Exists(path))
        {
            throw new ToolProblem($"{display}: missing or unreadable; a target must be a folder or a file");
        }

        if (path.EndsWith(".tar", StringComparison.OrdinalIgnoreCase))
        {
            return DockerSave.Scan(path, display, scanner);
        }

        byte[] bytes;
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            bytes = LeakText.Read(stream, display);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{display}: could not be read ({e.GetType().Name})", e);
        }

        scanner.Scan(display, LeakText.Views(Path.GetFileName(path), bytes, display));
        return 1;
    }

    // The target entry's own attributes, or null when there is no entry: neither OS follows a link
    // at the last component to answer, so a link is seen before Folder.OpenRoot would follow it.
    private static FileAttributes? OwnAttributes(string path, string display)
    {
        try
        {
            return File.GetAttributes(Path.TrimEndingDirectorySeparator(path));
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{display}: could not be read ({e.GetType().Name})", e);
        }
    }

    private static int ScanFolder(string path, string display, LeakScanner scanner, long fileLimit)
    {
        InputTree tree;
        try
        {
            using var root = Folder.OpenRoot(path, display);
            tree = InputTree.Read(root, fileLimit);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{display}: could not be read ({e.GetType().Name})", e);
        }

        return Walk(tree, string.Empty, scanner);
    }

    private static int Walk(InputTree tree, string relative, LeakScanner scanner)
    {
        var files = 0;
        foreach (var entry in tree.Children(relative))
        {
            if (entry.IsFolder)
            {
                files += Walk(tree, entry.Relative, scanner);
                continue;
            }

            scanner.Scan(entry.Display, LeakText.Views(entry.Name, entry.Bytes!, entry.Display));
            files++;
        }

        return files;
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
