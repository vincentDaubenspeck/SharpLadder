using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class PracticeSuite
{
    [JsonPropertyOrder(0)]
    public required string Text { get; init; }

    [JsonPropertyOrder(1)]
    public required int Version { get; init; }

    [JsonPropertyOrder(2)]
    public required string Hash { get; init; }

    [JsonPropertyOrder(3)]
    public required int Count { get; init; }

    // Sorted by check name, ordinal: the schema has no map form.
    [JsonPropertyOrder(4)]
    public required IReadOnlyList<ReviewEntry> Review { get; init; }
}
