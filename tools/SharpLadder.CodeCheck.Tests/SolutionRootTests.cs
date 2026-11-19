using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The reference root through its entry point, one case per refusal cause. A ToolProblem is what the
// command reports with exit 2; a failure line is a content failure, exit 1.
public sealed class SolutionRootTests
{
    private const string Subject = "prob-9001";
    private const string ReferenceName = "prob-9001.reference.cs";
    private const string WrongName = "prob-9001.empty-input.wrong.cs";
    private const string ReferenceText = "// reference: prob-9001\nnamespace Fixture;\n";
    private const string WrongText = "// wrong: prob-9001 empty-input\nnamespace Fixture;\n";
    private const string Kinds = "off-by-one, empty-input, single-element, duplicates, negatives, overflow, order";

    [Fact]
    public void EachSubjectsSolutionsAreRead()
    {
        using var parent = Solved();

        var set = Read(parent, Subject);

        Assert.Empty(set.Failures);
        Assert.Equal(new SolutionFile(Subject, null, "reference/" + ReferenceName, ReferenceText), set.Reference(Subject));
        Assert.Equal([new SolutionFile(Subject, "empty-input", "reference/" + WrongName, WrongText)], set.Wrong(Subject));
    }

    [Fact]
    public void AbsentRootWithNoSubjectsPasses()
    {
        using var parent = new TempFolder();

        var set = Read(parent);

        Assert.Equal((0, 0), (set.Failures.Count, set.Files.Count));
    }

    [Fact]
    public void AbsentRootFailsEverySubject()
    {
        using var parent = new TempFolder();

        Assert.Equal(
            [
                "reference: drill-fix-largest: reference file missing (drill-fix-largest.reference.cs)",
                "reference: prob-9001: reference file missing (prob-9001.reference.cs)",
            ],
            Lines(Read(parent, Subject, "drill-fix-largest")));
    }

    [Theory]
    [InlineData("extra/", null, "reference/extra: a subfolder is not accepted; the reference root is flat")]
    [InlineData("notes.txt", "text\n", "reference/notes.txt: not a solution file; name it <id>.reference.cs or <id>.<kind>.wrong.cs")]
    [InlineData("PROB-9001.off-by-one.wrong.cs", "// wrong: prob-9001 off-by-one\n", "reference/PROB-9001.off-by-one.wrong.cs: differs from prob-9001.off-by-one.wrong.cs only in case")]
    [InlineData("prob-9002.reference.cs", "// reference: prob-9002\n", "reference/prob-9002.reference.cs: names no problem or drill of the content (prob-9002); a solution belongs to exactly one")]
    [InlineData("prob-9001.typo.wrong.cs", "// wrong: prob-9001 typo\n", "reference/prob-9001.typo.wrong.cs: wrong-solution kind typo is not one of " + Kinds)]
    [InlineData(ReferenceName, "// reference: prob-9002\n", "reference/prob-9001.reference.cs:1: the first line must be exactly \"// reference: prob-9001\"")]
    [InlineData(WrongName, "// wrong: prob-9001 off-by-one\n", "reference/prob-9001.empty-input.wrong.cs:1: the first line must be exactly \"// wrong: prob-9001 empty-input\"")]
    [InlineData(ReferenceName, "// reference: prob-9001\r\n", "reference/prob-9001.reference.cs:1: file holds a carriage return (CR); save it with LF line endings")]
    [InlineData(WrongName, null, "reference: prob-9001: no wrong solution; add at least one prob-9001.<kind>.wrong.cs")]
    [InlineData(ReferenceName, null, "reference: prob-9001: reference file missing (prob-9001.reference.cs)")]
    public void ContentRuleFails(string name, string? text, string expected)
    {
        using var parent = Solved();
        var root = Path.Combine(parent.Path, "reference");
        if (name.EndsWith('/'))
        {
            Directory.CreateDirectory(Path.Combine(root, name.TrimEnd('/')));
        }
        else if (text is null)
        {
            File.Delete(Path.Combine(root, name));
        }
        else
        {
            File.WriteAllText(Path.Combine(root, name), text);
        }

        Assert.Equal([expected], Lines(Read(parent, Subject)));
    }

    // A junction on Windows, which is a reparse point; a symbolic link on Linux.
    [Fact]
    public void LinkAtTheRootIsRefused()
    {
        using var parent = new TempFolder();
        var target = Path.Combine(parent.Path, "real");
        Directory.CreateDirectory(target);
        File.WriteAllText(Path.Combine(target, ReferenceName), ReferenceText);
        File.WriteAllText(Path.Combine(target, WrongName), WrongText);
        using var link = new FolderLink(Path.Combine(parent.Path, "reference"), target);

        Assert.Equal("reference: links and reparse points are not accepted at or below a root folder", Assert.Throws<ToolProblem>(() => Read(parent, Subject)).Message);
    }

    [Fact]
    public void DanglingLinkAtTheRootIsRefusedNotAbsent()
    {
        using var parent = new TempFolder();
        using var link = new FolderLink(Path.Combine(parent.Path, "reference"), Path.Combine(parent.Path, "gone"));

        Assert.Equal("reference: links and reparse points are not accepted at or below a root folder", Assert.Throws<ToolProblem>(() => Read(parent)).Message);
    }

    [Fact]
    public void FileAtTheRootIsRefused()
    {
        using var parent = new TempFolder();
        parent.Write("reference", string.Empty);

        Assert.Equal("reference: not a folder", Assert.Throws<ToolProblem>(() => Read(parent)).Message);
    }

    [Fact]
    public void CaseVariantAtTheRootIsRefusedNotAbsent()
    {
        using var parent = new TempFolder();
        Directory.CreateDirectory(Path.Combine(parent.Path, "Reference"));

        Assert.Equal("reference: the folder above it holds Reference, which differs from reference only in case", Assert.Throws<ToolProblem>(() => Read(parent)).Message);
    }

    [Fact]
    public void ListingFaultIsRefusedNotAbsent()
    {
        using var parent = new TempFolder();

        var problem = Assert.Throws<ToolProblem>(() => SolutionRoot.Read(Path.Combine(parent.Path, "missing", "reference"), "reference", []));

        Assert.Equal("reference: the folder above it could not be listed (DirectoryNotFoundException)", problem.Message);
    }

    private static TempFolder Solved()
    {
        var parent = new TempFolder();
        parent.Write(Path.Combine("reference", ReferenceName), ReferenceText);
        parent.Write(Path.Combine("reference", WrongName), WrongText);
        return parent;
    }

    private static SolutionSet Read(TempFolder parent, params string[] subjects) =>
        SolutionRoot.Read(Path.Combine(parent.Path, "reference"), "reference", subjects);

    private static string[] Lines(SolutionSet set) => [.. set.Failures];
}
