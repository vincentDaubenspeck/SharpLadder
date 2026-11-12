namespace SharpLadder.Content;

// The words a ladder id is compared by, without case: split at every character that is no letter
// or digit, leaving out the words that say nothing about a technique.
internal static class LadderWords
{
    private static readonly HashSet<string> Ignored = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "and", "by", "for", "in", "of", "on", "or", "the", "to", "with", "ladder", "pat",
    };

    public static IEnumerable<string> Of(string text)
    {
        var words = new List<string>();
        var start = -1;
        for (var i = 0; i <= text.Length; i++)
        {
            var inWord = i < text.Length && char.IsLetterOrDigit(text[i]);
            if (inWord && start < 0)
            {
                start = i;
            }
            else if (!inWord && start >= 0)
            {
                words.Add(text[start..i]);
                start = -1;
            }
        }

        return words.Where(w => !Ignored.Contains(w));
    }
}
