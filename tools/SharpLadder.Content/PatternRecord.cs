using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Title and summary are plain text, kept as written.
internal sealed class PatternRecord
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public required string Title { get; init; }

    [JsonPropertyOrder(2)]
    public required string Summary { get; init; }
}
