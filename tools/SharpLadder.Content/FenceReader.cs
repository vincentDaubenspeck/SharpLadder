using System.Text;
using Markdig.Syntax;

namespace SharpLadder.Content;

// Turns a code fence into a code or text block. The info string is the language and at most one
// {...} group; csharp and text blocks are stored as data and not compiled here.
internal static class FenceReader
{
    private static readonly string[] Known = ["group", "spoken", "label", "check", "throws", "fail"];
    private static readonly string[] Outcomes = ["check", "throws", "fail"];
    private static readonly string[] CsharpOnly = ["check", "fail", "group", "throws"];

    public static BodyBlock? Read(FencedCodeBlock fence, string openingLine, string blockId, int line, Action<int, string> error)
    {
        var language = fence.Info ?? string.Empty;
        if (language is not ("csharp" or "text"))
        {
            error(line, $"code fence language must be csharp or text, not \"{language}\"");
            return null;
        }

        var csharp = language is "csharp";
        var tail = openingLine.TrimStart().TrimStart(fence.FencedChar).Trim()[language.Length..].Trim();
        var group = tail.Length > 0 ? AttributeGroup.Parse(tail) : null;
        if (tail.Length > 0 && group is null)
        {
            error(line, $"code fence attributes do not parse: {tail}");
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

        if (!values.TryGetValue("spoken", out var spoken) || spoken.Trim().Length == 0)
        {
            yield return "code fence needs a spoken gloss (spoken=\"...\")";
        }
        else if (spoken.Length > ContentIds.MaxSpokenLength)
        {
            yield return $"spoken gloss is {spoken.Length.ToString(System.Globalization.CultureInfo.InvariantCulture)} characters; at most 200 are allowed";
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

    private static string Source(FencedCodeBlock fence)
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
}
