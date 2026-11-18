using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Exactly one of Src and Value is set; Value is a long or a string, never null.
internal sealed class WalkStep
{
    [JsonPropertyOrder(0)]
    public required string BlockId { get; init; }

    [JsonPropertyOrder(1)]
    public required int Dst { get; init; }

    [JsonPropertyOrder(2)]
    public int? Src { get; init; }

    [JsonPropertyOrder(3)]
    public object? Value { get; init; }

    [JsonPropertyOrder(4)]
    public required IReadOnlyList<Span> Note { get; init; }

    [JsonPropertyOrder(5)]
    public bool? Lost { get; init; }
}
