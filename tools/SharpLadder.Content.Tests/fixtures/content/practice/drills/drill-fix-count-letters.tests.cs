using System;

var failed = 0;
Check("counts every letter", () => Solution.CountLetters("cat") == 3);
Check("skips digits and spaces", () => Solution.CountLetters("a1 b") == 2);
Check("edge: an empty word has no letters", () => Solution.CountLetters("") == 0);
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
