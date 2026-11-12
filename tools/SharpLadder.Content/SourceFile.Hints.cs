using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Markdig.Renderers.Html;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace SharpLadder.Content;

/// <content>Hints: each section is one ladder, a ## heading, its three key lines and its rungs.</content>
internal sealed partial class SourceFile
{
    public const string LadderPrefix = "ladder-";

    public const string PatternPrefix = "pat-";

    private const string HintsForm = "a hints section is its ## heading, then the lines cue:, pattern: and approach: in that order, then one ordered list of rungs";

    private const string RungForm = "a rung is one paragraph that starts with its id: 1. {#r1} text";

    private const int MaxRungLength = 48;

    private static readonly string[] KeyNames = ["cue", "pattern", "approach"];

    // The ladders this file declares, each with the lines of its heading and its pattern.
    public List<(Ladder Ladder, int Line, int PatternLine)> Ladders { get; } = [];

    // The cue catalogue of a hints part: every ladder's public cue and its speech.
    public HintsCatalogue? Catalogue { get; private set; }

    [GeneratedRegex(@"^ {0,3}[0-9]{1,9}[.)] +\{#(?<id>r[0-9]+)\} +\S", RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture, matchTimeoutMilliseconds: 1000)]
    private static partial Regex RungStart();

    // What a ladder hides is read only once revealed, so it holds nothing that leads elsewhere.
    private static bool IsPlainContent(IEnumerable<Span> spans) =>
        spans.All(span => span switch
        {
            TextSpan or CodeSpan => true,
            EmphasisSpan emphasis => IsPlainContent(emphasis.Content),
            StrongSpan strong => IsPlainContent(strong.Content),
            _ => false,
        });

    private bool ReadHints(List<Block> blocks)
    {
        var before = _diagnostics.Count;
        HeadingBlock? heading = null;
        var parts = new List<Block>();
        foreach (var block in blocks)
        {
            if (block is HeadingBlock next)
            {
                if (heading is not null)
                {
                    ReadLadder(heading, parts);
                }

                (heading, parts) = (next, []);
            }
            else if (heading is null)
            {
                Error(block.Line + 1, "a part file holds nothing before its first ## heading");
            }
            else
            {
                parts.Add(block);
            }
        }

        if (heading is not null)
        {
            ReadLadder(heading, parts);
        }

        return _diagnostics.Count == before;
    }

    private void ReadLadder(HeadingBlock heading, List<Block> parts)
    {
        var line = heading.Line + 1;
        var groups = AttributeGroup.Trailing(_lines[heading.Line]);
        var id = groups.Count == 1 ? groups[0].Attributes.Id : null;
        var problem = HeadingProblem(heading, groups, id);
        if (problem is null && groups[0].PropertyNames.Count > 0)
        {
            problem = "a ladder heading takes its {#id} and nothing else";
        }
        else if (problem is null && !id!.StartsWith(LadderPrefix, StringComparison.Ordinal))
        {
            problem = $"ladder id \"{id}\" must start with {LadderPrefix}";
        }

        if (problem is not null)
        {
            Error(line, problem);
            return;
        }

        Ids.Add((id!, line));
        var title = Title(heading, line);
        if (title is null)
        {
            return;
        }

        if (!IsPlainContent(title) || !Registries.ShowsSomething(SpokenText.Flatten(title)))
        {
            Error(line, "a ladder heading holds text, code, *em* and **strong** only");
            return;
        }

        if (parts is not [ParagraphBlock keys, ListBlock { IsOrdered: true } list])
        {
            Error(parts.Count > 0 ? parts[0].Line + 1 : line, HintsForm);
            return;
        }

        var fields = KeyLines(keys);
        var rungs = Rungs(list, id!);
        if (fields is null || rungs is null)
        {
            return;
        }

        var cue = new Cue { BlockId = string.Create(CultureInfo.InvariantCulture, $"{id}/b1"), Text = fields[0] };
        Ladders.Add((new Ladder { Id = id!, Title = title, Cue = cue, Pattern = fields[1], Approach = fields[2], Rungs = rungs }, line, keys.Line + 2));
    }

    // The key lines are plain text, so the paragraph holds literals and its two soft breaks alone.
    private string[]? KeyLines(ParagraphBlock keys)
    {
        var line = keys.Line + 1;
        if (!NoAttributes(keys, line))
        {
            return null;
        }

        var text = new StringBuilder();
        foreach (var inline in keys.Inline ?? Enumerable.Empty<Inline>())
        {
            switch (inline)
            {
                case LiteralInline literal:
                    text.Append(literal.Content.ToString());
                    break;
                case LineBreakInline { IsHard: false }:
                    text.Append('\n');
                    break;
                default:
                    Error(line, "the cue, pattern and approach lines are plain text");
                    return null;
            }
        }

        var lines = text.ToString().Split('\n');
        if (lines.Length != KeyNames.Length)
        {
            Error(line, HintsForm);
            return null;
        }

        var values = new string[KeyNames.Length];
        for (var i = 0; i < KeyNames.Length; i++)
        {
            if (KeyValue(lines[i], KeyNames[i], line + i) is not { } value)
            {
                return null;
            }

            values[i] = value;
        }

        if (!ContentIds.IsValid(values[1]) || !values[1].StartsWith(PatternPrefix, StringComparison.Ordinal))
        {
            Error(line + 1, $"pattern \"{Shown(values[1])}\" is no pattern id; name one from patterns.yml");
            return null;
        }

        return values;
    }

    private string? KeyValue(string text, string key, int line)
    {
        var prefix = key + ":";
        if (!text.StartsWith(prefix, StringComparison.Ordinal))
        {
            Error(line, HintsForm);
            return null;
        }

        var value = text[prefix.Length..].Trim();
        if (!Storable(value) || !AudioSlot.IsStorable(value))
        {
            Error(line, $"the {key} line holds a character that cannot be stored");
            return null;
        }

        if (!Registries.ShowsSomething(value))
        {
            Error(line, $"the {key} line holds no text");
            return null;
        }

        return value;
    }

    private List<Rung>? Rungs(ListBlock list, string ladder)
    {
        var line = list.Line + 1;
        if (!NoAttributes(list, line))
        {
            return null;
        }

        if (list.OrderedStart is not (null or "1"))
        {
            Error(line, "a rung list starts at 1");
            return null;
        }

        var rungs = new List<Rung>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var ok = true;
        foreach (var child in list)
        {
            if (child is not ListItemBlock { Count: 1 } item || item[0] is not ParagraphBlock paragraph)
            {
                Error(child.Line + 1, RungForm);
                ok = false;
                continue;
            }

            var rung = ReadRung(item, paragraph, ladder, seen);
            ok = rung is not null && ok;
            if (rung is not null)
            {
                rungs.Add(rung);
            }
        }

        return ok ? rungs : null;
    }

    // The id is read where the author wrote it, before the text; Markdig keeps it as the
    // paragraph's own attribute, so both must name the same rung.
    private Rung? ReadRung(ListItemBlock item, ParagraphBlock paragraph, string ladder, HashSet<string> seen)
    {
        var line = paragraph.Line + 1;
        var start = RungStart().Match(_lines[paragraph.Line]);
        var attributes = paragraph.TryGetAttributes();
        var id = start.Success ? start.Groups["id"].Value : null;
        if (id is null || !NoAttributes(item, line) || attributes is not { Classes: null or { Count: 0 }, Properties: null or { Count: 0 } }
            || !string.Equals(attributes.Id, id, StringComparison.Ordinal))
        {
            Error(line, RungForm);
            return null;
        }

        if (id.Length > MaxRungLength)
        {
            Error(line, $"rung id \"{id}\" is longer than {MaxRungLength.ToString(CultureInfo.InvariantCulture)} characters");
            return null;
        }

        if (!seen.Add(id))
        {
            Error(line, $"rung id \"{id}\" is used twice in ladder \"{ladder}\"");
            return null;
        }

        var content = Inlines(paragraph.Inline, line);
        if (content is null)
        {
            return null;
        }

        if (!IsPlainContent(content))
        {
            Error(line, "a rung holds text, code, *em* and **strong** only");
            return null;
        }

        // The id is gone from the text, so the space that followed it opens the first span.
        if (content is [TextSpan first, ..])
        {
            var rest = first.Text.TrimStart();
            content = rest.Length > 0 ? [new TextSpan { Text = rest }, .. content[1..]] : content[1..];
        }

        if (!Registries.ShowsSomething(SpokenText.Flatten(content)))
        {
            Error(line, "a rung holds text");
            return null;
        }

        return new Rung { Id = id, Content = content };
    }

    // Each ladder's segment is its cue alone, fixed here, so no selection can change what is spoken.
    private void BuildCatalogue(string? chapter, int? order)
    {
        var ladders = new List<CatalogueLadder>();
        foreach (var (ladder, _, patternLine) in Ladders)
        {
            _segments = [];
            Segment(new BlockTarget { BlockId = ladder.Cue.BlockId }, ladder.Cue.Text, patternLine - 1);
            if (_segments is [var segment])
            {
                var spoken = new SectionSpeech { Segments = [segment], Audio = AudioSlot.Of([segment.Text]) };
                ladders.Add(new CatalogueLadder { Id = ladder.Id, Cue = ladder.Cue, Spoken = spoken });
            }
        }

        _segments = [];
        Catalogue = new HintsCatalogue { Chapter = chapter, Order = order, Ladders = ladders };
    }
}
