using System.Globalization;

namespace SharpLadder.Content;

internal static class SpokenText
{
    private static readonly char[] CellEdges = ['\t', '\n', '\v', '\f', '\r', ' '];

    // One sentence naming the columns, then one per row pairing each header with its value. An
    // empty header or cell is spoken by its fallback words, which are hashed like any other.
    public static string Table(TableNode table)
    {
        var headers = table.Headers.Select((h, c) => Cell(h, string.Create(CultureInfo.InvariantCulture, $"Column {c + 1}"))).ToList();
        var sentences = new List<string> { End("Columns: " + string.Join(", ", headers)) };
        for (var r = 0; r < table.Rows.Count; r++)
        {
            var pairs = table.Rows[r].Select((cell, c) => headers[c] + ": " + Cell(cell, "blank"));
            sentences.Add(End(string.Create(CultureInfo.InvariantCulture, $"Row {r + 1}. ") + string.Join("; ", pairs)));
        }

        return string.Join(' ', sentences);
    }

    // Span text in order with nothing added between spans; a soft break is already one space.
    public static string Flatten(IReadOnlyList<Span> spans) =>
        string.Concat(spans.Select(span => span switch
        {
            TextSpan text => text.Text,
            CodeSpan code => code.Text,
            EmphasisSpan emphasis => Flatten(emphasis.Content),
            StrongSpan strong => Flatten(strong.Content),
            LinkSpan link => Flatten(link.Content),
            TermSpan term => Flatten(term.Content),
            _ => throw new InvalidOperationException("a span kind has no spoken form"),
        }));

    private static string Cell(IReadOnlyList<Span> spans, string fallback)
    {
        var text = Flatten(spans).Trim(CellEdges);
        return text.Length == 0 ? fallback : text;
    }

    private static string End(string sentence) => sentence[^1] is '.' or '!' or '?' or '\u2026' ? sentence : sentence + ".";
}
