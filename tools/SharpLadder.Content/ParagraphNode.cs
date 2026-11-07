using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class ParagraphNode : BodyBlock
{
    [JsonPropertyOrder(1)]
    public required IReadOnlyList<Span> Content { get; init; }
}
