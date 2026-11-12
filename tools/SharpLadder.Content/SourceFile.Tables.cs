using System.Text.RegularExpressions;
using Markdig.Extensions.Tables;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace SharpLadder.Content;

/// <content>
/// Tables are admitted in one written form only. The parser's table is the reading; the source
/// lines are checked beside it, so a table the parser padded, cut or found without its pipes
/// is refused rather than repaired.
/// </content>
internal sealed partial class SourceFile
{
    private const string TableRule = "write a table as one header row, one row of dashes and one or more data rows, each line starting and ending with |, with a blank line or a heading above it and a blank line or the end of the file below it";

    // The unescaped pipes of one source line outside its code spans, or -1 when the line does
    // not both start and end with one.
    internal static int Pipes(string line)
    {
        var text = line.Trim(' ', '\t');
        var count = 0;
        var last = -1;
        for (var i = 0; i < text.Length; i++)
        {
            switch (text[i])
            {
                case '\\':
                    i++;
                    break;
                case '`':
                    var run = 1;
                    while (i + run < text.Length && text[i + run] == '`')
                    {
                        run++;
                    }

                    var close = ClosingRun(text, i + run, run);
                    i = close < 0 ? i + run - 1 : close + run - 1;
                    break;
                case '|':
                    count++;
                    last = i;
                    break;
                default:
                    break;
            }
        }

        return text.Length > 1 && text[0] == '|' && last == text.Length - 1 ? count : -1;
    }

    [GeneratedRegex(@"^\|(?: *-+ *\|)+(?![\s\S])", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex DelimiterRow();

    // Where the next run of exactly that many backticks starts, or -1.
    private static int ClosingRun(string text, int from, int length)
    {
        for (var i = from; i < text.Length; i++)
        {
            if (text[i] != '`')
            {
                continue;
            }

            var run = 1;
            while (i + run < text.Length && text[i + run] == '`')
            {
                run++;
            }

            if (run == length)
            {
                return i;
            }

            i += run - 1;
        }

        return -1;
    }

    // An attribute group the parser left in a cell as text: {#id}, {.class} or {key=value}.
    [GeneratedRegex(@"\{\s*(?:[#.:][^\s{}]|[^\s{}=]+=)[^{}]*\}", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex CellAttributes();

    private static string? TableShape(Table table, List<TableRow> rows)
    {
        if (rows.Count != table.Count || rows.Count < 2)
        {
            return "a table holds one header row and at least one data row";
        }

        if (!rows[0].IsHeader || rows.Skip(1).Any(r => r.IsHeader))
        {
            return "exactly the first row of a table is its header";
        }

        if (table.ColumnDefinitions.Any(c => c.Alignment is not null))
        {
            return "column alignment markers are not supported";
        }

        if (rows[0].Count == 0 || rows.Any(r => r.Count != rows[0].Count))
        {
            return "every row of a table holds one cell per header";
        }

        var cells = rows.SelectMany(r => r).ToList();
        return cells.All(c => c is TableCell { ColumnSpan: 1, RowSpan: 1 } cell && (cell.Count == 0 || (cell.Count == 1 && cell[0] is ParagraphBlock)))
            ? null
            : "a table cell holds inline text only and spans one column and one row";
    }

    private TableNode? Table(Table table, string blockId, int line)
    {
        var rows = table.OfType<TableRow>().ToList();
        var problem = TableShape(table, rows) ?? TableLines(table.Line, rows);
        if (problem is not null)
        {
            Error(line, $"{problem}; {TableRule}");
            return null;
        }

        var before = _diagnostics.Count;
        var read = new List<List<IReadOnlyList<Span>>>();
        for (var r = 0; r < rows.Count; r++)
        {
            // The header is the table's first line and the dashes its second.
            var rowLine = line + (r == 0 ? 0 : r + 1);
            var cells = new List<IReadOnlyList<Span>>();
            foreach (var cell in rows[r].Cast<TableCell>())
            {
                var plain = NoAttributes(rows[r], rowLine) && NoAttributes(cell, rowLine);
                var content = cell.Count == 0 ? [] : plain && NoAttributes(cell[0], rowLine) ? Inlines(((ParagraphBlock)cell[0]).Inline, rowLine) : null;
                if (content?.OfType<TextSpan>().Any(t => CellAttributes().IsMatch(t.Text)) == true)
                {
                    Error(rowLine, "attributes are not supported in a table cell");
                }

                // The parser trims a cell and can leave an empty text run at its edge.
                cells.Add([.. (content ?? []).Where(s => s is not TextSpan { Text.Length: 0 })]);
            }

            read.Add(cells);
        }

        return NoAttributes(table, line) && _diagnostics.Count == before
            ? new TableNode { BlockId = blockId, Headers = read[0], Rows = [.. read.Skip(1)] }
            : null;
    }

    // The table's own source lines: as many as its rows and the dashes, each with exactly the
    // pipes of its cells, so the written table and the parsed one are the same table.
    private string? TableLines(int first, List<TableRow> rows)
    {
        var lines = _lines.Skip(first).TakeWhile(l => !string.IsNullOrWhiteSpace(l)).ToList();
        var above = first == 0 ? string.Empty : _lines[first - 1];
        if (lines.Count != rows.Count + 1 || !(string.IsNullOrWhiteSpace(above) || above.StartsWith('#')))
        {
            return "the lines of the table are not exactly its rows";
        }

        var pipes = rows[0].Count + 1;
        if (lines.Any(l => Pipes(l) != pipes))
        {
            return "a line of the table does not start and end with | around exactly its cells";
        }

        return DelimiterRow().IsMatch(lines[1].Trim(' ', '\t')) ? null : "the second line of a table is dashes only";
    }

    // A paragraph line that starts with a pipe is table syntax the parser did not take as a
    // table, so it is never shown as prose. A pipe inside a code span is that span's text.
    private bool NoReservedPipe(ParagraphBlock paragraph, int line)
    {
        var code = (paragraph.Inline?.Descendants<CodeInline>() ?? []).Select(c => c.Span).ToList();
        var start = _lineStarts[paragraph.Line];
        for (var index = paragraph.Line; index < _lines.Length && start <= paragraph.Span.End; index++)
        {
            var at = Math.Max(start, paragraph.Span.Start);
            var end = start + _lines[index].Length;
            while (at < end && _lines[index][at - start] is ' ' or '\t')
            {
                at++;
            }

            if (at < end && _lines[index][at - start] == '|' && !code.Exists(c => c.Start <= at && at <= c.End))
            {
                Error(line + index - paragraph.Line, $"a line that starts with | is read as a table and this one is not a table; {TableRule}, or start the line with \\| to show a pipe");
                return false;
            }

            start = end + 1;
        }

        return true;
    }
}
