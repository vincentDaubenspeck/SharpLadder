using Xunit;
using static SharpLadder.CodeCheck.Tests.Runs;

namespace SharpLadder.CodeCheck.Tests;

// Run halves: each group compiles, runs in its own child process and is judged by its records.
public sealed class RunTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    // The invariant culture's currency format, whose symbol no named culture uses.
    private const string Invariant = "(char)164 + \"1,234.50\"";

    [Fact]
    public void PassingCheckPasses() =>
        Assert.Null(Run(fixture.Compiler, Block("sum", 10, "int total = 2 + 3;\n", check: "total == 5")));

    [Fact]
    public void FalseCheckNamesItsBlockAndFenceLine() =>
        Assert.Equal(
            "chapters/run/blocks.md:20 sum-wrong check is false: total == 7",
            Run(
                fixture.Compiler,
                Block("sum-right", 10, "int total = 2 + 3;\n", group: "sum", check: "total == 5"),
                Block("sum-wrong", 20, "total++;\n", group: "sum", check: "total == 7")));

    [Fact]
    public void ExactThrowsPasses() =>
        Assert.Null(Run(fixture.Compiler, Block("stop", 10, "throw new InvalidOperationException(\"stop\");\n", throws: "InvalidOperationException")));

    [Fact]
    public void EntryTypeStaticConstructorRunsAfterTheStartRecord()
    {
        // The constructor reads what the results file already holds when it runs.
        var declaration = "partial class Program\n{\n    internal static readonly string Seen;\n\n    static Program()\n    {\n"
            + "        var path = Environment.GetEnvironmentVariable(\"" + WireContract.ResultsVariable + "\")!;\n"
            + "        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);\n"
            + "        Seen = new StreamReader(stream).ReadToEnd();\n"
            + "        Console.WriteLine(\"static constructor\");\n    }\n}\n";

        Assert.Null(Run(
            fixture.Compiler,
            Block("entry-read", 10, "string seen = Program.Seen;\n", group: "entry", check: "seen.Contains(\"\\\"kind\\\":\\\"start\\\"\")"),
            Block("entry-static", 20, declaration, group: "entry")));
    }

    [Fact]
    public void ExceptionInALaterBlocksHelperCountsAgainstTheExecutingBlock() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 x1-call threw System.InvalidOperationException, but it is not marked throws",
            Run(
                fixture.Compiler,
                Block("x1-call", 10, "int value = Later.Fail();\n", group: "x1"),
                Block("x1-helper", 20, "static class Later\n{\n    public static int Fail() => throw new InvalidOperationException(\"helper\");\n}\n", group: "x1")));

    [Fact]
    public void ExceptionEscapingAnAwaitedTaskCountsAgainstTheExecutingBlock() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 x2-await threw System.InvalidOperationException, but it is not marked throws",
            Run(
                fixture.Compiler,
                Block("x2-await", 10, "await Later.FailAsync();\n", group: "x2"),
                Block("x2-helper", 20, "static class Later\n{\n    public static async Task FailAsync()\n    {\n        await Task.Yield();\n        throw new InvalidOperationException(\"task\");\n    }\n}\n", group: "x2")));

    [Fact]
    public void DerivedExceptionFailsAnExactThrows() =>
        Assert.Equal(
            "chapters/run/blocks.md:10 derived has throws=System.ArgumentException, but it threw System.ArgumentNullException",
            Run(fixture.Compiler, Block("derived", 10, "throw new ArgumentNullException(\"name\");\n", throws: "ArgumentException")));

    [Fact]
    public void SameNamedTypeOfAnotherIdentityFails() =>
        Assert.Equal(
            "chapters/run/blocks.md:10 same-name has throws=KeyNotFoundException, but it threw System.Collections.Generic.KeyNotFoundException",
            Run(fixture.Compiler, Block("same-name", 10, "var stock = new Dictionary<string, int>();\nint n = stock[\"bolt\"];\nclass KeyNotFoundException : Exception\n{\n}\n", throws: "KeyNotFoundException")));

    [Fact]
    public void ExceptionBeforeAnyBlockIsUnattributed() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 early threw System.TypeInitializationException while no block was executing",
            Run(fixture.Compiler, Block("early", 10, "int value = 1;\npartial class Program\n{\n    static Program() => throw new InvalidOperationException(\"early\");\n}\n")));

    [Fact]
    public void ThrowsBlockThatDoesNotThrowFails() =>
        Assert.Equal(
            "chapters/run/blocks.md:10 quiet has throws=System.InvalidOperationException, but it did not throw",
            Run(fixture.Compiler, Block("quiet", 10, "int value = 1;\n", throws: "InvalidOperationException")));

    [Fact]
    public void UnmarkedBlockThatThrowsFails() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 loud threw System.InvalidOperationException, but it is not marked throws",
            Run(fixture.Compiler, Block("loud", 10, "throw new InvalidOperationException(\"loud\");\n")));

    [Fact]
    public void CheckFormatsNumbersUnderTheInvariantCulture() =>
        Assert.Null(Run(fixture.Compiler, Block("currency", 10, "string text = 1234.5.ToString(\"C\");\n", check: "text == " + Invariant)));

    [Fact]
    public void ThreadTheContentStartsFormatsUnderTheInvariantCulture() =>
        Assert.Null(Run(fixture.Compiler, Block("worker", 10, "string seen = \"\";\nvar worker = new Thread(() => seen = 1234.5.ToString(\"C\"));\nworker.Start();\nworker.Join();\n", check: "seen == " + Invariant)));

    [Fact]
    public void NamedCultureGivesItsOwnOutput() =>
        Assert.Null(Run(fixture.Compiler, Block("german", 10, "string text = 1234.5.ToString(\"N1\", new System.Globalization.CultureInfo(\"de-DE\"));\n", check: "text == \"1.234,5\"")));

    [Fact]
    public void ExtensionMemberRuns() =>
        Assert.Null(Run(
            fixture.Compiler,
            Block("ext-use", 10, "int doubled = 21.Doubled();\n", group: "ext", check: "doubled == 42"),
            Block("ext-declare", 20, "static class IntExtensions\n{\n    extension(int value)\n    {\n        public int Doubled() => value * 2;\n    }\n}\n", group: "ext")));

    [Fact]
    public void LeftJoinWithResultSelectorRuns() =>
        Assert.Null(Run(fixture.Compiler, Block("left-join", 10, "var joined = System.Linq.Enumerable.LeftJoin(new[] { 1, 2 }, new[] { 2 }, l => l, r => r, (l, r) => l + r).ToList();\n", check: "joined.Count == 2 && joined[1] == 4")));

    [Fact]
    public void ExitBeforeALaterCheckEndsEarly() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 r1-exit ended early",
            Run(
                fixture.Compiler,
                Block("r1-exit", 10, "int value = 1;\nEnvironment.Exit(0);\n", group: "r1"),
                Block("r1-check", 20, "value++;\n", group: "r1", check: "value == 2")));

    [Fact]
    public void ExitWithNoLaterCheckEndsEarly() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 r2-exit ended early",
            Run(fixture.Compiler, Block("r2-exit", 10, "Console.WriteLine(\"leaving\");\nEnvironment.Exit(0);\n")));

    [Fact]
    public void OrdinaryFileRunsEveryGroup()
    {
        var (_, groups) = Fixtures.Assemble("groups");
        const string Syntax = "chapters/groups/syntax.md";

        Assert.Null(Run(Ready(fixture.Compiler, Fixtures.Single(groups, Syntax, "point"))));
        Assert.Null(Run(Ready(fixture.Compiler, Fixtures.Single(groups, Syntax, "loop"))));
    }

    [Fact]
    public void EveryContainerKindRuns()
    {
        var (_, groups) = Fixtures.Assemble("all-containers");

        var ran = groups
            .Select(g => (Group: $"{g.Key.DocumentId} {g.Key.Group}", fixture.Compiler.Compile(g).Ready))
            .Where(g => g.Ready is not null)
            .Select(g => (g.Group, Failure: Run(g.Ready!)))
            .ToList();

        Assert.Equal(groups.Count - 1, ran.Count);
        Assert.Equal([], ran.Where(r => r.Failure is not null).Select(r => $"{r.Group}: {r.Failure}"), StringComparer.Ordinal);
    }
}
