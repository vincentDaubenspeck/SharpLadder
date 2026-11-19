using System.Security;
using SharpLadder.Content;

namespace SharpLadder.CodeCheck;

// The reference root (PD 7.5): trusted, reviewed source that only the code check opens, to build
// temporary assemblies; nothing that ships is made from its bytes. It is flat, and each file belongs
// to exactly one subject: <id>.reference.cs or <id>.<kind>.wrong.cs.
internal static class SolutionRoot
{
    private const string ReferenceSuffix = ".reference.cs";
    private const string WrongSuffix = ".wrong.cs";

    private static readonly EnumerationOptions Listing = new()
    {
        AttributesToSkip = FileAttributes.None,
        IgnoreInaccessible = false,
        MatchType = MatchType.Simple,
        RecurseSubdirectories = false,
        ReturnSpecialDirectories = false,
    };

    // The fixed kinds of PD 13.9.
    public static IReadOnlyList<string> Kinds { get; } = ["off-by-one", "empty-input", "single-element", "duplicates", "negatives", "overflow", "order"];

    // Content failures exit 1. Anything that keeps the root from being read as itself throws
    // ToolProblem (exit 2) and is never taken for an absent root.
    public static SolutionSet Read(string path, string display, IReadOnlyCollection<string> subjects)
    {
        var known = subjects.ToHashSet(StringComparer.Ordinal);
        try
        {
            return Present(path, display) ? ReadPresent(path, display, known) : new SolutionSet([.. known.Order(StringComparer.Ordinal).Select(s => Missing(display, s))], []);
        }
        catch (BoundaryException e)
        {
            throw new ToolProblem(e.Message, e);
        }
    }

    private static SolutionSet ReadPresent(string path, string display, HashSet<string> known)
    {
        InputTree tree;
        using (var root = Open(path, display))
        {
            tree = Tree(root, display);
        }

        var failures = new List<string>();
        var files = new List<SolutionFile>();
        var named = new List<(string Subject, string? Kind)>();
        foreach (var entry in tree.Children(string.Empty))
        {
            if (entry.IsFolder)
            {
                failures.Add($"{entry.Display}: a subfolder is not accepted; the reference root is flat");
                continue;
            }

            if (Classify(entry.Name, known) is not { Subject: { } subject } classified)
            {
                failures.Add($"{entry.Display}: {NameProblem(entry.Name, known)}");
                continue;
            }

            named.Add((subject, classified.Kind));
            var (text, refusal) = TextAdmission.Read(entry.Bytes!, entry.Display);
            if (refusal is not null)
            {
                failures.Add(refusal.ToString());
                continue;
            }

            var marker = classified.Kind is { } kind ? $"// wrong: {subject} {kind}" : $"// reference: {subject}";
            var newline = text!.IndexOf('\n', StringComparison.Ordinal);
            if (!string.Equals(newline < 0 ? text : text[..newline], marker, StringComparison.Ordinal))
            {
                failures.Add($"{entry.Display}:1: the first line must be exactly \"{marker}\"");
                continue;
            }

            files.Add(new SolutionFile(subject, classified.Kind, entry.Display, text));
        }

        failures.AddRange(Unsolved(display, known, named));
        return failures.Count > 0 ? new SolutionSet(failures, []) : new SolutionSet([], files);
    }

    // A subject whose file is there but refused is reported for that file only.
    private static IEnumerable<string> Unsolved(string display, HashSet<string> subjects, List<(string Subject, string? Kind)> named)
    {
        foreach (var subject in subjects.Order(StringComparer.Ordinal))
        {
            if (!named.Contains((subject, null)))
            {
                yield return Missing(display, subject);
            }

            if (!named.Any(n => string.Equals(n.Subject, subject, StringComparison.Ordinal) && n.Kind is not null))
            {
                yield return $"{display}: {subject}: no wrong solution; add at least one {subject}.<kind>{WrongSuffix}";
            }
        }
    }

    private static string Missing(string display, string subject) =>
        $"{display}: {subject}: reference file missing ({subject}{ReferenceSuffix})";

    // The parent is listed and the root's name matched exactly, case included, so a link is seen as a
    // link and never followed; only a missing entry means absent.
    private static bool Present(string path, string display)
    {
        if (KernelPath.EntryProblem(path) is { } problem)
        {
            throw new ToolProblem($"{display}: {problem}");
        }

        var trimmed = Path.TrimEndingDirectorySeparator(path);
        var parent = Path.GetDirectoryName(trimmed);
        var name = Path.GetFileName(trimmed);
        if (parent is null || name.Length == 0)
        {
            throw new ToolProblem($"{display}: a reference root needs a parent folder");
        }

        List<FileSystemInfo> entries;
        try
        {
            entries = [.. new DirectoryInfo(parent).EnumerateFileSystemInfos("*", Listing).Where(e => string.Equals(e.Name, name, StringComparison.OrdinalIgnoreCase))];
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or SecurityException)
        {
            throw new ToolProblem($"{display}: the folder above it could not be listed ({e.GetType().Name})", e);
        }

        if (entries.Find(e => !string.Equals(e.Name, name, StringComparison.Ordinal)) is { } variant)
        {
            throw new ToolProblem($"{display}: the folder above it holds {variant.Name}, which differs from {name} only in case");
        }

        if (entries.Count == 0)
        {
            return false;
        }

        if (entries[0].Attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw new ToolProblem($"{display}: links and reparse points are not accepted at or below a root folder");
        }

        return entries[0] is DirectoryInfo ? true : throw new ToolProblem($"{display}: not a folder");
    }

    private static Folder Open(string path, string display)
    {
        try
        {
            return Folder.OpenRoot(path, display);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{display}: could not be opened ({e.GetType().Name})", e);
        }
    }

    private static InputTree Tree(Folder root, string display)
    {
        try
        {
            return InputTree.Read(root);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"{display}: could not be read ({e.GetType().Name})", e);
        }
    }

    // The subject and kind (null for the reference) a name gives, or nothing when it gives none.
    private static (string? Subject, string? Kind) Classify(string name, HashSet<string> subjects)
    {
        string stem;
        string? kind = null;
        if (name.EndsWith(ReferenceSuffix, StringComparison.Ordinal))
        {
            stem = name[..^ReferenceSuffix.Length];
        }
        else if (name.EndsWith(WrongSuffix, StringComparison.Ordinal) && name[..^WrongSuffix.Length] is var rest && rest.LastIndexOf('.') is var dot and >= 0)
        {
            stem = rest[..dot];
            kind = rest[(dot + 1)..];
        }
        else
        {
            return (null, null);
        }

        return subjects.Contains(stem) && (kind is null || Kinds.Contains(kind, StringComparer.Ordinal)) ? (stem, kind) : (null, null);
    }

    private static string NameProblem(string name, HashSet<string> subjects)
    {
        var lower = name.ToLowerInvariant();
        if (!string.Equals(lower, name, StringComparison.Ordinal) && Classify(lower, subjects).Subject is not null)
        {
            return $"differs from {lower} only in case";
        }

        if (name.EndsWith(WrongSuffix, StringComparison.Ordinal) && name[..^WrongSuffix.Length] is var rest && rest.LastIndexOf('.') is var dot and >= 0)
        {
            return subjects.Contains(rest[..dot])
                ? $"wrong-solution kind {rest[(dot + 1)..]} is not one of {string.Join(", ", Kinds)}"
                : $"names no problem or drill of the content ({rest[..dot]}); a solution belongs to exactly one";
        }

        return name.EndsWith(ReferenceSuffix, StringComparison.Ordinal)
            ? $"names no problem or drill of the content ({name[..^ReferenceSuffix.Length]}); a solution belongs to exactly one"
            : $"not a solution file; name it <id>{ReferenceSuffix} or <id>.<kind>{WrongSuffix}";
    }
}
