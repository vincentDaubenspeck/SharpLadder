using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class Segment
{
    [JsonPropertyOrder(0)]
    public required SegmentTarget Target { get; init; }

    // Stored already normalised, so this is the exact string the audio slot covers.
    [JsonPropertyOrder(1)]
    public required string Text { get; init; }
}
