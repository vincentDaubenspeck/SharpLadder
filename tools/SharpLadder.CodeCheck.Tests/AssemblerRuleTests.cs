using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The assembler called directly, with blocks the content compiler would not hand it or that only
// grouping can find wrong.
public sealed class AssemblerRuleTests
{
    private const string File = "chapters/rules/build.md";

    [Fact]
    public void MixedOwnershipIsRefusedBeforeAssembly()
    {
        // The #line block would be refused by assembly; its absence shows nothing was assembled.
        var result = Assembler.Assemble(
        [
            Block("mixed-a1", "mixed-a", 10, "var a = 1;", approach: "loop"),
            Block("fine-1", "fine", 14, "var f = 1;"),
            Block("mixed-a2", "mixed-a", 18, "var b = 2;"),
            Block("mixed-b1", "mixed-b", 22, "var c = 3;"),
            Block("mixed-b2", "mixed-b", 26, "var d = 4;", approach: "sum"),
            Block("line-1", "line", 30, "#line 1 \"x.cs\"\nvar e = 5;"),
        ]);

        AssertRefused(
            result,
            "chapters/rules/build.md:10 mixed-a1 group \"mixed-a\" mixes owners; this block belongs to approach \"loop\"",
            "chapters/rules/build.md:18 mixed-a2 group \"mixed-a\" mixes owners; this block belongs to no approach",
            "chapters/rules/build.md:22 mixed-b1 group \"mixed-b\" mixes owners; this block belongs to no approach",
            "chapters/rules/build.md:26 mixed-b2 group \"mixed-b\" mixes owners; this block belongs to approach \"sum\"");
    }

    [Fact]
    public void ThrowsBlockThatIsNotLastIsRefused()
    {
        var result = Assembler.Assemble(
        [
            Block("throws-1", "throws", 10, "int[] none = [];\nvar first = none[0];", throws: "IndexOutOfRangeException"),
            Block("throws-2", "throws", 15, "var after = 1;"),
        ]);

        AssertRefused(result, "chapters/rules/build.md:10 throws-1 has throws but is not the last block of its group \"throws\"");
    }

    [Fact]
    public void TypeDeclarationBlockBeforeStatementBlockIsRefused()
    {
        var result = Assembler.Assemble(
        [
            Block("types-1", "types", 10, "record Point(int X, int Y);"),
            Block("types-2", "types", 14, "var p = new Point(1, 2);"),
        ]);

        AssertRefused(
            result,
            "chapters/rules/build.md:10 types-1 declares a type, but a later block of its group \"types\" holds statements or a check; type declarations go in the final blocks");
    }

    [Fact]
    public void CheckOnTypeDeclarationBlockIsRefusedMixedBlockIncluded()
    {
        var result = Assembler.Assemble(
        [
            Block("only-type", "only-type", 10, "record Point(int X, int Y);", check: "true"),
            Block("mixed-1", "mixed", 14, "var p = new Point(1, 2);\nrecord Point(int X, int Y);", check: "p.X == 1"),
        ]);

        AssertRefused(
            result,
            "chapters/rules/build.md:10 only-type declares a type and has a check; a block that declares a type carries no check",
            "chapters/rules/build.md:14 mixed-1 declares a type and has a check; a block that declares a type carries no check");
    }

    [Fact]
    public void FailGroupOfMoreThanOneBlockIsRefused()
    {
        var result = Assembler.Assemble(
        [
            Block("fail-1", "fail", 10, "int value;\nvar shown = value;", fail: "CS0165"),
            Block("fail-2", "fail", 15, "var other = 1;"),
        ]);

        AssertRefused(result, "chapters/rules/build.md:10 fail-1 has fail but its group \"fail\" holds other blocks; a fail block is a group of its own");
    }

    [Fact]
    public void BlockHoldingLineDirectiveIsRefused()
    {
        // The same text inside a verbatim string is no directive, so it is not refused.
        var result = Assembler.Assemble(
        [
            Block("line-1", "line", 10, "var a = 1;"),
            Block("line-2", "line", 14, "#line 200 \"elsewhere.cs\"\nvar b = 2;"),
            Block("text-1", "text", 20, "var s = @\"\n#line 200 \"\"elsewhere.cs\"\"\n\";"),
        ]);

        AssertRefused(result, "chapters/rules/build.md:14 line-2 holds a #line directive; a block cannot move the mapping of its own lines");
    }

    [Fact]
    public void BlocksThatWouldBreakTheProgramShapeAreRefused()
    {
        // open-2 lies inside open-1's comment, so only open-1 is named.
        var result = Assembler.Assemble(
        [
            Block("open-1", "open", 10, "var a = 1;\n/* never closed"),
            Block("open-2", "open", 14, "var b = 2;"),
            Block("check-1", "check", 20, "var a = true;", check: "a) || (true"),
            Block("throws-1", "throws", 30, "throw new Exception();", throws: "Exception) + (1"),
        ]);

        AssertRefused(
            result,
            "chapters/rules/build.md:10 open-1 runs past its own end (an open statement, brace, comment, string or #if); a block must be complete code",
            "chapters/rules/build.md:20 check-1 has a check that is not one C# expression",
            "chapters/rules/build.md:30 throws-1 has a throws value that is not one type name");
    }

    private static SourceBlock Block(string id, string group, int fence, string source, string? approach = null, string? check = null, string? throws = null, string? fail = null) =>
        new(File, id, group, File, fence, fence + 1, approach, source, check, throws, fail, "Section", fence);

    private static void AssertRefused(AssemblyResult result, params string[] lines)
    {
        Assert.Empty(result.Groups);
        Assert.Equal(lines, result.Failures.Select(f => f.ToString()), StringComparer.Ordinal);
    }
}
