namespace SharpLadder.Content;

internal static class SpokenText
{
    // Span text in order with nothing added between spans; a soft break is already one space.
    public static string Flatten(IReadOnlyList<Span> spans) =>
        string.Concat(spans.Select(span => span switch
        {
            TextSpan text => text.Text,
            CodeSpan code => code.Text,
            EmphasisSpan emphasis => Flatten(emphasis.Content),
            StrongSpan strong => Flatten(strong.Content),
            LinkSpan link => Flatten(link.Content),
            _ => throw new InvalidOperationException("a span kind has no spoken form"),
        }));
}
