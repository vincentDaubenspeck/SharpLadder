using System.Text.RegularExpressions;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace SharpLadder.Content;

/// <content>Labelled fields: list items that open with a plain label and hold body blocks.</content>
internal sealed partial class SourceFile
{
    [GeneratedRegex(@"^(?<label>[a-z]+):", RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture, matchTimeoutMilliseconds: 1000)]
    private static partial Regex FieldLabel();

    // The label is read from the first run of plain text only, so markup never spells one.
    private static string? Label(ListItemBlock item) =>
        item.Count > 0 && item[0] is ParagraphBlock { Inline.FirstChild: LiteralInline literal } && FieldLabel().Match(literal.Content.ToString()) is { Success: true } match
            ? match.Groups["label"].Value
            : null;

    // Reads a bullet list as fields in the order of labels; which of them must be present, and
    // how much each may hold, is the caller's rule. Null after reporting.
    private Dictionary<string, List<BodyBlock>>? Fields(ListBlock list, string[] labels, Func<string> nextId)
    {
        var written = string.Join(", ", labels);
        if (list.IsOrdered || !NoAttributes(list, list.Line + 1))
        {
            Error(list.Line + 1, $"fields are written as a bullet list, one item for each of {written}");
            return null;
        }

        var before = _diagnostics.Count;
        var fields = new Dictionary<string, List<BodyBlock>>(StringComparer.Ordinal);
        var last = -1;
        foreach (var item in list.Cast<ListItemBlock>())
        {
            var line = item.Line + 1;
            var label = Label(item);
            var index = label is null ? -1 : Array.IndexOf(labels, label);
            if (label is null || index < 0)
            {
                Error(line, $"a field starts with its label in plain text and a colon; the labels are {written}");
            }
            else if (fields.ContainsKey(label))
            {
                Error(line, $"field \"{label}\" is written twice");
            }
            else if (index < last)
            {
                Error(line, $"field \"{label}\" is out of order; the order is {written}");
            }
            else if (FieldBlocks(item, label, nextId) is { } blocks)
            {
                fields[label] = blocks;
                last = index;
            }
        }

        return _diagnostics.Count == before ? fields : null;
    }

    // The text after the label is the field's first paragraph; the item's further blocks follow.
    private List<BodyBlock>? FieldBlocks(ListItemBlock item, string label, Func<string> nextId)
    {
        var line = item.Line + 1;
        var paragraph = (ParagraphBlock)item[0];
        var literal = (LiteralInline)paragraph.Inline!.FirstChild!;
        var rest = literal.Content.ToString()[(label.Length + 1)..];
        var before = _diagnostics.Count;
        var blocks = new List<BodyBlock>();
        var alone = rest.Length == 0 && literal.NextSibling is null;
        var spaced = rest.StartsWith(' ') && (rest.Length > 1 ? !char.IsWhiteSpace(rest[1]) : literal.NextSibling is not (null or LineBreakInline));
        if (!alone && !spaced)
        {
            Error(line, $"write the text of \"{label}\" after one space on the label's line, or end the line at \"{label}:\" and put its blocks below");
            return null;
        }

        if (!NoAttributes(item, line) || !NoAttributes(paragraph, line) || !NoReservedPipe(paragraph, line))
        {
            return null;
        }

        if (spaced)
        {
            if (rest.Length > 1)
            {
                literal.Content = new Markdig.Helpers.StringSlice(rest[1..]);
            }
            else
            {
                literal.Remove();
            }

            if (Inlines(paragraph.Inline, line) is { } content)
            {
                blocks.Add(new ParagraphNode { BlockId = nextId(), Content = content });
            }
        }

        foreach (var block in item.Skip(1))
        {
            if (Body(block, nextId(), block.Line + 1) is { } node)
            {
                blocks.Add(node);
            }
        }

        if (_diagnostics.Count == before && blocks.Count == 0)
        {
            Error(line, $"field \"{label}\" is empty");
        }

        return _diagnostics.Count == before ? blocks : null;
    }
}
