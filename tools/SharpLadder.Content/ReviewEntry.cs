using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class ReviewEntry
{
    [JsonPropertyOrder(0)]
    public required string Check { get; init; }

    [JsonPropertyOrder(1)]
    public required string SectionId { get; init; }

    [JsonPropertyOrder(2)]
    public required string Label { get; init; }

    [JsonPropertyOrder(3)]
    public string? WalkId { get; init; }
}
