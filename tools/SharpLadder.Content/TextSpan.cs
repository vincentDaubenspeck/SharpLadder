using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class TextSpan : Span
{
    [JsonPropertyOrder(0)]
    public required string Text { get; init; }
}
