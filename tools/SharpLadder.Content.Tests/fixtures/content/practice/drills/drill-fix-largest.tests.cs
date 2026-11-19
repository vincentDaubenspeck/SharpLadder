using System;

var failed = 0;
Check("keeps the first when it is largest", () => Solution.Largest(9, 2, 3) == 9);
Check("keeps the last when it is largest", () => Solution.Largest(1, 2, 8) == 8);
Check("edge: all negative keeps the largest",
    () => Solution.Largest(-5, -2, -9) == -2);
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
