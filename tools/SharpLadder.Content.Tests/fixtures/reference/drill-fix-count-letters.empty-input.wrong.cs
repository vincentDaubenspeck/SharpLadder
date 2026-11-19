// wrong: drill-fix-count-letters empty-input
public static class Solution
{
    public static int CountLetters(string word)
    {
        if (word.Length == 0)
        {
            return -1;
        }

        var count = 0;
        for (var i = 0; i < word.Length; i++)
        {
            if (char.IsLetter(word[i]))
            {
                count++;
            }
        }

        return count;
    }
}
