using Microsoft.CodeAnalysis;

namespace SharpLadder.Policy;

internal sealed record ConfigLine(int Number, string Text, ConfigLineKind Kind, string? RuleId, ReportDiagnostic Severity)
{
    internal bool IsLowered => Kind == ConfigLineKind.Severity && AnalyzerConfigLines.IsLowered(Severity);
}
