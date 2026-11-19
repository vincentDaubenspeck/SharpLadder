// wrong: drill-fix-stop-word empty-input
using System;

public static class Solution
{
    public static int WordsBeforeStop(string[] words, string stop)
    {
        if (words.Length == 0)
        {
            return -1;
        }

        var read = 0;
        while (read < words.Length
            && !string.Equals(words[read], stop, StringComparison.Ordinal))
        {
            read++;
        }

        return read;
    }
}
