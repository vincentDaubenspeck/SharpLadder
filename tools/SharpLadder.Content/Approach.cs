using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class Approach
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public required IReadOnlyList<Span> Title { get; init; }

    // What the picker shows and the speech announces; the title is the heading over the body.
    [JsonPropertyOrder(2)]
    public required string Label { get; init; }

    [JsonPropertyOrder(3)]
    public required IReadOnlyList<BodyBlock> Body { get; init; }
}
