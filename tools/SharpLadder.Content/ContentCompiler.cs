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
        return Compile(InputTree.Read(root), schema);
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
        CheckIds(parsed, diagnostics);
        CheckChapters(parsed, diagnostics);
        var files = new List<OutputFile>();
        foreach (var file in parsed.Where(p => p.File.Model is not null))
        {
            var bytes = Serialize(file.File.Model!);
            var problem = schema.Validate(StrictUtf8.GetString(bytes));
            if (problem is null)
            {
                files.Add(new OutputFile(Path.ChangeExtension(file.Relative, ".json"), bytes));
            }
            else
            {
                diagnostics.Add(new Diagnostic(file.Display, 1, "schema: " + problem));
            }
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

    private static Parsed? Read(string relative, byte[] bytes, string display, List<Diagnostic> diagnostics)
    {
        string text;
        try
        {
            text = StrictUtf8.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            diagnostics.Add(new Diagnostic(display, null, "file is not valid UTF-8"));
            return null;
        }

        if (text.StartsWith('﻿'))
        {
            diagnostics.Add(new Diagnostic(display, 1, "file starts with a byte order mark; save it as UTF-8 without one"));
            return null;
        }

        return new Parsed(relative, display, SourceFile.Parse(display, text, IsChapter(relative), diagnostics));
    }

    private static bool IsChapter(string relative) => string.Equals(Path.GetFileName(relative), ChapterSource, StringComparison.Ordinal);

    // Accepts chapters/<chapter>/<file>.md only, in ordinal path order; any other entry under
    // chapters/ is an error, and so is finding no file at all.
    private static List<(string Relative, string Display, byte[] Bytes)> Collect(InputTree tree, List<Diagnostic> diagnostics)
    {
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

    // Top-level IDs are unique across every file; the first use in path order wins.
    private static void CheckIds(List<Parsed> parsed, List<Diagnostic> diagnostics)
    {
        var seen = new Dictionary<string, (string Display, int Line)>(StringComparer.Ordinal);
        foreach (var file in parsed)
        {
            foreach (var (id, line) in file.File.Ids)
            {
                if (!seen.TryAdd(id, (file.Display, line)))
                {
                    var first = seen[id];
                    diagnostics.Add(new Diagnostic(file.Display, line, $"duplicate id \"{id}\" (first used at {first.Display}:{first.Line})"));
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
