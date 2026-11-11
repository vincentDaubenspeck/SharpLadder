using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Compiles chapters/<chapter>/*.md under a content root to one JSON file per source. Nothing is
// written here; output exists only when every file compiled and validated.
internal static class ContentCompiler
{
    private const string ChapterSource = "chapter.md";

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        IndentSize = 2,
        NewLine = "\n",
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.Default,
    };

    // Paths in diagnostics are relative to displayBase, with / separators. A boundary refusal
    // throws BoundaryException instead.
    public static CompileResult Compile(string contentRoot, IContentSchema schema, string displayBase)
    {
        using var root = Folder.OpenRoot(contentRoot, DisplayPath(displayBase, contentRoot));
        return Compile(InputTree.ReadContent(root), schema);
    }

    public static CompileResult Compile(InputTree tree, IContentSchema schema)
    {
        var diagnostics = new List<Diagnostic>();
        var sources = Collect(tree, diagnostics);
        if (diagnostics.Count > 0)
        {
            return new CompileResult(diagnostics, []);
        }

        var parsed = sources
            .Select(s => Read(s.Relative, s.Bytes, s.Display, diagnostics))
            .OfType<Parsed>()
            .ToList();

        var patterns = Registries.ReadPatterns(tree, diagnostics);
        AliasesFile? aliases = null;

        // Anchor sets are built only from unique IDs, so a duplicate is reported, never collapsed.
        // The alias registry is read against the same unique names, so it waits for them too.
        if (CheckIds(parsed, patterns ?? [], tree, diagnostics) && CheckSlugs(parsed, diagnostics))
        {
            aliases = patterns is null ? null : Registries.ReadAliases(tree, Live(parsed, patterns), diagnostics);
            CheckLinks(parsed, aliases, diagnostics);
        }

        CheckChapters(parsed, diagnostics);
        var files = new List<OutputFile>();
        foreach (var file in parsed.Where(p => p.File.Model is not null))
        {
            var kind = file.File.Model is ChapterFile ? RecordKind.Chapter : RecordKind.Part;
            Add(files, Path.ChangeExtension(file.Relative, ".json"), file.File.Model!, kind, file.Display, schema, diagnostics);
        }

        if (aliases is not null && patterns is not null)
        {
            var ordered = new PatternsFile { Patterns = [.. patterns.Select(p => p.Record).OrderBy(p => p.Id, StringComparer.Ordinal)] };
            Add(files, Registries.AliasesOutput, aliases, RecordKind.Aliases, RegistryDisplay(tree, Registries.AliasesSource), schema, diagnostics);
            Add(files, Registries.PatternsOutput, ordered, RecordKind.Patterns, RegistryDisplay(tree, Registries.PatternsSource), schema, diagnostics);
        }

        return diagnostics.Count > 0 ? new CompileResult(diagnostics, []) : new CompileResult([], files);
    }

    public static byte[] Serialize(object model) =>
        StrictUtf8.GetBytes(JsonSerializer.Serialize(model, model.GetType(), Json) + "\n");

    // How diagnostics name path: relative to displayBase when below it, with / separators.
    public static string DisplayPath(string displayBase, string path)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        var relative = Path.GetRelativePath(Path.GetFullPath(displayBase), full);
        var shown = Path.IsPathRooted(relative) || relative.StartsWith("..", StringComparison.Ordinal) ? full : relative;
        return shown.Replace('\\', '/');
    }

    private static void Add(List<OutputFile> files, string relative, object model, RecordKind kind, string display, IContentSchema schema, List<Diagnostic> diagnostics)
    {
        var bytes = Serialize(model);
        var problem = schema.Validate(StrictUtf8.GetString(bytes), kind);
        if (problem is null)
        {
            files.Add(new OutputFile(relative, bytes, kind));
        }
        else
        {
            diagnostics.Add(new Diagnostic(display, 1, "schema: " + problem));
        }
    }

    private static string RegistryDisplay(InputTree tree, string name) =>
        tree.Children(string.Empty).First(e => string.Equals(e.Name, name, StringComparison.Ordinal)).Display;

    private static LiveNames Live(List<Parsed> parsed, List<(PatternRecord Record, int Line)> patterns) => new(
        parsed.Select(p => (p.File.Model as ChapterFile)?.Slug).OfType<string>().ToHashSet(StringComparer.Ordinal),
        parsed.SelectMany(p => p.File.Ids.Select(i => i.Id)).Concat(patterns.Select(p => p.Record.Id)).ToHashSet(StringComparer.Ordinal),
        parsed.SelectMany(p => p.File.SectionIds).ToHashSet(StringComparer.Ordinal));

    private static Parsed? Read(string relative, byte[] bytes, string display, List<Diagnostic> diagnostics)
    {
        var (text, refusal) = TextAdmission.Read(bytes, display);
        if (text is null)
        {
            diagnostics.Add(refusal!);
            return null;
        }

        return new Parsed(relative, display, SourceFile.Parse(display, text, IsChapter(relative), diagnostics));
    }

    private static bool IsChapter(string relative) => string.Equals(Path.GetFileName(relative), ChapterSource, StringComparison.Ordinal);

    // Accepts chapters/<chapter>/<file>.md only, in ordinal path order; any other entry under
    // chapters/ is an error, and so is finding no file at all.
    private static List<(string Relative, string Display, byte[] Bytes)> Collect(InputTree tree, List<Diagnostic> diagnostics)
    {
        RootAdmission.Check(tree, diagnostics);
        var sources = new List<(string Relative, string Display, byte[] Bytes)>();
        var chapters = tree.Children(string.Empty).FirstOrDefault(e => string.Equals(e.Name, "chapters", StringComparison.Ordinal));
        if (chapters is { IsFolder: false })
        {
            throw new BoundaryException($"{chapters.Display}: not a folder");
        }

        foreach (var chapter in chapters is null ? [] : tree.Children(chapters.Relative))
        {
            if (!chapter.IsFolder)
            {
                diagnostics.Add(new Diagnostic(chapter.Display, null, "chapters/ holds only chapter folders"));
                continue;
            }

            var files = tree.Children(chapter.Relative);
            if (!files.Any(f => string.Equals(f.Name, ChapterSource, StringComparison.Ordinal)))
            {
                diagnostics.Add(new Diagnostic(chapter.Display, null, "chapter folder has no chapter.md"));
            }

            foreach (var file in files)
            {
                if (file.IsFolder || !file.Name.EndsWith(".md", StringComparison.Ordinal))
                {
                    diagnostics.Add(new Diagnostic(file.Display, null, "a chapter folder holds only .md files"));
                    continue;
                }

                sources.Add((file.Relative, file.Display, file.Bytes!));
            }
        }

        if (sources.Count == 0 && diagnostics.Count == 0)
        {
            diagnostics.Add(new Diagnostic(tree.Root.Display, null, "no content files found under chapters/"));
        }

        return sources;
    }

    // Top-level IDs are unique across every file; the first use in path order wins. False when
    // any ID repeats.
    private static bool CheckIds(List<Parsed> parsed, List<(PatternRecord Record, int Line)> patterns, InputTree tree, List<Diagnostic> diagnostics)
    {
        var before = diagnostics.Count;
        var seen = new Dictionary<string, (string Display, int Line)>(StringComparer.Ordinal);
        var uses = parsed.SelectMany(file => file.File.Ids.Select(i => (i.Id, file.Display, i.Line)));
        if (patterns.Count > 0)
        {
            var display = RegistryDisplay(tree, Registries.PatternsSource);
            uses = uses.Concat(patterns.Select(p => (p.Record.Id, display, p.Line)));
        }

        foreach (var (id, display, line) in uses)
        {
            if (!seen.TryAdd(id, (display, line)))
            {
                var first = seen[id];
                diagnostics.Add(new Diagnostic(display, line, $"duplicate id \"{id}\" (first used at {first.Display}:{first.Line})"));
            }
        }

        return diagnostics.Count == before;
    }

    // A slug names one chapter, so the alias registry can end at it without ambiguity.
    private static bool CheckSlugs(List<Parsed> parsed, List<Diagnostic> diagnostics)
    {
        var before = diagnostics.Count;
        var seen = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var file in parsed)
        {
            if (file.File.Model is ChapterFile { Slug: { } slug } && !seen.TryAdd(slug, file.Display))
            {
                diagnostics.Add(new Diagnostic(file.Display, 1, $"duplicate slug \"{slug}\" (first used at {seen[slug]})"));
            }
        }

        return diagnostics.Count == before;
    }

    // A bare or current-chapter target must name an anchor of the same source file; a sibling
    // file's anchors and other chapters need cross-file checks, which do not exist yet.
    // A retired id is refused in every link, another chapter's included, and names its successor.
    private static void CheckLinks(List<Parsed> parsed, AliasesFile? aliases, List<Diagnostic> diagnostics)
    {
        foreach (var file in parsed.Where(p => p.File.Model is not null))
        {
            var anchors = file.File.Anchors.ToHashSet(StringComparer.Ordinal);
            foreach (var link in file.File.Links)
            {
                var local = link.Chapter is null || string.Equals(link.Chapter, file.File.ChapterId, StringComparison.Ordinal);
                if (aliases is not null && aliases.Ids.TryGetValue(link.Id, out var successor))
                {
                    diagnostics.Add(new Diagnostic(file.Display, link.Line, $"link target \"{link.Target}\" names the retired id \"{link.Id}\"; link to \"{successor}\""));
                }
                else if (local && !anchors.Contains(link.Id))
                {
                    diagnostics.Add(new Diagnostic(file.Display, link.Line, $"link target \"{link.Target}\" names no section or block id in this file"));
                }
            }
        }
    }

    // A part names the chapter whose folder it sits in.
    private static void CheckChapters(List<Parsed> parsed, List<Diagnostic> diagnostics)
    {
        var chapterIds = parsed
            .Where(p => IsChapter(p.Relative))
            .ToDictionary(p => Path.GetDirectoryName(p.Relative)!, p => p.File.ChapterId, StringComparer.Ordinal);
        foreach (var part in parsed.Where(p => !IsChapter(p.Relative) && p.File.ChapterId is not null))
        {
            if (chapterIds.TryGetValue(Path.GetDirectoryName(part.Relative)!, out var expected) && expected is not null
                && !string.Equals(part.File.ChapterId, expected, StringComparison.Ordinal))
            {
                diagnostics.Add(new Diagnostic(part.Display, 1, $"chapter \"{part.File.ChapterId}\" does not match \"{expected}\" in chapter.md"));
            }
        }
    }

    private sealed record Parsed(string Relative, string Display, SourceFile File);
}
