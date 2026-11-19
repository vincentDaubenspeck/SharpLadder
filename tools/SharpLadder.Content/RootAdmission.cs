namespace SharpLadder.Content;

// Only these content-root entries are read, matched by exact ordinal name so a case variant is
// refused, never admitted. Semantic collection of chapters/ stays separate from this check.
internal static class RootAdmission
{
    public const string PracticeFolder = "practice";
    public const string MarkdownExtension = ".md";
    public const string SuiteExtension = ".tests.cs";
    public const string ProblemsIndex = "problems.yml";

    // The subject folders of practice/, each with the kind of record its files compile to.
    public static readonly (string Folder, RecordKind Kind)[] SubjectFolders = [("problems", RecordKind.Problem), ("drills", RecordKind.Drill)];

    private static readonly string[] Folders = ["chapters", "errors", "glossary", PracticeFolder, "schema"];
    private static readonly string[] Files = ["aliases.yml", "patterns.yml"];

    public static bool Admits(string name) =>
        Folders.Contains(name, StringComparer.Ordinal) || Files.Contains(name, StringComparer.Ordinal);

    public static void Check(InputTree tree, List<Diagnostic> diagnostics)
    {
        foreach (var entry in tree.Children(string.Empty))
        {
            if (Folders.Contains(entry.Name, StringComparer.Ordinal))
            {
                if (entry.IsFolder)
                {
                    CheckFolder(tree, entry, diagnostics);
                }
                else if (!string.Equals(entry.Name, "chapters", StringComparison.Ordinal))
                {
                    diagnostics.Add(new Diagnostic(entry.Display, null, "not a folder"));
                }
            }
            else if (Files.Contains(entry.Name, StringComparer.Ordinal))
            {
                if (entry.IsFolder)
                {
                    diagnostics.Add(new Diagnostic(entry.Display, null, "not a file"));
                }
                else
                {
                    AddRefusal(entry, diagnostics);
                }
            }
            else
            {
                diagnostics.Add(new Diagnostic(entry.Display, null, "the content root holds only chapters/, errors/, glossary/, practice/, schema/, aliases.yml and patterns.yml"));
            }
        }
    }

    // chapters/, errors/ and glossary/ are read by the collector; schema/ holds files only.
    private static void CheckFolder(InputTree tree, InputEntry folder, List<Diagnostic> diagnostics)
    {
        if (string.Equals(folder.Name, PracticeFolder, StringComparison.Ordinal))
        {
            CheckPractice(tree, folder, diagnostics);
            return;
        }

        if (!string.Equals(folder.Name, "schema", StringComparison.Ordinal))
        {
            return;
        }

        foreach (var entry in tree.Children(folder.Relative))
        {
            if (entry.IsFolder)
            {
                diagnostics.Add(new Diagnostic(entry.Display, null, "schema/ holds only files"));
            }
            else
            {
                AddRefusal(entry, diagnostics);
            }
        }
    }

    private static void CheckPractice(InputTree tree, InputEntry practice, List<Diagnostic> diagnostics)
    {
        foreach (var entry in tree.Children(practice.Relative))
        {
            if (SubjectFolders.Any(s => string.Equals(s.Folder, entry.Name, StringComparison.Ordinal)))
            {
                if (entry.IsFolder)
                {
                    CheckSubjects(tree, entry, diagnostics);
                }
                else
                {
                    diagnostics.Add(new Diagnostic(entry.Display, null, "not a folder"));
                }
            }
            else if (string.Equals(entry.Name, ProblemsIndex, StringComparison.Ordinal))
            {
                if (entry.IsFolder)
                {
                    diagnostics.Add(new Diagnostic(entry.Display, null, "not a file"));
                }
                else
                {
                    AddRefusal(entry, diagnostics);
                }
            }
            else
            {
                diagnostics.Add(new Diagnostic(entry.Display, null, "practice/ holds only problems/, drills/ and problems.yml"));
            }
        }
    }

    // A subject is its Markdown file and its suite, so neither stands without the other.
    private static void CheckSubjects(InputTree tree, InputEntry folder, List<Diagnostic> diagnostics)
    {
        var entries = tree.Children(folder.Relative);
        var files = entries.Where(e => !e.IsFolder).Select(e => e.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            var suite = Stem(entry.Name, SuiteExtension);
            var markdown = suite is null ? Stem(entry.Name, MarkdownExtension) : null;
            if (entry.IsFolder || (suite is null && markdown is null))
            {
                diagnostics.Add(new Diagnostic(entry.Display, null, $"{folder.Name}/ holds only <id>.md and <id>.tests.cs pairs"));
            }
            else if (suite is not null && !files.Contains(suite + MarkdownExtension))
            {
                diagnostics.Add(new Diagnostic(entry.Display, null, $"the suite has no {suite}.md beside it"));
            }
            else if (markdown is not null && !files.Contains(markdown + SuiteExtension))
            {
                diagnostics.Add(new Diagnostic(entry.Display, null, $"the practice file has no suite {markdown}.tests.cs beside it"));
            }
        }
    }

    // The name without the extension, or null when it does not end with it after a non-empty stem.
    private static string? Stem(string name, string extension) =>
        name.Length > extension.Length && name.EndsWith(extension, StringComparison.Ordinal) ? name[..^extension.Length] : null;

    private static void AddRefusal(InputEntry entry, List<Diagnostic> diagnostics)
    {
        var (_, refusal) = TextAdmission.Read(entry.Bytes!, entry.Display);
        if (refusal is not null)
        {
            diagnostics.Add(refusal);
        }
    }
}
