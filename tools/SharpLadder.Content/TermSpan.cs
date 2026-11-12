using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class TermSpan : Span
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public string Short { get; set; } = string.Empty;

    [JsonPropertyOrder(2)]
    public required IReadOnlyList<Span> Content { get; init; }
}
