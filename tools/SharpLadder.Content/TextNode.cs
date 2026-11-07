using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class TextNode : BodyBlock
{
    [JsonPropertyOrder(1)]
    public string? Id { get; init; }

    [JsonPropertyOrder(2)]
    public string? Label { get; init; }

    [JsonPropertyOrder(3)]
    public required string Spoken { get; init; }

    [JsonPropertyOrder(4)]
    public required string Source { get; init; }
}
