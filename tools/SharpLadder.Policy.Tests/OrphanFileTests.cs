using Xunit;

namespace SharpLadder.Policy.Tests;

public sealed class OrphanFileTests
{
    private const string Pragma = "#pragma warning";
    private const string Record = "// AnalyzerPolicy CA1822: the reason | Scope: s | Guard: g | Decision: d";

    private static readonly string[] Admitted = ["content/practice/", "tools/Fx.Tests/fixtures/"];

    [Fact]
    public void AdmittedFileWithReasonedPragmaPasses()
    {
        Assert.Empty(Check("tools/Fx.Tests/fixtures/practice/sample.tests.cs", Source(string.Empty, string.Empty)));
    }

    [Fact]
    public void AdmittedFileWithAliasedSuppressionAttributeFails()
    {
        var problems = Check(
            "content/practice/sample.tests.cs",
            Source("using Quiet = System.Diagnostics.CodeAnalysis.SuppressMessageAttribute;\n\n", "    [Quiet(\"Performance\", \"CA1822\")]\n"));

        Assert.Equal(
            ["content/practice/sample.tests.cs:8: attribute Quiet in a file no project compiles; the check cannot tell what it suppresses"],
            problems);
    }

    [Fact]
    public void FileOutsideTheAdmittedFoldersIsInNoProject()
    {
        var problems = Check("src/practice/fixtures/sample.tests.cs", Source(string.Empty, string.Empty));

        Assert.Equal(["src/practice/fixtures/sample.tests.cs: in no project of S.sln; the check cannot read it"], problems);
    }

    private static string Source(string usings, string attribute) =>
        usings + "namespace Fixture;\n\ninternal static class Sample\n{\n"
        + Pragma + " disable CA1822 " + Record + "\n"
        + attribute + "    private static int Value() => 1;\n"
        + Pragma + " restore CA1822\n}\n";

    private static List<string> Check(string file, string text)
    {
        var root = Directory.CreateTempSubdirectory("sharpladder-orphans-");
        try
        {
            var path = Path.Combine(root.FullName, file);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, text);
            var problems = new List<string>();
            SuppressionCheck.Orphans(root.FullName, [file], Admitted, "S.sln", problems);
            return problems;
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }
}
