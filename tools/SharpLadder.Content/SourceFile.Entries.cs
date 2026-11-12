using System.Globalization;
using Markdig;
using Markdig.Extensions.Yaml;
using Markdig.Syntax;

namespace SharpLadder.Content;

/// <content>Glossary and error entries: closed front matter, then a body with no headings.</content>
internal sealed partial class SourceFile
{
    public const string TermPrefix = "term-";
    public const string ErrorPrefix = "err-";
    private const string WrongOutput = "wrong-output";
    private const string ErrorBodyRule = "an error entry's body is one list of two fields, \"- cause:\" then \"- hint:\", and nothing else";
    private const int MaxShort = 200;
    private static readonly string[] ErrorKinds = ["compiler", "runtime", WrongOutput];
    private static readonly string[] ErrorFields = ["cause", "hint"];

    // The entry kind this file was read as; null for a chapter or part.
    public RecordKind? Entry { get; private set; }

    // The entry's own id, once it met every rule an entry id has.
    public string? EntryId { get; private set; }

    // The ids an entry lists under see, resolved once every file is read.
    public List<(string Id, int Line)> See { get; } = [];

    public static SourceFile ParseEntry(string path, string text, RecordKind kind, string stem, List<Diagnostic> diagnostics)
    {
        var file = new SourceFile(path, diagnostics) { Entry = kind };
        if (file.Front(text) is var (yaml, start, blocks))
        {
            if (kind == RecordKind.Glossary)
            {
                file.Glossary(yaml, start, blocks, stem);
            }
            else
            {
                file.ErrorEntry(yaml, start, blocks, stem);
            }
        }

        return file;
    }

    // A lone surrogate cannot be written as UTF-8, and a control character is never shown.
    private static bool Storable(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            var paired = char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]);
            if (char.IsControl(c) || c is (char)0x2028 or (char)0x2029 || (char.IsSurrogate(c) && !paired))
            {
                return false;
            }

            i += paired ? 1 : 0;
        }

        return true;
    }

    private static int KeyLine(string yaml, int yamlStart, string key) =>
        yamlStart + 1 + Math.Max(0, Array.FindIndex(yaml.Split('\n'), l => l.StartsWith(key + ":", StringComparison.Ordinal)));

    // The front matter text, the line of its opening ---, and the blocks after it.
    private (string Yaml, int Start, List<Block> Blocks)? Front(string text)
    {
        _lines = text.Split('\n');
        _lineStarts = LineStarts(_lines);

        var document = Markdown.Parse(text, Pipeline);
        if (document.Count == 0 || document[0] is not YamlFrontMatterBlock front)
        {
            Error(1, "file must start with YAML front matter between --- lines");
            return null;
        }

        var yaml = string.Join('\n', front.Lines.Lines.Take(front.Lines.Count).Select(l => l.Slice.ToString()));
        return (yaml, front.Line + 1, document.Skip(1).ToList());
    }

    private void Glossary(string yaml, int start, List<Block> blocks, string stem)
    {
        var meta = FrontMatter<GlossaryFrontMatter>(yaml, start);
        if (meta is null)
        {
            return;
        }

        var before = _diagnostics.Count;
        var id = OwnId(meta.Id, TermPrefix, "glossary entry", stem, KeyLine(yaml, start, "id"));
        var term = Plain(meta.Term, "term", KeyLine(yaml, start, "term"), null);
        var brief = Plain(meta.Brief, "short", KeyLine(yaml, start, "short"), MaxShort);
        var see = SeeAlso(meta.See, meta.Id, KeyLine(yaml, start, "see"));
        var body = id is null ? null : EntryBody(blocks, id);
        if (_diagnostics.Count == before && id is not null && term is not null && brief is not null && body is not null)
        {
            Model = new GlossaryFile { Id = id, Term = term, Short = brief, See = see, Body = body };
        }
    }

    private void ErrorEntry(string yaml, int start, List<Block> blocks, string stem)
    {
        var meta = FrontMatter<ErrorFrontMatter>(yaml, start);
        if (meta is null)
        {
            return;
        }

        var before = _diagnostics.Count;
        var id = OwnId(meta.Id, ErrorPrefix, "error entry", stem, KeyLine(yaml, start, "id"));
        var kind = ErrorKind(meta.Kind, KeyLine(yaml, start, "kind"));
        var code = kind is null ? null : ErrorCode(meta.Code, kind, KeyLine(yaml, start, "code"));
        var wrote = Plain(meta.Wrote, "wrote", KeyLine(yaml, start, "wrote"), null);
        var got = Plain(meta.Got, "got", KeyLine(yaml, start, "got"), null);
        var see = SeeAlso(meta.See, meta.Id, KeyLine(yaml, start, "see"));
        var fields = id is null ? null : ErrorBody(blocks, id, start);
        if (_diagnostics.Count == before && id is not null && kind is not null && wrote is not null && got is not null && fields is not null)
        {
            Model = new ErrorFile { Id = id, Kind = kind, Code = code, Wrote = wrote, Got = got, See = see, Cause = fields[ErrorFields[0]], Hint = fields[ErrorFields[1]] };
        }
    }

    // An entry is found by its file name, so the name and the id are the same text.
    private string? OwnId(string? id, string prefix, string what, string stem, int line)
    {
        string? problem = null;
        if (id is null)
        {
            problem = "front matter states no id";
        }
        else if (!ContentIds.IsValid(id))
        {
            problem = $"{what} id \"{Shown(id)}\" {ContentIds.FormatRule}";
        }
        else if (!id.StartsWith(prefix, StringComparison.Ordinal) || id.Length == prefix.Length)
        {
            problem = $"{what} id \"{id}\" must start with {prefix} and go on after it";
        }
        else if (!string.Equals(id, stem, StringComparison.Ordinal))
        {
            problem = $"the file is named \"{Shown(stem)}.md\" and states the id \"{id}\"; name the file {id}.md";
        }

        if (problem is not null)
        {
            Error(line, problem);
            return null;
        }

        Ids.Add((id!, line));
        Anchors.Add(id!);
        EntryId = id;
        return id;
    }

    // One line of shown text: present, not blank, and free of line breaks and control characters.
    private string? Plain(string? value, string key, int line, int? most)
    {
        string? problem = null;
        if (value is null)
        {
            problem = $"front matter states no {key}";
        }
        else if (!Storable(value))
        {
            problem = $"{key} holds a line break or a character that cannot be shown; write it on one line";
        }
        else if (!Registries.ShowsSomething(value))
        {
            problem = $"{key} is blank";
        }
        else if (most is int limit && ContentIds.SpokenLength(value) > limit)
        {
            problem = string.Create(CultureInfo.InvariantCulture, $"{key} is {ContentIds.SpokenLength(value)} characters; at most {limit} are allowed");
        }

        if (problem is not null)
        {
            Error(line, problem);
        }

        return problem is null ? value : null;
    }

    private string? ErrorKind(string? kind, int line)
    {
        if (kind is not null && ErrorKinds.Contains(kind, StringComparer.Ordinal))
        {
            return kind;
        }

        var stated = kind is null ? "front matter states no kind" : $"error kind \"{Shown(kind)}\" is not admitted";
        Error(line, $"{stated}; write kind as one of {string.Join(", ", ErrorKinds)}");
        return null;
    }

    // A wrong-output entry has no diagnostic to name, so its code is empty and compiles to none.
    private string? ErrorCode(string? code, string kind, int line)
    {
        if (!string.Equals(kind, WrongOutput, StringComparison.Ordinal))
        {
            return Plain(code, "code", line, null);
        }

        if (!string.IsNullOrEmpty(code))
        {
            Error(line, "a wrong-output entry names no code; leave code empty");
        }

        return null;
    }

    private List<string> SeeAlso(IList<string?>? see, string? self, int line)
    {
        var listed = new List<string>();
        foreach (var id in see ?? [])
        {
            if (id is null || !ContentIds.IsValid(id))
            {
                Error(line, $"see names \"{Shown(id ?? string.Empty)}\", which {ContentIds.FormatRule}");
            }
            else if (string.Equals(id, self, StringComparison.Ordinal))
            {
                Error(line, $"see names the entry's own id \"{id}\"");
            }
            else if (listed.Contains(id, StringComparer.Ordinal))
            {
                Error(line, $"see names \"{id}\" twice");
            }
            else
            {
                listed.Add(id);
                See.Add((id, line));
            }
        }

        return listed;
    }

    // The renderer owns an entry's headings, so the body holds blocks only.
    private List<BodyBlock>? EntryBody(List<Block> blocks, string id)
    {
        var before = _diagnostics.Count;
        var body = new List<BodyBlock>();
        var number = 0;
        foreach (var block in blocks)
        {
            var line = block.Line + 1;
            if (block is HeadingBlock)
            {
                Error(line, "a glossary entry holds no headings");
            }
            else if (block is LinkReferenceDefinitionGroup definitions)
            {
                definitions.OfType<LinkReferenceDefinition>().ToList().ForEach(d => Target(d.Url, d.Title, d.Line + 1));
            }
            else if (Body(block, string.Create(CultureInfo.InvariantCulture, $"{id}/b{++number}"), line) is { } node)
            {
                body.Add(node);
            }
        }

        return _diagnostics.Count == before ? body : null;
    }

    private Dictionary<string, List<BodyBlock>>? ErrorBody(List<Block> blocks, string id, int start)
    {
        if (blocks.Count != 1 || blocks[0] is not ListBlock list)
        {
            Error(blocks.Count == 0 ? start + 1 : blocks[blocks[0] is ListBlock ? 1 : 0].Line + 1, ErrorBodyRule);
            return null;
        }

        var number = 0;
        var fields = Fields(list, ErrorFields, () => string.Create(CultureInfo.InvariantCulture, $"{id}/b{++number}"));
        var missing = fields is null ? [] : ErrorFields.Where(f => !fields.ContainsKey(f)).ToList();
        missing.ForEach(f => Error(list.Line + 1, $"an error entry needs the field \"{f}\"; {ErrorBodyRule}"));
        return missing.Count == 0 ? fields : null;
    }
}
