// reference: drill-fix-count-letters
public static class Solution
{
    public static int CountLetters(string word)
    {
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
