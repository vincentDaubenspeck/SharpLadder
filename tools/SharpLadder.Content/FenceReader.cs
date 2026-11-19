using System.Text;
using Markdig.Syntax;

namespace SharpLadder.Content;

// Turns a code fence into a code or text block. The info string is the language and at most one
// {...} group; csharp and text blocks are stored as data and not compiled here.
internal static class FenceReader
{
    public const string StarterSuffix = "-starter";

    private const string StarterFlag = "starter";
    private static readonly string[] Known = ["group", "spoken", "label", "check", "throws", "fail", StarterFlag];
    private static readonly string[] Outcomes = ["check", "throws", "fail"];
    private static readonly string[] CsharpOnly = ["check", "fail", "group", "throws"];
    private static readonly string[] NotOnStarter = ["group", "check", "throws", "fail", "label"];

    public static BodyBlock? Read(FencedCodeBlock fence, string openingLine, string blockId, int line, Action<int, string> error)
    {
        var language = fence.Info ?? string.Empty;
        if (language is not ("csharp" or "text"))
        {
            error(line, $"code fence language must be csharp or text, not \"{language}\"");
            return null;
        }

        var csharp = language is "csharp";
        if (!Group(fence, openingLine, language, line, error, out var group))
        {
            return null;
        }

        var problems = new List<string>();
        var values = Values(group, problems);
        var id = group?.Attributes.Id;
        problems.AddRange(Rules(csharp, id, values));
        foreach (var problem in problems)
        {
            error(line, problem);
        }

        if (problems.Count > 0)
        {
            return null;
        }

        var source = Source(fence);
        var label = values.GetValueOrDefault("label");
        var spoken = values["spoken"];
        return csharp
            ? new CodeNode
            {
                BlockId = blockId,
                Id = id!,
                Group = values["group"],
                Label = label,
                Spoken = spoken,
                Check = values.GetValueOrDefault("check"),
                Throws = values.GetValueOrDefault("throws"),
                Fail = values.GetValueOrDefault("fail"),
                Source = source,
            }
            : new TextNode { BlockId = blockId, Id = id, Label = label, Spoken = spoken, Source = source };
    }

    // The starter is a field of a practice file, never a body block, so no group rule reaches it;
    // its id names the subject it belongs to.
    public static PracticeStarter? ReadStarter(FencedCodeBlock fence, string openingLine, string subjectId, int line, Action<int, string> error)
    {
        var expected = subjectId + StarterSuffix;
        if (!string.Equals(fence.Info, "csharp", StringComparison.Ordinal))
        {
            error(line, $"the starter is a csharp block, not \"{fence.Info}\"");
            return null;
        }

        if (!Group(fence, openingLine, "csharp", line, error, out var group))
        {
            return null;
        }

        var problems = new List<string>();
        var values = Values(group, problems);
        var id = group?.Attributes.Id;
        if (!values.ContainsKey(StarterFlag))
        {
            problems.Add($"the block under ## Starter is marked as the starter: {{#{expected} starter spoken=\"...\"}}");
        }

        if (id is null)
        {
            problems.Add($"the starter needs the id {{#{expected}}}");
        }
        else if (!string.Equals(id, expected, StringComparison.Ordinal))
        {
            problems.Add($"the starter id is \"{id}\"; it must be \"{expected}\"");
        }

        problems.AddRange(SpokenRule(values));
        problems.AddRange(NotOnStarter.Where(values.ContainsKey).Select(key => $"the starter does not take \"{key}\""));
        foreach (var problem in problems)
        {
            error(line, problem);
        }

        return problems.Count > 0 ? null : new PracticeStarter { Id = expected, Spoken = values["spoken"], Source = Source(fence) };
    }

    internal static string Source(FencedCodeBlock fence)
    {
        var text = new StringBuilder();
        for (var i = 0; i < fence.Lines.Count; i++)
        {
            if (i > 0)
            {
                text.Append('\n');
            }

            text.Append(fence.Lines.Lines[i].Slice.AsSpan());
        }

        return text.ToString();
    }

    // False after reporting a tail that is not one {...} group.
    private static bool Group(FencedCodeBlock fence, string openingLine, string language, int line, Action<int, string> error, out AttributeGroup? group)
    {
        var tail = openingLine.TrimStart().TrimStart(fence.FencedChar).Trim()[language.Length..].Trim();
        group = tail.Length > 0 ? AttributeGroup.Parse(tail) : null;
        if (tail.Length > 0 && group is null)
        {
            error(line, $"code fence attributes do not parse: {tail}");
            return false;
        }

        return true;
    }

    private static Dictionary<string, string> Values(AttributeGroup? group, List<string> problems)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        if (group is null)
        {
            return values;
        }

        if (group.IdCount > 1)
        {
            problems.Add("code fence has more than one #id");
        }

        if (group.ClassCount > 0)
        {
            problems.Add("unknown code fence attribute: classes are not supported");
        }

        foreach (var (key, value) in group.Properties)
        {
            if (!Known.Contains(key, StringComparer.Ordinal))
            {
                problems.Add($"unknown code fence attribute \"{key}\"");
            }
            else if (string.Equals(key, StarterFlag, StringComparison.Ordinal))
            {
                if (value is not null)
                {
                    problems.Add("code fence attribute \"starter\" takes no value");
                }
                else if (!values.TryAdd(key, string.Empty))
                {
                    problems.Add("code fence attribute \"starter\" is given twice");
                }
            }
            else if (value is null)
            {
                problems.Add($"code fence attribute \"{key}\" needs a value");
            }
            else if (!values.TryAdd(key, value))
            {
                problems.Add($"code fence attribute \"{key}\" is given twice");
            }
        }

        return values;
    }

    private static IEnumerable<string> Rules(bool csharp, string? id, Dictionary<string, string> values)
    {
        if (id is not null && !ContentIds.IsValid(id))
        {
            yield return $"code fence id \"{id}\" {ContentIds.FormatRule}";
        }

        if (values.ContainsKey(StarterFlag))
        {
            yield return "a starter block stands only under ## Starter in a practice file";
        }

        foreach (var problem in SpokenRule(values))
        {
            yield return problem;
        }

        if (Outcomes.Count(values.ContainsKey) > 1)
        {
            yield return "check, throws and fail are mutually exclusive";
        }

        if (csharp && id is null)
        {
            yield return "csharp fence needs an {#id}";
        }

        if (csharp && !values.ContainsKey("group"))
        {
            yield return "csharp fence needs a group";
        }

        foreach (var key in csharp ? [] : CsharpOnly.Where(values.ContainsKey))
        {
            yield return $"text fence does not take \"{key}\"";
        }
    }

    private static IEnumerable<string> SpokenRule(Dictionary<string, string> values)
    {
        if (!values.TryGetValue("spoken", out var spoken) || spoken.Trim().Length == 0)
        {
            yield return "code fence needs a spoken gloss (spoken=\"...\")";
        }
        else if (ContentIds.SpokenLength(spoken) > ContentIds.MaxSpokenLength)
        {
            yield return $"spoken gloss is {ContentIds.SpokenLength(spoken).ToString(System.Globalization.CultureInfo.InvariantCulture)} characters; at most 200 are allowed";
        }
    }
}
