using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class CodeNode : BodyBlock
{
    [JsonPropertyOrder(1)]
    public required string Id { get; init; }

    [JsonPropertyOrder(2)]
    public required string Group { get; init; }

    [JsonPropertyOrder(3)]
    public string? Label { get; init; }

    [JsonPropertyOrder(4)]
    public required string Spoken { get; init; }

    [JsonPropertyOrder(5)]
    public string? Check { get; init; }

    [JsonPropertyOrder(6)]
    public string? Throws { get; init; }

    [JsonPropertyOrder(7)]
    public string? Fail { get; init; }

    [JsonPropertyOrder(8)]
    public required string Source { get; init; }
}
