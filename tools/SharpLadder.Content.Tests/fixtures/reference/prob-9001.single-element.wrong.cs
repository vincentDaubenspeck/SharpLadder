// wrong: prob-9001 single-element
public static class Solution
{
    public static int CountMatchingEnds(string[] words)
    {
        if (words.Length == 1)
        {
            return 0;
        }

        var count = 0;
        foreach (var word in words)
        {
            if (word.Length > 0 && word[0] == word[^1])
            {
                count++;
            }
        }

        return count;
    }
}
