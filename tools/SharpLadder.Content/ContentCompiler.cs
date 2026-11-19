using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Compiles chapters/<chapter>/*.md, errors/*.md and glossary/*.md under a content root to one
// JSON file per source. Nothing is written here; output exists only when every file compiled
// and validated.
internal static class ContentCompiler
{
    private const string ChapterSource = "chapter.md";

    // A hints part's catalogue sits beside it, so the two are always found together.
    private const string CatalogueExtension = ".catalogue.json";

    private static readonly (string Folder, RecordKind Kind)[] EntryFolders = [("errors", RecordKind.Error), ("glossary", RecordKind.Glossary)];

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

    public static CompileResult Compile(InputTree tree, IContentSchema schema) => Run(tree, schema, requireChapters: true, checkIndex: true).Result;

    // Every check of a compile except the comparison with the committed index, which this
    // regenerates; the index is empty when there are diagnostics or no problems.
    public static (IReadOnlyList<Diagnostic> Diagnostics, byte[] Index) Index(InputTree tree, IContentSchema schema)
    {
        var (result, parsed) = Run(tree, schema, requireChapters: true, checkIndex: false);
        return (result.Diagnostics, result.Diagnostics.Count > 0 ? [] : ProblemsIndex.Write(Problems(parsed)));
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

    // The code check reads the blocks of this same compilation, never a second parse, and gets
    // none when anything failed. A root without chapters is no error here: it has no code to run.
    public static ExecutionPlan Plan(InputTree tree, IContentSchema schema)
    {
        var (result, parsed) = Run(tree, schema, requireChapters: false, checkIndex: true);
        if (result.Diagnostics.Count > 0)
        {
            return new ExecutionPlan(result.Diagnostics, [], []);
        }

        var blocks = parsed
            .OrderBy(p => p.Relative, StringComparer.Ordinal)
            .SelectMany(p => p.File.CodeSites
                .OrderBy(s => s.FenceLine)
                .Select((s, order) => new ExecutableBlock(
                    p.Relative,
                    s.Node.Id,
                    s.Node.Group,
                    p.Display,
                    s.FenceLine,
                    s.SourceLine,
                    s.Owner,
                    s.Node.Source,
                    s.Node.Check,
                    s.Node.Throws,
                    s.Node.Fail,
                    s.Container,
                    order)))
            .ToList();
        var subjects = parsed
            .Select(p => p.File.Model switch
            {
                ProblemFile m => new PracticeSubject(m.Id, RecordKind.Problem, p.Display, m.Starter.Source, m.Tests.Text, m.Tests.Count, [.. m.Tests.Review.Select(r => r.Check)]),
                DrillFile m => new PracticeSubject(m.Id, RecordKind.Drill, p.Display, m.Starter.Source, m.Tests.Text, m.Tests.Count, [.. m.Tests.Review.Select(r => r.Check)]),
                _ => null,
            })
            .OfType<PracticeSubject>()
            .OrderBy(s => s.Id, StringComparer.Ordinal)
            .ToList();
        return new ExecutionPlan([], blocks, subjects);
    }

    internal static bool IsChapter(string relative) =>
        relative.StartsWith("chapters/", StringComparison.Ordinal) && string.Equals(Path.GetFileName(relative), ChapterSource, StringComparison.Ordinal);

    private static IEnumerable<ProblemFile> Problems(List<Parsed> parsed) => parsed.Select(p => p.File.Model).OfType<ProblemFile>();

    private static (CompileResult Result, List<Parsed> Parsed) Run(InputTree tree, IContentSchema schema, bool requireChapters, bool checkIndex)
    {
        var diagnostics = new List<Diagnostic>();
        var sources = Collect(tree, requireChapters, diagnostics);
        var practice = CollectPractice(tree);
        if (diagnostics.Count > 0)
        {
            return (new CompileResult(diagnostics, []), []);
        }

        var parsed = sources
            .Select(s => Read(s.Relative, s.Bytes, s.Display, diagnostics))
            .Concat(practice.Select(p => ReadPractice(p, diagnostics)))
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
            CheckSee(parsed, aliases, diagnostics);
        }

        if (patterns is not null)
        {
            CheckLadders(parsed, patterns, diagnostics);
        }

        CheckChapters(parsed, diagnostics);
        CheckNumbers(parsed, diagnostics);
        PracticeChecks.Check(parsed, patterns?.Select(p => p.Record.Id), diagnostics);
        var files = Emit(parsed, aliases, patterns, tree, schema, diagnostics);

        // Judged only on content that compiled, so the index it is compared with is the one the
        // index mode prints.
        if (checkIndex && diagnostics.Count == 0)
        {
            ProblemsIndex.Check(tree, Problems(parsed), diagnostics);
        }

        return (diagnostics.Count > 0 ? new CompileResult(diagnostics, []) : new CompileResult([], files), parsed);
    }

    private static List<OutputFile> Emit(List<Parsed> parsed, AliasesFile? aliases, List<(PatternRecord Record, int Line)>? patterns, InputTree tree, IContentSchema schema, List<Diagnostic> diagnostics)
    {
        var files = new List<OutputFile>();
        foreach (var file in parsed.Where(p => p.File.Model is not null))
        {
            var kind = file.File.Entry ?? (file.File.Model is ChapterFile ? RecordKind.Chapter : RecordKind.Part);
            var part = file.File.Model switch
            {
                PartFile p => p.Kind,
                HintsPartFile h => h.Kind,
                _ => null,
            };
            Add(files, Path.ChangeExtension(file.Relative, ".json"), file.File.Model!, kind, file.Display, schema, diagnostics, part);
            if (file.File.Catalogue is { } catalogue)
            {
                Add(files, Path.ChangeExtension(file.Relative, CatalogueExtension), catalogue, RecordKind.HintsCatalogue, file.Display, schema, diagnostics);
            }
        }

        if (aliases is not null && patterns is not null)
        {
            var ordered = new PatternsFile { Patterns = [.. patterns.Select(p => p.Record).OrderBy(p => p.Id, StringComparer.Ordinal)] };
            Add(files, Registries.AliasesOutput, aliases, RecordKind.Aliases, RegistryDisplay(tree, Registries.AliasesSource), schema, diagnostics);
            Add(files, Registries.PatternsOutput, ordered, RecordKind.Patterns, RegistryDisplay(tree, Registries.PatternsSource), schema, diagnostics);
        }

        return files;
    }

    private static void Add(List<OutputFile> files, string relative, object model, RecordKind kind, string display, IContentSchema schema, List<Diagnostic> diagnostics, string? part = null)
    {
        var bytes = Serialize(model);
        var problem = schema.Validate(StrictUtf8.GetString(bytes), kind);
        if (problem is null)
        {
            files.Add(new OutputFile(relative, bytes, kind, part));
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
        parsed.SelectMany(p => p.File.SectionIds).ToHashSet(StringComparer.Ordinal),
        parsed.SelectMany(p => p.File.WalkIds).ToHashSet(StringComparer.Ordinal));

    private static Parsed? Read(string relative, byte[] bytes, string display, List<Diagnostic> diagnostics)
    {
        var (text, refusal) = TextAdmission.Read(bytes, display);
        if (text is null)
        {
            diagnostics.Add(refusal!);
            return null;
        }

        var entry = EntryFolders.Where(e => relative.StartsWith(e.Folder + "/", StringComparison.Ordinal)).Select(e => (RecordKind?)e.Kind).FirstOrDefault();
        var file = entry is { } kind
            ? SourceFile.ParseEntry(display, text, kind, Path.GetFileNameWithoutExtension(relative), diagnostics)
            : SourceFile.Parse(display, text, IsChapter(relative), diagnostics);
        return new Parsed(relative, display, file);
    }

    // The Markdown file and its suite are read together; either refused leaves the subject unread.
    private static Parsed? ReadPractice(PracticeSource source, List<Diagnostic> diagnostics)
    {
        var (text, refusal) = TextAdmission.Read(source.Bytes, source.Display);
        var (suite, suiteRefusal) = TextAdmission.Read(source.Suite.Bytes!, source.Suite.Display);
        diagnostics.AddRange(new[] { refusal, suiteRefusal }.OfType<Diagnostic>());
        if (text is null || suite is null)
        {
            return null;
        }

        var stem = Path.GetFileName(source.Relative)[..^RootAdmission.MarkdownExtension.Length];
        return new Parsed(source.Relative, source.Display, SourceFile.ParsePractice(source.Display, text, source.Kind, stem, (source.Suite.Display, suite), diagnostics));
    }

    // Root admission has refused every entry that is not a pair, so each Markdown file found here
    // has its suite beside it.
    private static List<PracticeSource> CollectPractice(InputTree tree)
    {
        var found = new List<PracticeSource>();
        var practice = tree.Children(string.Empty).FirstOrDefault(e => e.IsFolder && string.Equals(e.Name, RootAdmission.PracticeFolder, StringComparison.Ordinal));
        foreach (var (name, kind) in practice is null ? [] : RootAdmission.SubjectFolders)
        {
            var folder = tree.Children(practice!.Relative).FirstOrDefault(e => e.IsFolder && string.Equals(e.Name, name, StringComparison.Ordinal));
            var entries = folder is null ? [] : tree.Children(folder.Relative);
            foreach (var file in entries.Where(e => !e.IsFolder && e.Name.EndsWith(RootAdmission.MarkdownExtension, StringComparison.Ordinal)))
            {
                var suiteName = file.Name[..^RootAdmission.MarkdownExtension.Length] + RootAdmission.SuiteExtension;
                if (entries.FirstOrDefault(e => !e.IsFolder && string.Equals(e.Name, suiteName, StringComparison.Ordinal)) is { } suite)
                {
                    found.Add(new PracticeSource(file.Relative, file.Display, file.Bytes!, kind, suite));
                }
            }
        }

        return found;
    }

    // Accepts chapters/<chapter>/<file>.md only, in ordinal path order; any other entry under
    // chapters/ is an error, and so is finding no file at all where chapters are required.
    private static List<(string Relative, string Display, byte[] Bytes)> Collect(InputTree tree, bool requireChapters, List<Diagnostic> diagnostics)
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

        if (requireChapters && sources.Count == 0 && diagnostics.Count == 0)
        {
            diagnostics.Add(new Diagnostic(tree.Root.Display, null, "no content files found under chapters/"));
        }

        CollectEntries(tree, sources, diagnostics);
        return sources;
    }

    // An entry folder holds .md files only, one entry each; a missing folder holds none.
    private static void CollectEntries(InputTree tree, List<(string Relative, string Display, byte[] Bytes)> sources, List<Diagnostic> diagnostics)
    {
        foreach (var (name, _) in EntryFolders)
        {
            var folder = tree.Children(string.Empty).FirstOrDefault(e => e.IsFolder && string.Equals(e.Name, name, StringComparison.Ordinal));
            foreach (var file in folder is null ? [] : tree.Children(folder.Relative))
            {
                if (file.IsFolder || !file.Name.EndsWith(".md", StringComparison.Ordinal))
                {
                    diagnostics.Add(new Diagnostic(file.Display, null, $"{name}/ holds only .md files, one entry each"));
                }
                else
                {
                    sources.Add((file.Relative, file.Display, file.Bytes!));
                }
            }
        }
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

        // A reserved prefix names one kind, so a Term or an error link can trust it.
        var owners = new (string Prefix, HashSet<string> Ids, string Kind)[]
        {
            (ContentIds.CardPrefix, parsed.SelectMany(p => p.File.CardIds).ToHashSet(StringComparer.Ordinal), "a card id"),
            (SourceFile.TermPrefix, EntryIds(parsed, RecordKind.Glossary), "a glossary entry id"),
            (SourceFile.ErrorPrefix, EntryIds(parsed, RecordKind.Error), "an error entry id"),
            (SourceFile.LadderPrefix, LadderIds(parsed), "a ladder id"),
            (SourceFile.ProblemPrefix, PracticeIds(parsed, RecordKind.Problem), "a problem file"),
            (SourceFile.DrillPrefix, PracticeIds(parsed, RecordKind.Drill), "a drill file"),
            (SourceFile.WalkPrefix, parsed.SelectMany(p => p.File.WalkIds).ToHashSet(StringComparer.Ordinal), "a walk-it block"),
        };
        foreach (var (id, display, line) in uses)
        {
            foreach (var (prefix, owned, kind) in owners)
            {
                if (id.StartsWith(prefix, StringComparison.Ordinal) && !owned.Contains(id))
                {
                    diagnostics.Add(new Diagnostic(display, line, $"id \"{id}\" starts with {prefix}, which only {kind} may"));
                }
            }

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

    private static HashSet<string> EntryIds(List<Parsed> parsed, RecordKind kind) =>
        parsed.Where(p => p.File.Entry == kind).Select(p => p.File.EntryId).OfType<string>().ToHashSet(StringComparer.Ordinal);

    private static HashSet<string> PracticeIds(List<Parsed> parsed, RecordKind kind) =>
        parsed.Select(p => p.File.Practice).OfType<PracticeFile>().Where(p => p.Kind == kind).SelectMany(p => new[] { p.Id, p.StarterId }).ToHashSet(StringComparer.Ordinal);

    // A problem's number is its public name, so two problems never share one.
    private static void CheckNumbers(List<Parsed> parsed, List<Diagnostic> diagnostics)
    {
        var seen = new Dictionary<int, string>();
        foreach (var file in parsed.Where(p => p.File.Model is ProblemFile).OrderBy(p => p.Relative, StringComparer.Ordinal))
        {
            var number = ((ProblemFile)file.File.Model!).Number;
            if (!seen.TryAdd(number, file.Display))
            {
                diagnostics.Add(new Diagnostic(file.Display, file.File.Practice!.KeyLines["number"], string.Create(CultureInfo.InvariantCulture, $"problem number {number} is used twice (first used at {seen[number]})")));
            }
        }
    }

    private static HashSet<string> LadderIds(List<Parsed> parsed) =>
        parsed.SelectMany(p => p.File.Ladders.Select(l => l.Ladder.Id)).ToHashSet(StringComparer.Ordinal);

    // A ladder's pattern is a live one, and its public id shares no word with what it hides. The
    // word rule is hygiene, not proof: subtler hints are editorial work.
    private static void CheckLadders(List<Parsed> parsed, List<(PatternRecord Record, int Line)> patterns, List<Diagnostic> diagnostics)
    {
        // A repeated pattern id is refused by the registry check; every title it carries still hides.
        var titles = patterns.ToLookup(p => p.Record.Id, p => p.Record.Title, StringComparer.Ordinal);
        foreach (var file in parsed)
        {
            foreach (var (ladder, line, patternLine) in file.File.Ladders)
            {
                if (!titles.Contains(ladder.Pattern))
                {
                    diagnostics.Add(new Diagnostic(file.Display, patternLine, $"pattern \"{ladder.Pattern}\" is not in {Registries.PatternsSource}"));
                    continue;
                }

                var hidden = LadderWords.Of(ladder.Approach).Concat(LadderWords.Of(ladder.Pattern)).Concat(titles[ladder.Pattern].SelectMany(LadderWords.Of)).ToHashSet(StringComparer.OrdinalIgnoreCase);
                var shared = LadderWords.Of(ladder.Id).Where(hidden.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (shared.Count > 0)
                {
                    diagnostics.Add(new Diagnostic(file.Display, line, $"ladder id \"{ladder.Id}\" shares {string.Join(", ", shared.Select(w => $"\"{w}\""))} with its approach, pattern id or pattern title, which stay hidden"));
                }
            }
        }
    }

    // A bare or current-chapter target must name an anchor of the same file; another chapter's
    // anchors are not resolved by this check.
    // A retired id is refused in every link, another chapter's included, and names its successor.
    // An error entry is told from an anchor by what the id names; a Term, by its reserved prefix,
    // must then name a live glossary entry.
    private static void CheckLinks(List<Parsed> parsed, AliasesFile? aliases, List<Diagnostic> diagnostics)
    {
        var errors = EntryIds(parsed, RecordKind.Error);
        var ladders = LadderIds(parsed);
        var shorts = parsed.Select(p => p.File.Model).OfType<GlossaryFile>().ToDictionary(g => g.Id, g => g.Short, StringComparer.Ordinal);
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
                else if (ladders.Contains(link.Id))
                {
                    // A ladder opens only through its reveal control (4.9), never through a link.
                    diagnostics.Add(new Diagnostic(file.Display, link.Line, $"link target \"{link.Target}\" names the ladder \"{link.Id}\", which cannot be linked"));
                }
                else if (link.Term is { } term)
                {
                    // Copied at resolution, so a record always shows its entry's current short text.
                    if (shorts.TryGetValue(link.Id, out var brief))
                    {
                        term.Short = brief;
                    }
                    else
                    {
                        diagnostics.Add(new Diagnostic(file.Display, link.Line, $"Term target \"{link.Target}\" names no glossary entry"));
                    }
                }
                else if (errors.Contains(link.Id))
                {
                    if (link.Chapter is null)
                    {
                        link.Span!.Kind = LinkSpan.ErrorEntry;
                    }
                    else
                    {
                        diagnostics.Add(new Diagnostic(file.Display, link.Line, $"link target \"{link.Target}\" names an error entry, which belongs to no chapter; write [text](#{link.Id})"));
                    }
                }
                else if (local && !anchors.Contains(link.Id))
                {
                    diagnostics.Add(new Diagnostic(file.Display, link.Line, $"link target \"{link.Target}\" names no section or block id in this file"));
                }
            }
        }
    }

    // Every see target is a live section, chapter, card, glossary entry or error entry, found by what
    // the id names; anything else, a retired id included, is refused.
    private static void CheckSee(List<Parsed> parsed, AliasesFile? aliases, List<Diagnostic> diagnostics)
    {
        var admitted = parsed.SelectMany(p => p.File.SectionIds)
            .Concat(parsed.Where(p => IsChapter(p.Relative)).Select(p => p.File.ChapterId).OfType<string>())
            .Concat(parsed.SelectMany(p => p.File.CardIds))
            .Concat(EntryIds(parsed, RecordKind.Error))
            .Concat(EntryIds(parsed, RecordKind.Glossary))
            .ToHashSet(StringComparer.Ordinal);
        foreach (var file in parsed)
        {
            foreach (var (id, line) in file.File.See)
            {
                if (aliases is not null && aliases.Ids.TryGetValue(id, out var successor))
                {
                    diagnostics.Add(new Diagnostic(file.Display, line, $"see names the retired id \"{id}\"; name \"{successor}\""));
                }
                else if (!admitted.Contains(id))
                {
                    diagnostics.Add(new Diagnostic(file.Display, line, $"see names \"{id}\", which is no live section, chapter, card, glossary entry or error entry"));
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

    internal sealed record Parsed(string Relative, string Display, SourceFile File);

    private sealed record PracticeSource(string Relative, string Display, byte[] Bytes, RecordKind Kind, InputEntry Suite);
}
