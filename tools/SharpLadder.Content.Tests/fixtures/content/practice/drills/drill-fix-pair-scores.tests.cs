using System;
using System.Collections.Generic;

var failed = 0;
Check("pairs each name with its score", () =>
{
    var pairs = Solution.Pair(["ann", "bo"], [3, 5]);
    return pairs.Count == 2 && pairs["ann"] == 3 && pairs["bo"] == 5;
});
Check("stops at the shorter list",
    () => Solution.Pair(["ann", "bo", "cy"], [3, 5]).Count == 2);
Check("edge: no names gives no pairs", () => Solution.Pair([], []).Count == 0);
return failed == 0 ? 0 : 1;

// Each check runs alone, so one that throws fails and the rest still report.
void Check(string name, Func<bool> test)
{
    var passed = false;
    try
    {
        passed = test();
    }
    catch (Exception)
    {
        passed = false;
    }

    Console.WriteLine((passed ? "#check pass " : "#check fail ") + name);
    failed += passed ? 0 : 1;
}
