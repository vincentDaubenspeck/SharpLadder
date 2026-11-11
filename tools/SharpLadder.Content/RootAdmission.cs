namespace SharpLadder.Content;

// Only these content-root entries are read, matched by exact ordinal name so a case variant is
// refused, never admitted. Semantic collection of chapters/ stays separate from this check.
internal static class RootAdmission
{
    private static readonly string[] Folders = ["chapters", "schema"];
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
                diagnostics.Add(new Diagnostic(entry.Display, null, "the content root holds only chapters/, schema/, aliases.yml and patterns.yml"));
            }
        }
    }

    // chapters/ is read by the collector; schema/ holds files only.
    private static void CheckFolder(InputTree tree, InputEntry folder, List<Diagnostic> diagnostics)
    {
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

    private static void AddRefusal(InputEntry entry, List<Diagnostic> diagnostics)
    {
        var (_, refusal) = TextAdmission.Read(entry.Bytes!, entry.Display);
        if (refusal is not null)
        {
            diagnostics.Add(refusal);
        }
    }
}
