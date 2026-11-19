using System;

var failed = 0;
Check("stops at the stop word",
    () => Solution.WordsBeforeStop(["red", "blue", "stop", "green"], "stop") == 2);
Check("reads every word without a stop word",
    () => Solution.WordsBeforeStop(["red", "blue"], "stop") == 2);
Check("edge: no words reads none", () => Solution.WordsBeforeStop([], "stop") == 0);
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
