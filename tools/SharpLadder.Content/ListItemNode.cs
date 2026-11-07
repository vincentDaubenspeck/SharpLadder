using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class ListItemNode
{
    [JsonPropertyOrder(0)]
    public required string BlockId { get; init; }

    [JsonPropertyOrder(1)]
    public required IReadOnlyList<Span> Content { get; init; }
}
