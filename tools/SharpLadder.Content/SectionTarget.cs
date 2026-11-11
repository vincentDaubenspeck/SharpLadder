using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class SectionTarget : SegmentTarget
{
    [JsonPropertyOrder(0)]
    public required string SectionId { get; init; }
}
