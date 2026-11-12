using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class Card
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public required IReadOnlyList<Span> Title { get; init; }

    // Typed as the base so each field is written with its block type beside it.
    [JsonPropertyOrder(2)]
    public required BodyBlock Reach { get; init; }

    [JsonPropertyOrder(3)]
    public required BodyBlock Build { get; init; }

    [JsonPropertyOrder(4)]
    public required IReadOnlyList<BodyBlock> Why { get; init; }

    [JsonPropertyOrder(5)]
    public BodyBlock? Traps { get; init; }

    [JsonPropertyOrder(6)]
    public BodyBlock? Also { get; init; }
}
