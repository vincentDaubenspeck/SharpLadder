using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class CodeSpan : Span
{
    [JsonPropertyOrder(0)]
    public required string Text { get; init; }
}
