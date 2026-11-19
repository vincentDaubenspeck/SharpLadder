// reference: drill-fix-stop-word
using System;

public static class Solution
{
    public static int WordsBeforeStop(string[] words, string stop)
    {
        var read = 0;
        while (read < words.Length
            && !string.Equals(words[read], stop, StringComparison.Ordinal))
        {
            read++;
        }

        return read;
    }
}
