using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// A field of a practice record, not spoken text, so it has no block id.
internal sealed class PracticeStarter
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public required string Spoken { get; init; }

    [JsonPropertyOrder(2)]
    public required string Source { get; init; }
}
