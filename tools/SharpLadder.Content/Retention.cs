using System.Text.Json;
using System.Text.Json.Nodes;

namespace SharpLadder.Content;

// A retired name is a promise to every link already published: it stays, and it keeps leading
// to wherever its old end now leads. Both sides are compiled alias records, never source files.
internal static class Retention
{
    private static readonly string[] Spaces = ["slugs", "ids"];

    // The record held in the bytes, or why they are not one compiled alias record.
    public static (JsonObject? Record, string? Refusal) Read(byte[] bytes, IContentSchema schema)
    {
        var (text, refusal) = TestRecords.Decode(bytes);
        if (text is null)
        {
            return (null, refusal);
        }

        if (schema.Validate(text, RecordKind.Aliases) is { } invalid)
        {
            return (null, "schema: " + invalid);
        }

        try
        {
            var record = StrictJson.Parse(text)!.AsObject();
            return Chained(record) is { } chained ? (null, chained) : (record, null);
        }
        catch (JsonException e)
        {
            return (null, "not one JSON document: " + e.Message);
        }
    }

    public static IReadOnlyList<string> Problems(JsonObject before, JsonObject now)
    {
        var problems = new List<string>();
        foreach (var space in Spaces)
        {
            var current = now[space]!.AsObject();
            foreach (var (key, was) in before[space]!.AsObject())
            {
                var old = was!.GetValue<string>();
                if (!current.TryGetPropertyValue(key, out var kept))
                {
                    problems.Add($"{space}: the retired name {PlainYaml.Shown(key)} was removed; a retired name is kept for good");
                    continue;
                }

                // A new end is honest only when the old end was itself retired to it.
                var end = kept!.GetValue<string>();
                var follows = current.TryGetPropertyValue(old, out var moved) && string.Equals(moved!.GetValue<string>(), end, StringComparison.Ordinal);
                if (!string.Equals(end, old, StringComparison.Ordinal) && !follows)
                {
                    problems.Add($"{space}: {PlainYaml.Shown(key)} ended at {PlainYaml.Shown(old)} and now ends at {PlainYaml.Shown(end)}, where {PlainYaml.Shown(old)} does not lead");
                }
            }
        }

        return problems;
    }

    // The rule below follows an old end one step, which is the whole way only when every end is
    // final; a chain or a cycle would otherwise carry a name anywhere.
    private static string? Chained(JsonObject record)
    {
        foreach (var space in Spaces)
        {
            var map = record[space]!.AsObject();
            foreach (var (key, end) in map)
            {
                var target = end!.GetValue<string>();
                if (map.ContainsKey(target))
                {
                    return $"{space}: {PlainYaml.Shown(key)} ends at {PlainYaml.Shown(target)}, which is itself retired; every end must be final";
                }
            }
        }

        return null;
    }
}
