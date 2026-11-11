using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// The pattern registry, ordered by id.
internal sealed class PatternsFile
{
    [JsonPropertyOrder(0)]
    public required IReadOnlyList<PatternRecord> Patterns { get; init; }
}
