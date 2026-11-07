using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class StrongSpan : Span
{
    [JsonPropertyOrder(0)]
    public required IReadOnlyList<Span> Content { get; init; }
}
