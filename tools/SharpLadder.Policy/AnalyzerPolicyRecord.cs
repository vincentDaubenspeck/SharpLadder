using System.Diagnostics.CodeAnalysis;

namespace SharpLadder.Policy;

// The one hand-written reader: the record grammar is project policy that no parser knows.
internal sealed record AnalyzerPolicyRecord(string Id, string Reason, string Scope, string Guard, string Decision)
{
    private const string Keyword = "AnalyzerPolicy ";

    internal static bool TryParse(
        string text,
        [NotNullWhen(true)] out AnalyzerPolicyRecord? record,
        out string problem)
    {
        record = null;
        var parts = text.Split('|');
        if (parts.Length != 4)
        {
            problem = parts.Length < 4
                ? "record needs Scope, Guard and Decision fields"
                : "record has an extra field or a | inside a field";
            return false;
        }

        if (!TryHead(parts[0], out var id, out var reason, out problem)
            || !TryField(parts[1], "Scope", last: false, out var scope, out problem)
            || !TryField(parts[2], "Guard", last: false, out var guard, out problem)
            || !TryField(parts[3], "Decision", last: true, out var decision, out problem))
        {
            return false;
        }

        record = new AnalyzerPolicyRecord(id, reason, scope, guard, decision);
        return true;
    }

    private static bool TryHead(string part, out string id, out string reason, out string problem)
    {
        id = string.Empty;
        reason = string.Empty;
        if (!part.StartsWith(Keyword, StringComparison.Ordinal))
        {
            problem = "record must start with \"AnalyzerPolicy \"";
            return false;
        }

        if (!part.EndsWith(' '))
        {
            problem = "Reason must be followed by \" | \"";
            return false;
        }

        var rest = part[Keyword.Length..^1];
        var colon = rest.IndexOf(':', StringComparison.Ordinal);
        if (colon < 1 || !rest[..colon].All(char.IsAsciiLetterOrDigit))
        {
            problem = "ID must be letters and digits followed by \":\"";
            return false;
        }

        id = rest[..colon];
        if (!rest[(colon + 1)..].StartsWith(' '))
        {
            problem = "ID must be followed by \": \"";
            return false;
        }

        reason = rest[(colon + 2)..];
        problem = FieldProblem("Reason", reason);
        return problem.Length == 0;
    }

    private static bool TryField(string part, string name, bool last, out string value, out string problem)
    {
        value = string.Empty;
        var label = " " + name + ": ";
        if (!part.StartsWith(label, StringComparison.Ordinal))
        {
            problem = "expected \" | " + name + ": \" in this position";
            return false;
        }

        if (!last && !part.EndsWith(' '))
        {
            problem = name + " must be followed by \" | \"";
            return false;
        }

        value = last ? part[label.Length..] : part[label.Length..^1];
        problem = FieldProblem(name, value);
        return problem.Length == 0;
    }

    private static string FieldProblem(string name, string value)
    {
        if (value.Length == 0)
        {
            return name + " is empty";
        }

        if (value[0] == ' ' || value[^1] == ' ')
        {
            return name + " has a leading or trailing space";
        }

        if (value.Contains('\r', StringComparison.Ordinal) || value.Contains('\n', StringComparison.Ordinal))
        {
            return name + " contains a line break";
        }

        return HasIsoDate(value) ? name + " contains a date" : string.Empty;
    }

    private static bool HasIsoDate(string value)
    {
        const string Shape = "dddd-dd-dd";
        for (var start = 0; start + Shape.Length <= value.Length; start++)
        {
            var match = true;
            for (var i = 0; i < Shape.Length && match; i++)
            {
                var c = value[start + i];
                match = Shape[i] == 'd' ? char.IsAsciiDigit(c) : c == '-';
            }

            if (match)
            {
                return true;
            }
        }

        return false;
    }
}
