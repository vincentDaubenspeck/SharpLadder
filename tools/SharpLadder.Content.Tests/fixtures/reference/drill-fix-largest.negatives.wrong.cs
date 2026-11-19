// wrong: drill-fix-largest negatives
public static class Solution
{
    public static int Largest(int a, int b, int c)
    {
        var largest = 0;
        foreach (var value in new[] { a, b, c })
        {
            if (value > largest)
            {
                largest = value;
            }
        }

        return largest;
    }
}
