using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class BlockTarget : SegmentTarget
{
    [JsonPropertyOrder(0)]
    public required string BlockId { get; init; }
}
