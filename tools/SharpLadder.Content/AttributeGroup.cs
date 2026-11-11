using Markdig.Extensions.GenericAttributes;
using Markdig.Helpers;
using Markdig.Renderers.Html;

namespace SharpLadder.Content;

// One {...} attribute group, parsed by Markdig's own attribute grammar. Markdig keeps only the
// last #id of a group and merges adjacent groups, so the counts come from the raw text.
internal sealed class AttributeGroup
{
    private AttributeGroup(HtmlAttributes attributes, int idCount, int classCount, IReadOnlyList<string> propertyNames)
    {
        Attributes = attributes;
        IdCount = idCount;
        ClassCount = classCount;
        PropertyNames = propertyNames;
    }

    // As spelled in the raw text, repeats included, because Markdig may merge them.
    public IReadOnlyList<string> PropertyNames { get; }

    public HtmlAttributes Attributes { get; }

    public int IdCount { get; }

    public int ClassCount { get; }

    public IReadOnlyList<KeyValuePair<string, string?>> Properties =>
        Attributes.Properties ?? (IReadOnlyList<KeyValuePair<string, string?>>)[];

    // The whole text must be one group, else null.
    public static AttributeGroup? Parse(string text)
    {
        var slice = new StringSlice(text);
        if (!GenericAttributesParser.TryParse(ref slice, out var attributes) || !slice.IsEmptyOrWhitespace())
        {
            return null;
        }

        var ids = 0;
        var classes = 0;
        var names = new List<string>();
        foreach (var token in Tokens(text.Trim()[1..^1]))
        {
            if (token.StartsWith('#'))
            {
                ids++;
            }
            else if (token.StartsWith('.'))
            {
                classes++;
            }
            else
            {
                var equals = token.IndexOf('=', StringComparison.Ordinal);
                names.Add(equals < 0 ? token : token[..equals]);
            }
        }

        return new AttributeGroup(attributes, ids, classes, names);
    }

    // The groups at the end of a line, in line order.
    public static List<AttributeGroup> Trailing(string line)
    {
        var groups = new List<AttributeGroup>();
        var rest = line.TrimEnd();
        while (rest.EndsWith('}'))
        {
            AttributeGroup? found = null;
            var at = rest.Length;
            while (found is null && (at = rest.LastIndexOf('{', at - 1)) >= 0)
            {
                found = Parse(rest[at..]);
                if (at == 0)
                {
                    break;
                }
            }

            if (found is null)
            {
                break;
            }

            groups.Insert(0, found);
            rest = rest[..at].TrimEnd();
        }

        return groups;
    }

    // Whitespace-separated tokens, keeping quoted values whole.
    private static IEnumerable<string> Tokens(string inner)
    {
        var start = -1;
        char quote = '\0';
        for (var i = 0; i < inner.Length; i++)
        {
            var c = inner[i];
            if (quote != '\0')
            {
                if (c == quote)
                {
                    quote = '\0';
                }
            }
            else if (c is '"' or '\'')
            {
                quote = c;
                start = start < 0 ? i : start;
            }
            else if (char.IsWhiteSpace(c))
            {
                if (start >= 0)
                {
                    yield return inner[start..i];
                    start = -1;
                }
            }
            else if (start < 0)
            {
                start = i;
            }
        }

        if (start >= 0)
        {
            yield return inner[start..];
        }
    }
}
