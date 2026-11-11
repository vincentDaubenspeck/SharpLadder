using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Retired names, each mapped to the live name it ends at. Both maps are ordered by key.
internal sealed class AliasesFile
{
    [JsonPropertyOrder(0)]
    public required SortedDictionary<string, string> Slugs { get; init; }

    [JsonPropertyOrder(1)]
    public required SortedDictionary<string, string> Ids { get; init; }
}
