using System.Collections.Immutable;
using System.Globalization;
using Microsoft.CodeAnalysis;

namespace SharpLadder.Policy;

internal static class AnalyzerPolicyGuard
{
    private const string Keyword = "AnalyzerPolicy";
    private const string Delimiter = "# ";

    internal static GuardResult CheckGlobalConfig(string path, string text)
    {
        var problems = new List<string>();
        var set = AnalyzerConfigSet.Create(ImmutableArray.Create(AnalyzerConfig.Parse(text, path)), out var diagnostics);
        foreach (var diagnostic in diagnostics)
        {
            problems.Add(path + ": " + diagnostic.GetMessage(CultureInfo.InvariantCulture));
        }

        var lines = AnalyzerConfigLines.Classify(text);
        var lowered = set.GlobalConfigOptions.TreeOptions
            .Where(o => AnalyzerConfigLines.IsLowered(o.Value))
            .Select(o => lines.LastOrDefault(l => string.Equals(l.RuleId, o.Key, StringComparison.OrdinalIgnoreCase))?.RuleId ?? o.Key)
            .Order(StringComparer.Ordinal)
            .ToList();
        var records = new Dictionary<int, AnalyzerPolicyRecord>();
        foreach (var line in lines)
        {
            var at = path + ":" + line.Number.ToString(CultureInfo.InvariantCulture) + ": ";
            if (line.Kind == ConfigLineKind.Section)
            {
                problems.Add(at + "section header in .globalconfig");
            }
            else if (line.Kind == ConfigLineKind.Bulk)
            {
                problems.Add(at + "bulk severity line");
            }
            else if (ReadRecord(line, at, problems) is { } record)
            {
                records.Add(line.Number - 1, record);
            }
        }

        CheckPlacement(path, lines, records, problems);
        return new GuardResult(problems, lowered);
    }

    internal static IReadOnlyList<string> CheckEditorConfig(string path, string text)
    {
        var problems = new List<string>();
        foreach (var line in AnalyzerConfigLines.Classify(text))
        {
            var at = path + ":" + line.Number.ToString(CultureInfo.InvariantCulture) + ": ";
            if (line.Kind is ConfigLineKind.Severity or ConfigLineKind.Bulk)
            {
                problems.Add(at + "severity line in .editorconfig; severities and records live in .globalconfig");
            }
            else if (line.Text.Contains(Keyword, StringComparison.OrdinalIgnoreCase))
            {
                problems.Add(at + "AnalyzerPolicy record outside .globalconfig");
            }
        }

        return problems;
    }

    private static AnalyzerPolicyRecord? ReadRecord(ConfigLine line, string at, List<string> problems)
    {
        if (!line.Text.Contains(Keyword, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (line.Kind != ConfigLineKind.Comment || !line.Text.StartsWith(Delimiter, StringComparison.Ordinal))
        {
            problems.Add(at + "malformed record: must be its own comment line starting \"# \"");
            return null;
        }

        if (!AnalyzerPolicyRecord.TryParse(line.Text[Delimiter.Length..], out var record, out var problem))
        {
            problems.Add(at + "malformed record: " + problem);
            return null;
        }

        return record;
    }

    private static void CheckPlacement(
        string path,
        IReadOnlyList<ConfigLine> lines,
        Dictionary<int, AnalyzerPolicyRecord> records,
        List<string> problems)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var ruleIds = lines.Where(l => l.RuleId is not null).Select(l => l.RuleId!).ToHashSet(StringComparer.Ordinal);
        foreach (var (index, record) in records.OrderBy(r => r.Key))
        {
            var at = path + ":" + (index + 1).ToString(CultureInfo.InvariantCulture) + ": ";
            var below = index + 1 < lines.Count ? lines[index + 1] : null;
            if (!seen.Add(record.Id))
            {
                problems.Add(at + "duplicate record for " + record.Id);
            }

            var severityBelow = below?.Kind == ConfigLineKind.Severity;
            if (severityBelow && string.Equals(below!.RuleId, record.Id, StringComparison.Ordinal))
            {
                if (!below.IsLowered)
                {
                    problems.Add(at + "stale record: " + record.Id + " is at warning or error");
                }
            }
            else if (severityBelow && string.Equals(below!.RuleId, record.Id, StringComparison.OrdinalIgnoreCase))
            {
                problems.Add(at + "record ID " + record.Id + " differs in case from rule " + below.RuleId);
            }
            else if (!ruleIds.Contains(record.Id))
            {
                problems.Add(at + "orphan record: no severity line for " + record.Id);
            }
            else
            {
                problems.Add(at + (severityBelow
                    ? "record " + record.Id + " sits above the severity line of " + below!.RuleId
                    : "misplaced record: " + record.Id + " is not directly above its severity line"));
            }
        }

        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            if (line.IsLowered
                && (!records.TryGetValue(i - 1, out var above) || !string.Equals(above.Id, line.RuleId, StringComparison.Ordinal)))
            {
                problems.Add(path + ":" + line.Number.ToString(CultureInfo.InvariantCulture) + ": lowered rule "
                    + line.RuleId + " has no AnalyzerPolicy record directly above");
            }
        }
    }
}
