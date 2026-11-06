using Xunit;

namespace SharpLadder.Policy.Tests;

public sealed class AnalyzerPolicyRecordTests
{
    private const string Valid = "AnalyzerPolicy SA1101: the reason | Scope: all projects | Guard: G | Decision: off";

    [Fact]
    public void ValidRecordYieldsEveryField()
    {
        Assert.True(AnalyzerPolicyRecord.TryParse(Valid, out var record, out var problem), problem);
        Assert.Equal(new AnalyzerPolicyRecord("SA1101", "the reason", "all projects", "G", "off"), record);
    }

    [Theory]
    [InlineData("AnalyzerPolicy SA1101: | Scope: s | Guard: g | Decision: d", "ID must be followed by \": \"")]
    [InlineData("AnalyzerPolicy SA1101:  | Scope: s | Guard: g | Decision: d", "Reason is empty")]
    [InlineData("AnalyzerPolicy SA1101 | Scope: s | Guard: g | Decision: d", "ID must be letters and digits")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope:  | Guard: g | Decision: d", "Scope is empty")]
    [InlineData("AnalyzerPolicy SA1101: r | Guard: g | Decision: d", "record needs Scope, Guard and Decision fields")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard:  | Decision: d", "Guard is empty")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Decision: d", "record needs Scope, Guard and Decision fields")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: ", "Decision is empty")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: g", "record needs Scope, Guard and Decision fields")]
    [InlineData("AnalyzerPolicy SA1101: r | Guard: g | Scope: s | Decision: d", "expected \" | Scope: \" in this position")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: d | Note: n", "record has an extra field")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: d and more |", "record has an extra field")]
    [InlineData("AnalyzerPolicy SA1101: a | b | Scope: s | Guard: g | Decision: d", "record has an extra field")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: a | b | Guard: g | Decision: d", "record has an extra field")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: a | b | Decision: d", "record has an extra field")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: a | b", "record has an extra field")]
    [InlineData("AnalyzerPolicy SA1101: r  | Scope: s | Guard: g | Decision: d", "Reason has a leading or trailing space")]
    [InlineData("AnalyzerPolicy SA1101: r |  Scope: s | Guard: g | Decision: d", "expected \" | Scope: \" in this position")]
    [InlineData("AnalyzerPolicy SA1101: r\t| Scope: s | Guard: g | Decision: d", "Reason must be followed by \" | \"")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s\t| Guard: g | Decision: d", "Scope must be followed by \" | \"")]
    [InlineData("AnalyzerPolicy SA1101:  r | Scope: s | Guard: g | Decision: d", "Reason has a leading or trailing space")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope:  s | Guard: g | Decision: d", "Scope has a leading or trailing space")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: d ", "Decision has a leading or trailing space")]
    [InlineData("AnalyzerPolicy SA.1101: r | Scope: s | Guard: g | Decision: d", "ID must be letters and digits")]
    [InlineData("AnalyzerPolicy SA-1101: r | Scope: s | Guard: g | Decision: d", "ID must be letters and digits")]
    [InlineData("AnalyzerPolicySA1101: r | Scope: s | Guard: g | Decision: d", "record must start with \"AnalyzerPolicy \"")]
    [InlineData("analyzerpolicy SA1101: r | Scope: s | Guard: g | Decision: d", "record must start with \"AnalyzerPolicy \"")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: from 2026-01-31 | Decision: d", "Guard contains a date")]
    [InlineData("AnalyzerPolicy SA1101: until 2026-01-31 | Scope: s | Guard: g | Decision: d", "Reason contains a date")]
    [InlineData("AnalyzerPolicy SA1101: r | Scope: s | Guard: g | Decision: off\r", "Decision contains a line break")]
    public void MalformedRecordFailsWithItsProblem(string text, string expected)
    {
        Assert.False(AnalyzerPolicyRecord.TryParse(text, out _, out var problem));
        Assert.StartsWith(expected, problem, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("sa1101")]
    [InlineData("SA1200")]
    public void RecordIdIsTakenAsWritten(string id)
    {
        Assert.True(AnalyzerPolicyRecord.TryParse(Valid.Replace("SA1101", id, StringComparison.Ordinal), out var record, out _));
        Assert.Equal(id, record.Id);
        Assert.NotEqual("SA1101", record.Id, StringComparer.Ordinal);
    }
}
