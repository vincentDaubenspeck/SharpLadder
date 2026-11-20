using System.Globalization;
using Markdig;
using Markdig.Syntax;

namespace SharpLadder.Content;

/// <content>Walk-it blocks: a fence of one closed YAML document read into one typed block.</content>
internal sealed partial class SourceFile
{
    public const string WalkPrefix = "walk-";
    private const string WalkLanguage = "walk-it";

    // The walk ids this file declares; only these may carry the walk prefix.
    public List<string> WalkIds { get; } = [];

    // The section each walk-it stands in, so a review entry can name a walk-it of its own section.
    public List<(string Section, string Walk)> SectionWalks { get; } = [];

    private WalkItNode? WalkIt(FencedCodeBlock fence, string blockId, int line)
    {
        var id = WalkId(fence, line);
        if (id is null)
        {
            return null;
        }

        var (document, at, problem) = WalkItYaml.Read(FenceReader.Source(fence));
        if (document is null)
        {
            Error(line + at, problem!);
            return null;
        }

        var before = _diagnostics.Count;
        WalkRules(document, line);
        var title = WalkText(document.Title, "title", line);
        var sequences = new List<WalkSequence>();
        for (var s = 0; s < document.Sequences.Count; s++)
        {
            var source = document.Sequences[s];
            var intro = WalkText(source.Intro, "intro", line);
            var steps = new List<WalkStep>();
            for (var k = 0; k < source.Steps.Count; k++)
            {
                var step = source.Steps[k];
                if (WalkText(step.Note, "note", line) is { } note)
                {
                    steps.Add(new WalkStep
                    {
                        BlockId = WalkItHooks.Step(blockId, s + 1, k + 1),
                        Dst = step.Dst.Value,
                        Src = step.Src?.Value,
                        Value = step.Value,
                        Note = note,
                        Lost = step.Lost ? true : null,
                    });
                }
            }

            if (intro is not null)
            {
                sequences.Add(new WalkSequence { Name = source.Name.Value, IntroBlockId = WalkItHooks.Intro(blockId, s + 1), Intro = intro, Steps = steps });
            }
        }

        if (_diagnostics.Count != before || title is null)
        {
            return null;
        }

        var block = new WalkItNode { BlockId = blockId, Id = id, Title = title, Cells = document.Cells, Sequences = sequences };
        if (WalkItHooks.Misplaced(block, blockId) is { } misplaced)
        {
            Error(line, misplaced);
            return null;
        }

        return Registered(block, line);
    }

    // Only a block that passed every rule registers its id, so a refused block adds no repeat.
    private WalkItNode Registered(WalkItNode block, int line)
    {
        Ids.Add((block.Id, line));
        Anchors.Add(block.Id);
        WalkIds.Add(block.Id);
        if (_current is { } section)
        {
            SectionWalks.Add((section.Id, block.Id));
        }

        return block;
    }

    // Rules that need the whole block: each index against the cell count, the sequence names and
    // the losses. Only a sequence with an index outside the cells is not replayed, so the replay
    // never reads past the cells. A self-copy reads its cell before writing back the same token, so
    // its sequence is still replayed and its losses are judged too.
    private void WalkRules(WalkItYaml.Document document, int fenceLine)
    {
        var last = document.Cells.Count - 1;
        var names = new List<string?>();
        foreach (var sequence in document.Sequences)
        {
            names.Add(WalkName(sequence.Name, names, fenceLine));
            var replay = true;
            foreach (var step in sequence.Steps)
            {
                replay &= WalkIndex("dst", step.Dst, last, fenceLine);
                replay &= WalkIndex("src", step.Src, last, fenceLine);
                if (step.Src?.Value == step.Dst.Value)
                {
                    Error(fenceLine + step.Line, string.Create(CultureInfo.InvariantCulture, $"a walk-it step copies cell {step.Dst.Value} onto itself; src and dst name different cells"));
                }
            }

            if (replay)
            {
                WalkLosses(document.Cells, sequence.Steps, fenceLine);
            }
        }
    }

    private bool WalkIndex(string key, WalkItYaml.Slot? index, int last, int fenceLine)
    {
        if (index is not null && index.Value > last)
        {
            Error(fenceLine + index.Line, string.Create(CultureInfo.InvariantCulture, $"walk-it {key} {index.Value} is outside the cells, 0 to {last}"));
            return false;
        }

        return true;
    }

    // Each sequence replays from the starting cells. Each starting cell and each literal write is a
    // new token and a copy carries its source's, so a loss is judged by the token it overwrites and
    // never by an equal value in another cell. A marked step gets one refusal per rule it breaks.
    private void WalkLosses(IReadOnlyList<object?> cells, IReadOnlyList<WalkItYaml.Step> steps, int fenceLine)
    {
        var slots = Enumerable.Range(0, cells.Count).ToArray();
        var before = new int[steps.Count][];
        var written = cells.Count;
        for (var k = 0; k < steps.Count; k++)
        {
            before[k] = [.. slots];
            slots[steps[k].Dst.Value] = steps[k].Src is { } src ? slots[src.Value] : written++;
        }

        // The step, from 1, whose marked loss a cell shows; it stays through later unmarked writes.
        var struck = new int?[cells.Count];
        for (var k = 0; k < steps.Count; k++)
        {
            var step = steps[k];
            if (!step.Lost)
            {
                continue;
            }

            var cell = step.Dst.Value;
            var lost = before[k][cell];
            var line = fenceLine + step.Line;
            if (lost < cells.Count && cells[lost] is null)
            {
                Error(line, string.Create(CultureInfo.InvariantCulture, $"a walk-it step marked lost writes cell {cell}, which holds null before the write; mark lost only where a value is overwritten"));
            }

            var reader = Enumerable.Range(k + 1, steps.Count - k - 1).FirstOrDefault(j => steps[j].Src is { } src && before[j][src.Value] == lost, -1);
            if (reader >= 0)
            {
                Error(line, string.Create(CultureInfo.InvariantCulture, $"a walk-it step marked lost overwrites the value in cell {cell}, but step {reader + 1} still reads that value from cell {steps[reader].Src!.Value}; mark lost only a value that is never read again"));
            }

            if (struck[cell] is { } first)
            {
                Error(line, string.Create(CultureInfo.InvariantCulture, $"a walk-it step marked lost writes cell {cell}, which already shows the value struck at step {first}; a cell is struck at most once in a sequence"));
            }
            else
            {
                struck[cell] = k + 1;
            }
        }
    }

    // A refused name is kept as null, so it is never compared again and positions still count.
    private string? WalkName(WalkItYaml.Text name, List<string?> earlier, int fenceLine)
    {
        var shown = PlainYaml.Shown(name.Value);
        var first = earlier.FindIndex(n => string.Equals(n, name.Value, StringComparison.Ordinal));
        string? problem = null;
        if (!Storable(name.Value))
        {
            problem = $"walk-it sequence name {shown} holds a line break or a character that cannot be shown; write it on one line";
        }
        else if (!Registries.ShowsSomething(name.Value))
        {
            problem = $"walk-it sequence name {shown} is blank; write a name that shows";
        }
        else if (first >= 0)
        {
            problem = string.Create(CultureInfo.InvariantCulture, $"walk-it sequence name {shown} is already the name of sequence {first + 1}; names are unique in the block");
        }

        if (problem is null)
        {
            return name.Value;
        }

        Error(fenceLine + name.Line, problem);
        return null;
    }

    // The id is the fence's only attribute, read from the raw line as a code fence's is.
    private string? WalkId(FencedCodeBlock fence, int line)
    {
        var info = _lines[fence.Line].TrimStart().TrimStart(fence.FencedChar).Trim();
        var group = info.StartsWith(WalkLanguage, StringComparison.Ordinal) ? AttributeGroup.Parse(info[WalkLanguage.Length..].Trim()) : null;
        var id = group is { IdCount: 1, ClassCount: 0, PropertyNames.Count: 0, Properties.Count: 0 } ? group.Attributes.Id : null;
        if (id is null || !ContentIds.IsValid(id) || !id.StartsWith(WalkPrefix, StringComparison.Ordinal) || id.Length == WalkPrefix.Length)
        {
            Error(line, "a walk-it fence takes one {#id} that starts with walk- and nothing else; write its info string as walk-it {#walk-name}");
            return null;
        }

        return id;
    }

    // A text field is one paragraph of inline Markdown, held to the span rules of body text.
    private List<Span>? WalkText(WalkItYaml.Text text, string field, int fenceLine)
    {
        var line = fenceLine + text.Line;
        var document = Markdown.Parse(text.Value, Pipeline);
        if (document.Count != 1 || document[0] is not ParagraphBlock paragraph)
        {
            Error(line, $"walk-it {field} is one paragraph of inline text");
            return null;
        }

        var origin = text.FirstLine is int first ? new LineOrigin(fenceLine + first, Fixed: false) : new LineOrigin(line, Fixed: true);
        var lines = text.Value.Split('\n');
        var content = NoAttributes(paragraph, origin.Of(paragraph.Line)) && NoReservedPipe(paragraph, origin, lines, LineStarts(lines))
            ? Inlines(paragraph.Inline, origin)
            : null;
        if (content is not null)
        {
            _constructLines[content] = origin.Of(paragraph.Line);
        }

        return content;
    }
}
