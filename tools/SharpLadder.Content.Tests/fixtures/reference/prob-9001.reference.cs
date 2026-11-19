// reference: prob-9001
public static class Solution
{
    public static int CountMatchingEnds(string[] words)
    {
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
