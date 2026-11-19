using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// Groups given as blocks and compiled: language level, reference set, fail blocks, module
// initializers and the throws expectation. Run halves belong to the execution tests.
public sealed class CompileRuleTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    private const string File = "chapters/rules/build.md";

    [Fact]
    public void CollectionExpressionArgumentsStopAtThePreviewGate()
    {
        var program = Assemble(Block("with-args", 10, "System.Collections.Generic.List<int> xs = [with(capacity: 4), 1];\n"));

        AssertFails(
            fixture.Compiler.Compile(program),
            "chapters/rules/build.md:11 with-args error CS8652: The feature 'collection expression arguments' is currently in Preview and *unsupported*. To use Preview features, use the 'preview' language version.");
        Assert.Empty(Control(program, LanguageVersion.Preview));
    }

    [Fact]
    public void ExtensionBlockCompilesAtCSharp14AndNotAtCSharp13()
    {
        var program = Assemble(
            Block("ext-use", 10, "int doubled = 21.Doubled();\n", group: "ext", check: "doubled == 42"),
            Block("ext-declare", 20, "static class IntExtensions\n{\n    extension(int value)\n    {\n        public int Doubled() => value * 2;\n    }\n}\n", group: "ext"));

        AssertReady(fixture.Compiler.Compile(program));
        Assert.Contains("CS9260", Control(program, LanguageVersion.CSharp13), StringComparer.Ordinal);
    }

    [Fact]
    public void LeftJoinWithResultSelectorCompilesAgainstTheReferenceSet()
    {
        var program = Assemble(Block("left-join", 10, "var joined = System.Linq.Enumerable.LeftJoin(new[] { 1, 2 }, new[] { 2 }, l => l, r => r, (l, r) => l + r).ToList();\n", check: "joined.Count == 2 && joined[1] == 4"));

        AssertReady(fixture.Compiler.Compile(program));
    }

    [Fact]
    public void ApiFromALaterRuntimeIsAMissingMember()
    {
        var program = Assemble(Block("pop-count", 10, "var bits = new System.Collections.BitArray(8);\nint count = bits.PopCount();\n"));

        AssertFails(
            fixture.Compiler.Compile(program),
            "chapters/rules/build.md:12 pop-count error CS1061: 'BitArray' does not contain a definition for 'PopCount' and no accessible extension method 'PopCount' accepting a first argument of type 'BitArray' could be found (are you missing a using directive or an assembly reference?)");
    }

    [Fact]
    public void FailBlockThatCompilesFails()
    {
        var program = Assemble(Block("fail-clean", 10, "int value = 1;\nConsole.WriteLine(value);\n", fail: "CS0029"));

        AssertFails(fixture.Compiler.Compile(program), "chapters/rules/build.md:10 fail-clean has fail=CS0029, but it compiles without an error");
    }

    [Fact]
    public void FailBlockWithADifferentErrorFails()
    {
        var program = Assemble(Block("fail-other", 10, "int value = missing;\n", fail: "CS0029"));

        AssertFails(fixture.Compiler.Compile(program), "chapters/rules/build.md:10 fail-other has fail=CS0029, but its errors are CS0103");
    }

    [Fact]
    public void FailBlockWhoseDiagnosticIsOnlyAWarningFails()
    {
        var program = Assemble(Block("fail-warning", 10, "int unused = 5;\n", fail: "CS0219"));

        AssertFails(fixture.Compiler.Compile(program), "chapters/rules/build.md:10 fail-warning has fail=CS0219, but it compiles without an error");
    }

    [Fact]
    public void FailBlockWithASecondDifferentErrorFails()
    {
        var program = Assemble(Block("fail-second", 10, "int value = \"text\";\nint other = missing;\n", fail: "CS0029"));

        AssertFails(fixture.Compiler.Compile(program), "chapters/rules/build.md:10 fail-second has fail=CS0029, but its errors are CS0029, CS0103");
    }

    [Fact]
    public void FailBlockWithExactlyTheNamedErrorPasses()
    {
        var outcome = fixture.Compiler.Compile(Assemble(Block("fail-named", 10, "int value = \"text\";\n", fail: "CS0029")));

        Assert.Empty(outcome.Failures);
        Assert.Null(outcome.Ready);
    }

    [Fact]
    public void FailBlockDeclaringTheHarnessTypeCompilesAloneAndFails()
    {
        var program = Assemble(Block("fail-harness", 10, "System.Console.WriteLine(1);\npartial class SharpLadderHarness { }\n", fail: "CS0260"));

        AssertFails(fixture.Compiler.Compile(program), "chapters/rules/build.md:10 fail-harness has fail=CS0260, but it compiles without an error");
    }

    [Fact]
    public void FailBlockLeftOpenIsJudgedByItsOwnErrors()
    {
        AssertFails(
            fixture.Compiler.Compile(Assemble(Block("fail-open", 10, "int x =\n", fail: "CS0029"))),
            "chapters/rules/build.md:10 fail-open has fail=CS0029, but its errors are CS1002, CS1733");
        AssertFails(
            fixture.Compiler.Compile(Assemble(Block("fail-open", 10, "int x =\n", fail: "CS1002"))),
            "chapters/rules/build.md:10 fail-open has fail=CS1002, but its errors are CS1002, CS1733");
    }

    [Fact]
    public void FailBlockLeftWithAnOpenBracePasses()
    {
        var outcome = fixture.Compiler.Compile(Assemble(Block("fail-brace", 10, "if (true) {\n", fail: "CS1513")));

        Assert.Empty(outcome.Failures);
        Assert.Null(outcome.Ready);
    }

    [Fact]
    public void FailBlockWhoseErrorIsInTheGlobalUsingsFailsAsACollision()
    {
        var program = Assemble(Block("fail-system", 10, "class System\n{\n}\n", fail: "CS0138"));

        AssertFails(fixture.Compiler.Compile(program), "chapters/rules/build.md:11 fail-system declares System in the global namespace, which the checker's generated code uses");
    }

    [Fact]
    public void FailBlockWithACollisionStillReportsItsOwnErrors()
    {
        var source = "class System { }\nclass Broken : MissingType { }\n";
        string[] lines =
        [
            "chapters/rules/build.md:12 fail-mixed error CS0246: The type or namespace name 'MissingType' could not be found (are you missing a using directive or an assembly reference?)",
            "chapters/rules/build.md:11 fail-mixed declares System in the global namespace, which the checker's generated code uses",
        ];

        AssertFails(fixture.Compiler.Compile(Assemble(Block("fail-mixed", 10, source, fail: "CS0138"))), lines);
        AssertFails(fixture.Compiler.Compile(Assemble(Block("fail-mixed", 10, source, fail: "CS0246"))), lines);
    }

    [Fact]
    public void FailBlockCollisionNamesSystemButNotTheAbsentHarness()
    {
        var program = Assemble(Block("fail-roots", 10, "class System { }\nclass SharpLadderHarness { }\n", fail: "CS0138"));

        AssertFails(fixture.Compiler.Compile(program), "chapters/rules/build.md:11 fail-roots declares System in the global namespace, which the checker's generated code uses");
    }

    [Fact]
    public void FailBlockOfTypesAlonePassesWithoutAnEntryPointError()
    {
        var source = "interface IShape\n{\n    double Area();\n}\n\nclass Square : IShape\n{\n}\n";
        var outcome = fixture.Compiler.Compile(Assemble(Block("fail-types", 10, source, fail: "CS0535")));

        Assert.Empty(outcome.Failures);
        Assert.Null(outcome.Ready);
    }

    [Fact]
    public void GeneratorDependentSnippetIsACompileErrorMappedToItsBlock()
    {
        var source = "using System.Text.RegularExpressions;\nConsole.WriteLine(Digits.Number().IsMatch(\"42\"));\nstatic partial class Digits\n{\n    [GeneratedRegex(\"[0-9]+\")]\n    public static partial Regex Number();\n}\n";

        AssertFails(
            fixture.Compiler.Compile(Assemble(Block("generated-regex", 10, source))),
            "chapters/rules/build.md:16 generated-regex error CS8795: Partial method 'Digits.Number()' must have an implementation part because it has accessibility modifiers.");
    }

    [Fact]
    public void ContentModuleInitializerIsRefusedAtItsBlock()
    {
        var source = "using System.Runtime.CompilerServices;\nConsole.WriteLine(\"main\");\nstatic class Early\n{\n    [ModuleInitializer]\n    internal static void Run() => Console.WriteLine(\"early\");\n}\n";

        AssertFails(
            fixture.Compiler.Compile(Assemble(Block("module-init", 10, source))),
            "chapters/rules/build.md:10 module-init applies ModuleInitializerAttribute, which the code check refuses: the checker's start-up must run before any content");
    }

    [Fact]
    public void StaticConstructorOnTheEntryTypeCompilesBehindTheHarnessInitializer()
    {
        var program = Assemble(Block("entry-static", 10, "Console.WriteLine(\"main\");\npartial class Program\n{\n    static Program() => Console.WriteLine(\"static constructor\");\n}\n"));

        var ready = AssertReady(fixture.Compiler.Compile(program));

        using var pe = new PEReader(ready.Image);
        var reader = pe.GetMetadataReader();
        var module = reader.TypeDefinitions.Select(reader.GetTypeDefinition).Single(t => reader.StringComparer.Equals(t.Name, "<Module>"));
        Assert.Contains(module.GetMethods(), m => reader.StringComparer.Equals(reader.GetMethodDefinition(m).Name, System.Reflection.ConstructorInfo.TypeConstructorName));
    }

    [Fact]
    public void ThrowsNamesTheBaseTypeNotTheDerivedOneThrown()
    {
        var ready = AssertReady(fixture.Compiler.Compile(Assemble(Block("derived", 10, "throw new ArgumentNullException(\"name\");\n", throws: "ArgumentException"))));

        Assert.Equal(("derived", "System.ArgumentException", "System.Runtime"), (ready.Throws?.Block.BlockId, ready.Throws?.TypeName, ready.Throws?.Assembly));
    }

    [Fact]
    public void ThrowsResolvesTheSameNamedTypeVisibleAtItsBlock()
    {
        var source = "var stock = new Dictionary<string, int>();\nint n = stock[\"bolt\"];\nclass KeyNotFoundException : Exception\n{\n}\n";

        var ready = AssertReady(fixture.Compiler.Compile(Assemble(Block("same-name", 10, source, throws: "KeyNotFoundException"))));

        Assert.Equal(("same-name", "KeyNotFoundException", "SharpLadderCodeGroup"), (ready.Throws?.Block.BlockId, ready.Throws?.TypeName, ready.Throws?.Assembly));
    }

    [Fact]
    public void CheckThrowsAndReservedNameErrorsNameTheBlockAndLine()
    {
        var outcomes = new[]
        {
            Block("check-type", 10, "int count = 3;\n", check: "count"),
            Block("throws-name", 20, "throw new InvalidOperationException();\n", throws: "NoSuchException"),
            Block("reserved-name", 30, "Console.WriteLine(\"hi\");\nclass SharpLadderHarness\n{\n}\n"),
        }.Select(b => fixture.Compiler.Compile(Assemble(b)));

        Assert.Equal(
            [
                "chapters/rules/build.md:10 check-type error CS0023: Operator '!' cannot be applied to operand of type 'int'",
                "chapters/rules/build.md:20 throws-name error CS0246: The type or namespace name 'NoSuchException' could not be found (are you missing a using directive or an assembly reference?)",
                "chapters/rules/build.md:32 reserved-name declares SharpLadderHarness in the global namespace, which the checker's generated code uses",
            ],
            outcomes.SelectMany(o => o.Failures).Select(f => f.ToString()),
            StringComparer.Ordinal);
    }

    private static SourceBlock Block(string id, int fence, string source, string? group = null, string? check = null, string? throws = null, string? fail = null) =>
        new(File, id, group ?? id, File, fence, fence + 1, null, source, check, throws, fail, "Section", fence);

    private static GroupProgram Assemble(params SourceBlock[] blocks)
    {
        var result = Assembler.Assemble(blocks);
        Assert.Empty(result.Failures);
        return Assert.Single(result.Groups);
    }

    private static void AssertFails(CompileOutcome outcome, params string[] lines)
    {
        Assert.Null(outcome.Ready);
        Assert.Equal(lines, outcome.Failures.Select(f => f.ToString()), StringComparer.Ordinal);
    }

    private static CompiledGroup AssertReady(CompileOutcome outcome)
    {
        Assert.Empty(outcome.Failures);
        return Assert.IsType<CompiledGroup>(outcome.Ready);
    }

    // Test-only controls: the same trees and references at another language version.
    private string[] Control(GroupProgram program, LanguageVersion version) =>
    [
        .. CSharpCompilation.Create("Control", GroupCompiler.Trees(program.Text, new CSharpParseOptions(version)), fixture.References, GroupCompiler.Options)
            .GetDiagnostics()
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .Select(d => d.Id)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal),
    ];
}
