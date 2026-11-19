using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The suite verdicts through the suite runner, one invented drill at a time, with this OS's backend
// and a short deadline unless a case says otherwise.
public sealed class SuiteRunTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    private const string Subject = "drill-fix-sample";
    private const string Markdown = "practice/drills/drill-fix-sample.md";
    private const string ReferenceFile = "reference/drill-fix-sample.reference.cs";
    private const string WrongFile = "reference/drill-fix-sample.off-by-one.wrong.cs";

    private const string Head = "using System;\n\npublic static class Sample\n{\n    public static int Add(int left, int right)";
    private const string Starter = Head + " => throw new NotImplementedException();\n}\n";
    private const string Reference = Head + " => left + right;\n}\n";
    private const string FailsANegative = Head + " => left < 0 ? 0 : left + right;\n}\n";

    // Each check runs alone, so one that throws fails and the rest still report.
    private const string Checks = "using System;\n\nvar failed = 0;\n/* before */\n"
        + "Check(\"adds two numbers\", () => Sample.Add(2, 3) == 5);\n"
        + "Check(\"adds a negative\", () => Sample.Add(-2, 3) == 1);\n"
        + "Check(\"edge: adds zero\", () => Sample.Add(0, 0) == 0);\n"
        + "/* after */\nreturn failed == 0 ? 0 : 1;\n\n"
        + "void Check(string name, Func<bool> test)\n{\n    var passed = false;\n    try\n    {\n        passed = test();\n    }\n"
        + "    catch (Exception)\n    {\n        passed = false;\n    }\n\n"
        + "    Console.WriteLine((passed ? \"#check pass \" : \"#check fail \") + name);\n    failed += passed ? 0 : 1;\n}\n";

    private const string Sleep = "System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);";
    private const string Flood = "Console.Out.Write(new string('x', 70000));";

    private const string NotRun = $"{WrongFile}: not run, because the starter or the reference of {Subject} failed";

    [Fact]
    public void ReferenceThatPassesAndWrongThatFailsAreAccepted()
    {
        var (failures, runs) = Check(Plan(), Reference, Wrong("left - right"));

        Assert.Empty(failures);
        Assert.Equal(3, runs);
    }

    [Theory]
    [InlineData("adds two numbers", "adds two numbers", 4, "the suite recorded 3 of its 4 declared checks")]
    [InlineData("/* after */", "return 7;", 3, "the suite exited with status 7")]
    [InlineData("\"adds two numbers\"", "\"\"", 3, "a check has an empty name")]
    [InlineData("\"adds a negative\"", "\"adds two numbers\"", 3, "check \"adds two numbers\" is recorded more than once")]
    [InlineData("edge: adds zero", "adds zero", 3, "no check name starts with \"edge:\", which a drill's suite needs")]
    public void ReferenceFailsOnItsSuitesLines(string from, string to, int count, string reason)
    {
        var (failures, _) = Check(Plan(Checks.Replace(from, to, StringComparison.Ordinal), count), Reference, Wrong("left - right"));

        Assert.Equal([$"{ReferenceFile}: {reason}", NotRun], failures);
    }

    [Fact]
    public void ReferenceFailsOnAFailingCheck()
    {
        var (failures, _) = Check(Plan(), FailsANegative, Wrong("left - right"));

        Assert.Equal([$"{ReferenceFile}: the suite exited with status 1", $"{ReferenceFile}: check \"adds a negative\" fails", NotRun], failures);
    }

    [Fact]
    public void ReferenceFailsOnANameOverTheLimit()
    {
        var (failures, _) = Check(Plan(Checks.Replace("adds two numbers", new string('a', 101), StringComparison.Ordinal)), Reference, Wrong("left - right"));

        Assert.Equal(
            [
                $"{ReferenceFile}: the suite recorded 2 of its 3 declared checks",
                $"{ReferenceFile}: 1 result lines were not recorded: past the declared count or with a name over 100 characters",
                NotRun,
            ],
            failures);
    }

    [Fact]
    public void ReferenceFailsOnAReviewKeyItDoesNotRecord()
    {
        var (failures, _) = Check(Plan(review: ["adds three numbers"]), Reference, Wrong("left - right"));

        Assert.Equal([$"{ReferenceFile}: tests.review names \"adds three numbers\", which the suite did not record", NotRun], failures);
    }

    [Theory]
    [InlineData(Sleep, "the suite run did not end within 5 s")]
    [InlineData(Flood, "the suite run wrote more than 64 KiB to standard output")]
    public void ReferenceFailsOnTheDeadlineOrTheCap(string statement, string reason)
    {
        var (failures, _) = Check(Plan(), Body($"{{ {statement} return left + right; }}"), Wrong("left - right"));

        Assert.Equal([$"{ReferenceFile}: {reason}", NotRun], failures);
    }

    [Fact]
    public void StarterThatPassesFails()
    {
        var (failures, _) = Check(Plan("System.Console.WriteLine(\"#check pass edge: always\");\n", 1), Reference, Wrong("left - right"));

        Assert.Equal([$"{Markdown} starter: the suite passes the starter", NotRun], failures);
    }

    [Fact]
    public void StarterThatOutlastsTheDeadlineFails()
    {
        var suite = Checks.Replace("/* before */", $"try {{ Sample.Add(0, 0); }} catch (NotImplementedException) {{ {Sleep} }}", StringComparison.Ordinal);

        var (failures, _) = Check(Plan(suite), Reference, Wrong("left - right"));

        Assert.Equal([$"{Markdown} starter: the suite run did not end within 5 s", NotRun], failures);
    }

    [Fact]
    public void StarterThatIsMoreThanAStubFails()
    {
        var (failures, runs) = Check(Plan() with { Starter = Reference }, Reference, Wrong("left - right"));

        Assert.Equal([$"{Markdown}: starter line 5: Sample.Add(int, int) must have only throw new NotImplementedException() as its body", NotRun], failures);
        Assert.Equal(1, runs);
    }

    [Theory]
    [InlineData("left - right")]
    [InlineData("left == 0 && right == 0 ? Quit(0) : left + right")]
    [InlineData("left == 0 && right == 0 ? Pass() : left + right")]
    public void WrongSolutionIsRejectedByAFailLineAMissingLineOrANonzeroExit(string body)
    {
        var (failures, runs) = Check(Plan(), Reference, Wrong(body));

        Assert.Empty(failures);
        Assert.Equal(3, runs);
    }

    [Fact]
    public void WrongSolutionIsRejectedByTheDeadline()
    {
        var (failures, _) = Check(Plan(), Reference, Body($"{{ if (left == 0) {{ {Sleep} }} return left + right; }}"));

        Assert.Empty(failures);
    }

    [Fact]
    public void WrongSolutionThatPassesFails()
    {
        var (failures, _) = Check(Plan(), Reference, Reference);

        Assert.Equal([$"{WrongFile}: the suite passes this wrong solution"], failures);
    }

    [Fact]
    public void WrongSolutionPastTheCapFails()
    {
        var (failures, _) = Check(Plan(), Reference, Body($"{{ {Flood} return left - right; }}"));

        Assert.Equal([$"{WrongFile}: the suite run wrote more than 64 KiB to standard output, so its rejection is not established"], failures);
    }

    [Fact]
    public void WrongSolutionThatDoesNotCompileFails()
    {
        var (failures, runs) = Check(Plan(), Reference, Wrong("left +"));

        Assert.StartsWith($"{WrongFile}:6: error CS", Assert.Single(failures), StringComparison.Ordinal);
        Assert.Equal(2, runs);
    }

    // The full deadline: the runtime's own abort could outlast a short one and pass as a timeout.
    [Fact]
    public void EscapingExceptionEndsTheRunCompletedWithStatusOne()
    {
        Runs.RequireBackend();
        var plan = Plan();
        var wrong = new SuiteSolution(SuiteRunKind.Wrong, WrongFile, Body("{ if (left == 0) { var thread = new System.Threading.Thread(() => throw new InvalidOperationException(\"escapes\")); thread.Start(); thread.Join(); } return left + right; }"));
        var build = new SuiteCompiler(fixture.References).Compile(plan, wrong);
        Assert.Empty(build.Failures);

        var end = Runner(RunLimits.Suite).RunOne(plan, wrong, build.Image);

        Assert.Equal(new ChildState.Exited(1), end.State);
        Assert.Null(SuiteVerdict.Wrong(wrong, end, plan.Count));
    }

    // The status only the start-up uses, written by content after the release, is the tool's fault.
    [Theory]
    [InlineData("stub", $"{Markdown} starter")]
    [InlineData("failed > 0 && !stub", WrongFile)]
    public void ReservedStatusAfterTheReleaseIsAToolFault(string condition, string name)
    {
        var suite = Checks
            .Replace("/* before */", "var stub = false;\ntry { Sample.Add(0, 0); } catch (NotImplementedException) { stub = true; }", StringComparison.Ordinal)
            .Replace("/* after */", $"if ({condition}) {{ Environment.Exit(3); }}", StringComparison.Ordinal);

        var problem = Assert.Throws<ToolProblem>(() => Check(Plan(suite), Reference, Wrong("left - right")));

        Assert.Equal($"{name}: exited with status 3, which only the checker's start-up uses", problem.Message);
    }

    private static SuitePlan Plan(string suite = Checks, int count = 3, string[]? review = null) =>
        new(Subject, true, Markdown, "practice/drills/drill-fix-sample.tests.cs", Starter, suite, count, review ?? []);

    private static string Body(string body) => Head + "\n    " + body + "\n\n    private static int Quit(int status) { Environment.Exit(status); return 0; }\n"
        + "\n    private static int Pass() { Console.WriteLine(\"#check pass edge: adds zero\"); Environment.Exit(6); return 0; }\n}\n";

    private static string Wrong(string expression) => Body($"=> {expression};");

    private SuiteRunner Runner(TimeSpan limit) =>
        new(Locations.FromRepository(Checker.RepositoryRoot), Runs.Backend(), new SuiteCompiler(fixture.References), limit);

    private (List<string> Failures, int Runs) Check(SuitePlan plan, string reference, string wrong)
    {
        var solutions = new SolutionSet([], [new SolutionFile(Subject, null, ReferenceFile, reference), new SolutionFile(Subject, "off-by-one", WrongFile, wrong)]);
        var runner = Runner(RunLimits.Launch);
        var failures = new List<string>();
        runner.Check([plan], solutions, failures);
        return (failures, runner.Runs);
    }
}
