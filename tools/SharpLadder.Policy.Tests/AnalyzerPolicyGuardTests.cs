using Xunit;

namespace SharpLadder.Policy.Tests;

// The .globalconfig records name this class in their Guard field; keep the name stable.
public sealed class AnalyzerPolicyGuardTests
{
    private const string Path = "fixture.globalconfig";
    private const string Record = "# AnalyzerPolicy SA1101: reason | Scope: all projects | Guard: G | Decision: off";
    private const string Off = "dotnet_diagnostic.SA1101.severity = none";

    [Fact]
    public void RepositoryGlobalConfigPassesWithExactlyTheRecordedRules()
    {
        var path = System.IO.Path.Combine(RepositoryRoot(), ".globalconfig");

        var result = AnalyzerPolicyGuard.CheckGlobalConfig(path, File.ReadAllText(path));

        Assert.True(result.Problems.Count == 0, string.Join(Environment.NewLine, result.Problems));
        string[] expected = ["AsyncFixer01", "CS1573", "CS1591", "SA1101", "SA1200", "SA1309", "SA1600", "SA1633"];
        Assert.Equal(expected, result.LoweredRules);
    }

    [Fact]
    public void EveryTrackedEditorConfigHasNoSeverityLines()
    {
        var root = RepositoryRoot();
        var files = GitFiles.List(root, "*.editorconfig", ".editorconfig");

        Assert.NotNull(files);
        var editorConfigs = files.Where(f => string.Equals(System.IO.Path.GetFileName(f), ".editorconfig", StringComparison.Ordinal)).ToList();
        Assert.NotEmpty(editorConfigs);
        foreach (var file in editorConfigs)
        {
            Assert.Empty(AnalyzerPolicyGuard.CheckEditorConfig(file, File.ReadAllText(System.IO.Path.Combine(root, file))));
        }
    }

    [Theory]
    [InlineData("\n")]
    [InlineData("\r\n")]
    public void RecordDirectlyAboveItsLoweredRulePasses(string newline)
    {
        var result = Check(newline, Record, Off);

        Assert.Empty(result.Problems);
        Assert.Equal(["SA1101"], result.LoweredRules);
    }

    [Theory]
    [InlineData("lowered rule SA1101 has no AnalyzerPolicy record directly above", Off)]
    [InlineData("stale record: SA1101 is at warning or error", Record, "dotnet_diagnostic.SA1101.severity = warning")]
    [InlineData("duplicate record for SA1101", Record, Record, Off)]
    [InlineData("orphan record: no severity line for SA1101", Record, "dotnet_diagnostic.SA1200.severity = warning")]
    [InlineData("misplaced record: SA1101 is not directly above its severity line", Record, "", Off)]
    [InlineData("misplaced record: SA1101 is not directly above its severity line", Record, "# Other comment.", Off)]
    [InlineData("record SA1101 sits above the severity line of SA1200", Record, "dotnet_diagnostic.SA1200.severity = warning", Off)]
    [InlineData("record ID sa1101 differs in case from rule SA1101", "# AnalyzerPolicy sa1101: r | Scope: s | Guard: g | Decision: d", Off)]
    [InlineData("malformed record: record must start with", "# analyzerpolicy SA1101: r | Scope: s | Guard: g | Decision: d", Off)]
    [InlineData("malformed record: must be its own comment line", "; AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: d", Off)]
    [InlineData("malformed record: Decision contains a date", "# AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: 2026-01-01", Off)]
    [InlineData("section header in .globalconfig", "[*.cs]")]
    [InlineData("bulk severity line", "dotnet_analyzer_diagnostic.category-Style.severity = none")]
    public void GlobalConfigFaultFails(string expected, params string[] lines)
    {
        var problems = Check("\n", lines).Problems;

        Assert.True(problems.Any(p => p.Contains(expected, StringComparison.Ordinal)), string.Join(Environment.NewLine, problems));
    }

    [Theory]
    [InlineData("[*.cs]", Off)]
    [InlineData("[*]", "dotnet_analyzer_diagnostic.category-Style.severity = none")]
    [InlineData(Record)]
    public void EditorConfigWithSeverityOrRecordFails(params string[] lines)
    {
        var problems = AnalyzerPolicyGuard.CheckEditorConfig(".editorconfig", "root = true\n" + string.Join('\n', lines) + "\n");

        Assert.NotEmpty(problems);
    }

    private static GuardResult Check(string newline, params string[] lines) =>
        AnalyzerPolicyGuard.CheckGlobalConfig(
            System.IO.Path.Combine(System.IO.Path.GetTempPath(), Path),
            "is_global = true" + newline + newline + string.Join(newline, lines) + newline);

    private static string RepositoryRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(System.IO.Path.Combine(dir.FullName, "SharpLadder.sln")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("SharpLadder.sln not found above the test output.");
    }
}
