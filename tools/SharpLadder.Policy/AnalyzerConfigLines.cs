using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Text;

namespace SharpLadder.Policy;

// Roslyn keeps no trace of comments and hides its sections, so each line is classified by
// what Roslyn makes of it when parsed alone in a global section.
internal static class AnalyzerConfigLines
{
    private const string GlobalHeader = "is_global = true\n";
    private const string ProbeKey = "sharpladder_probe";
    private const string BulkPrefix = "dotnet_analyzer_diagnostic.";
    private const string RulePrefix = "dotnet_diagnostic.";

    private static readonly string ProbePath = Path.Combine(Path.GetTempPath(), ".globalconfig");
    private static readonly int BaselineKeys = Options(GlobalHeader).AnalyzerOptions.Count;

    internal static bool IsLowered(ReportDiagnostic severity) =>
        severity is not (ReportDiagnostic.Warn or ReportDiagnostic.Error);

    internal static IReadOnlyList<ConfigLine> Classify(string text)
    {
        var lines = SourceText.From(text).Lines;
        var result = new List<ConfigLine>(lines.Count);
        foreach (var line in lines)
        {
            result.Add(ClassifyLine(line.LineNumber + 1, line.ToString()));
        }

        return result;
    }

    internal static ConfigLine ClassifyLine(int number, string text)
    {
        var options = Options(GlobalHeader + text);
        if (options.TreeOptions.Count == 1)
        {
            var (id, severity) = options.TreeOptions.First();
            return new ConfigLine(number, text, ConfigLineKind.Severity, AsWritten(text, id), severity);
        }

        var kind = ConfigLineKind.Other;
        if (options.AnalyzerOptions.Keys.Any(k => k.StartsWith(BulkPrefix, StringComparison.OrdinalIgnoreCase)))
        {
            kind = ConfigLineKind.Bulk;
        }
        else if (!Options(GlobalHeader + text + "\n" + ProbeKey + " = 1").AnalyzerOptions.ContainsKey(ProbeKey))
        {
            kind = ConfigLineKind.Section;
        }
        else if (options.TreeOptions.Count == 0 && options.AnalyzerOptions.Count == BaselineKeys)
        {
            kind = ConfigLineKind.Comment;
        }

        return new ConfigLine(number, text, kind, null, ReportDiagnostic.Default);
    }

    internal static AnalyzerConfigOptionsResult Options(string text) =>
        AnalyzerConfigSet.Create(ImmutableArray.Create(AnalyzerConfig.Parse(text, ProbePath)), out _)
            .GlobalConfigOptions;

    // Roslyn lower-cases every key, so the ID is taken as the line spells it for ordinal matching.
    private static string AsWritten(string text, string id)
    {
        var at = text.IndexOf(RulePrefix + id + ".", StringComparison.OrdinalIgnoreCase);
        return at < 0 ? id : text.Substring(at + RulePrefix.Length, id.Length);
    }
}
