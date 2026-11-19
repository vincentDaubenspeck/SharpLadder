using System;

var failed = 0;
Check("counts words with matching ends",
    () => Solution.CountMatchingEnds(["level", "noon", "cat"]) == 2);
Check("counts one-letter words",
    () => Solution.CountMatchingEnds(["a", "be"]) == 1);
Check("counts a single word",
    () => Solution.CountMatchingEnds(["wow"]) == 1);
Check("returns zero for no words",
    () => Solution.CountMatchingEnds([]) == 0);
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
