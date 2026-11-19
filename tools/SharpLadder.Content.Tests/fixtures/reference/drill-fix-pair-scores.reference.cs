// reference: drill-fix-pair-scores
using System;
using System.Collections.Generic;

public static class Solution
{
    public static Dictionary<string, int> Pair(string[] names, int[] scores)
    {
        var pairs = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < Math.Min(names.Length, scores.Length); i++)
        {
            pairs[names[i]] = scores[i];
        }

        return pairs;
    }
}
