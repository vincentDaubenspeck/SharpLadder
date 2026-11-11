using System.Buffers;

namespace SharpLadder.Content;

// The two mandatory registry files of a content root, read into closed shapes. Everything here
// is a content error: a registry that fails any rule yields no output at all.
internal static class Registries
{
    public const string AliasesSource = "aliases.yml";
    public const string PatternsSource = "patterns.yml";
    public const string AliasesOutput = "aliases.json";
    public const string PatternsOutput = "patterns.json";
    public const string PatternPrefix = "pat-";

    private const string SlugRule = "is not lowercase letters and digits in hyphen-separated runs, at most 48 characters";

    // The blank list as the pattern schema and the web check write it out: what counts as white
    // space differs between runtimes, so none of them is asked.
    private static readonly SearchValues<char> Blank = SearchValues.Create(
        "\u0009\u000A\u000B\u000C\u000D\u0020\u0085\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF");

    /// <summary>Whether a pattern's text holds any character outside the blank list.</summary>
    /// <param name="text">The text as written.</param>
    /// <returns>False for empty text and text made only of blanks.</returns>
    public static bool ShowsSomething(string text) => text.AsSpan().ContainsAnyExcept(Blank);

    // Null after reporting. Each record carries the line of its id, for the site-wide ID table.
    public static List<(PatternRecord Record, int Line)>? ReadPatterns(InputTree tree, List<Diagnostic> diagnostics)
    {
        var before = diagnostics.Count;
        var (root, display) = Root(tree, PatternsSource, diagnostics);
        if (root is null || !Keys(root, display, diagnostics, "patterns"))
        {
            return null;
        }

        var listed = root.Entries[0].Value;
        if (listed is not PlainYaml.List list)
        {
            diagnostics.Add(new Diagnostic(display, listed.Line, "patterns must be a list; write [] for none"));
            return null;
        }

        var records = new List<(PatternRecord Record, int Line)>();
        foreach (var item in list.Items)
        {
            if (item is not PlainYaml.Map map)
            {
                diagnostics.Add(new Diagnostic(display, item.Line, "a pattern must be a mapping of id, title and summary"));
                continue;
            }

            if (!Keys(map, display, diagnostics, "id", "title", "summary"))
            {
                continue;
            }

            var id = Field(map, "id", display, diagnostics);
            var title = Field(map, "title", display, diagnostics);
            var summary = Field(map, "summary", display, diagnostics);
            if (id is null || title is null || summary is null)
            {
                continue;
            }

            if (!id.Value.StartsWith(PatternPrefix, StringComparison.Ordinal) || !ContentIds.IsValid(id.Value))
            {
                diagnostics.Add(new Diagnostic(display, id.Line, $"pattern id {PlainYaml.Shown(id.Value)} must start with {PatternPrefix} and {ContentIds.FormatRule}"));
                continue;
            }

            records.Add((new PatternRecord { Id = id.Value, Title = title.Value, Summary = summary.Value }, id.Line));
        }

        return diagnostics.Count == before ? records : null;
    }

    // Null after reporting. Every alias is followed to its end, so the result names live targets
    // only: slugs end at a chapter slug, ids at a section id.
    public static AliasesFile? ReadAliases(InputTree tree, LiveNames live, List<Diagnostic> diagnostics)
    {
        var before = diagnostics.Count;
        var (root, display) = Root(tree, AliasesSource, diagnostics);
        if (root is null || !Keys(root, display, diagnostics, "slugs", "ids"))
        {
            return null;
        }

        var slugs = Namespace(root, new Rules("slugs", "slug", ContentIds.IsSlug, SlugRule, live.Slugs, live.Slugs, "a chapter slug"), display, diagnostics);
        var ids = Namespace(root, new Rules("ids", "id", ContentIds.IsValid, ContentIds.FormatRule, live.Ids, live.SectionIds, "a section id"), display, diagnostics);
        return diagnostics.Count == before && slugs is not null && ids is not null ? new AliasesFile { Slugs = slugs, Ids = ids } : null;
    }

    private static (PlainYaml.Map? Root, string Display) Root(InputTree tree, string name, List<Diagnostic> diagnostics)
    {
        var entry = tree.Children(string.Empty).FirstOrDefault(e => string.Equals(e.Name, name, StringComparison.Ordinal));
        if (entry is null)
        {
            diagnostics.Add(new Diagnostic(tree.Root.Display, null, $"{name} is missing; the content root must hold it"));
            return (null, name);
        }

        if (entry.IsFolder)
        {
            diagnostics.Add(new Diagnostic(entry.Display, null, "not a file"));
            return (null, entry.Display);
        }

        var (text, refusal) = TextAdmission.Read(entry.Bytes!, entry.Display);
        if (text is null)
        {
            diagnostics.Add(refusal!);
            return (null, entry.Display);
        }

        var (root, problem) = PlainYaml.Read(text, entry.Display);
        if (root is null)
        {
            diagnostics.Add(problem!);
            return (null, entry.Display);
        }

        if (root is not PlainYaml.Map map)
        {
            diagnostics.Add(new Diagnostic(entry.Display, root.Line, "the document must be a mapping"));
            return (null, entry.Display);
        }

        return (map, entry.Display);
    }

    // The mapping holds exactly these keys, in any order.
    private static bool Keys(PlainYaml.Map map, string display, List<Diagnostic> diagnostics, params string[] names)
    {
        var before = diagnostics.Count;
        foreach (var entry in map.Entries.Where(e => !names.Contains(e.Key, StringComparer.Ordinal)))
        {
            diagnostics.Add(new Diagnostic(display, entry.Line, $"unknown key {PlainYaml.Shown(entry.Key)}; only {string.Join(", ", names)} are accepted"));
        }

        foreach (var name in names.Where(n => !map.Entries.Any(e => string.Equals(e.Key, n, StringComparison.Ordinal))))
        {
            diagnostics.Add(new Diagnostic(display, map.Line, $"{name} is missing"));
        }

        return diagnostics.Count == before;
    }

    // A pattern's text as written: any well-formed string with something to show.
    private static PlainYaml.Text? Field(PlainYaml.Map map, string name, string display, List<Diagnostic> diagnostics)
    {
        var entry = map.Entries.First(e => string.Equals(e.Key, name, StringComparison.Ordinal));
        if (entry.Value is not PlainYaml.Text text)
        {
            diagnostics.Add(new Diagnostic(display, entry.Value.Line, $"{name} must be text"));
            return null;
        }

        if (!ShowsSomething(text.Value))
        {
            diagnostics.Add(new Diagnostic(display, text.Line, $"{name} is empty"));
            return null;
        }

        if (!AudioSlot.IsStorable(text.Value))
        {
            diagnostics.Add(new Diagnostic(display, text.Line, $"{name} holds a character that cannot be stored (a lone surrogate or a noncharacter)"));
            return null;
        }

        return text;
    }

    private static SortedDictionary<string, string>? Namespace(PlainYaml.Map root, Rules rules, string display, List<Diagnostic> diagnostics)
    {
        var before = diagnostics.Count;
        var listed = root.Entries.First(e => string.Equals(e.Key, rules.Name, StringComparison.Ordinal)).Value;
        if (listed is not PlainYaml.Map map)
        {
            diagnostics.Add(new Diagnostic(display, listed.Line, $"{rules.Name} must be a mapping of old to new; write {{}} for none"));
            return null;
        }

        var written = new Dictionary<string, (string Target, int Line)>(StringComparer.Ordinal);
        foreach (var entry in map.Entries)
        {
            if (!rules.IsValid(entry.Key))
            {
                diagnostics.Add(new Diagnostic(display, entry.Line, $"retired {rules.What} {PlainYaml.Shown(entry.Key)} {rules.Grammar}"));
            }
            else if (rules.Live.Contains(entry.Key))
            {
                diagnostics.Add(new Diagnostic(display, entry.Line, $"{PlainYaml.Shown(entry.Key)} is in use, so it cannot be retired"));
            }
            else if (entry.Value is not PlainYaml.Text target)
            {
                diagnostics.Add(new Diagnostic(display, entry.Value.Line, $"the target of {PlainYaml.Shown(entry.Key)} must be text"));
            }
            else if (!rules.IsValid(target.Value))
            {
                diagnostics.Add(new Diagnostic(display, target.Line, $"target {rules.What} {PlainYaml.Shown(target.Value)} {rules.Grammar}"));
            }
            else
            {
                written.Add(entry.Key, (target.Value, entry.Line));
            }
        }

        return diagnostics.Count > before ? null : Flatten(written, rules, display, diagnostics);
    }

    // Follows every alias to its end; a chain that never ends or ends nowhere live is reported.
    private static SortedDictionary<string, string>? Flatten(Dictionary<string, (string Target, int Line)> written, Rules rules, string display, List<Diagnostic> diagnostics)
    {
        var before = diagnostics.Count;
        var flat = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, (target, line)) in written.OrderBy(w => w.Key, StringComparer.Ordinal))
        {
            var visited = new HashSet<string>(StringComparer.Ordinal) { key };
            var end = target;
            while (written.TryGetValue(end, out var next) && visited.Add(end))
            {
                end = next.Target;
            }

            if (visited.Contains(end))
            {
                diagnostics.Add(new Diagnostic(display, line, $"{PlainYaml.Shown(key)} leads back to {PlainYaml.Shown(end)}; an alias chain must end"));
            }
            else if (!rules.Ends.Contains(end))
            {
                diagnostics.Add(new Diagnostic(display, line, $"{PlainYaml.Shown(key)} ends at {PlainYaml.Shown(end)}, which is not {rules.EndWhat}"));
            }
            else
            {
                flat.Add(key, end);
            }
        }

        return diagnostics.Count == before ? flat : null;
    }

    // Live holds every name a key may not take; Ends holds the names a chain may end at.
    private sealed record Rules(string Name, string What, Func<string, bool> IsValid, string Grammar, IReadOnlySet<string> Live, IReadOnlySet<string> Ends, string EndWhat);
}
