using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class Section
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    // Display only: derived from the part order and position, never stored or linked.
    [JsonPropertyOrder(1)]
    public string? Number { get; init; }

    [JsonPropertyOrder(2)]
    public required IReadOnlyList<Span> Title { get; init; }

    [JsonPropertyOrder(3)]
    public required IReadOnlyList<BodyBlock> Body { get; init; }
}
