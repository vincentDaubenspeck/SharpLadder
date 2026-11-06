using Microsoft.CodeAnalysis;
using Xunit;

namespace SharpLadder.Policy.Tests;

public sealed class AnalyzerConfigLinesTests
{
    [Theory]
    [InlineData("[*.cs]", "Section")]
    [InlineData("[*]", "Section")]
    [InlineData("[/abs/path.cs]", "Section")]
    [InlineData("[*.cs]   ", "Section")]
    [InlineData("dotnet_diagnostic.SA1101.severity=none", "Severity")]
    [InlineData("DOTNET_DIAGNOSTIC.SA1101.SEVERITY = none", "Severity")]
    [InlineData("dotnet_diagnostic.SA1101.severity : none", "Severity")]
    [InlineData("dotnet_analyzer_diagnostic.category-Style.severity = none", "Bulk")]
    [InlineData("dotnet_analyzer_diagnostic.severity = none", "Bulk")]
    [InlineData("# AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: d", "Comment")]
    [InlineData("; a comment", "Comment")]
    [InlineData("", "Comment")]
    [InlineData("indent_size = 4", "Other")]
    public void RoslynDecidesTheKindOfEachLine(string line, string kind)
    {
        Assert.Equal(kind, AnalyzerConfigLines.ClassifyLine(1, line).Kind.ToString());
    }

    [Fact]
    public void SeverityLineInsideANamedSectionIsStillASeverityLine()
    {
        var lines = AnalyzerConfigLines.Classify("[*.cs]\ndotnet_diagnostic.SA1101.severity = none\n");

        Assert.Equal(ConfigLineKind.Section, lines[0].Kind);
        Assert.Equal(ConfigLineKind.Severity, lines[1].Kind);
        Assert.Equal("SA1101", lines[1].RuleId);
        Assert.Equal(ReportDiagnostic.Suppress, lines[1].Severity);
    }

    [Theory]
    [InlineData("none", true)]
    [InlineData("silent", true)]
    [InlineData("suggestion", true)]
    [InlineData("default", true)]
    [InlineData("warning", false)]
    [InlineData("error", false)]
    public void LoweredMeansBelowWarning(string severity, bool lowered)
    {
        Assert.Equal(lowered, AnalyzerConfigLines.ClassifyLine(1, "dotnet_diagnostic.SA1101.severity = " + severity).IsLowered);
    }
}
