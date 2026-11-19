// reference: drill-fix-largest
public static class Solution
{
    public static int Largest(int a, int b, int c)
    {
        var largest = a;
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
