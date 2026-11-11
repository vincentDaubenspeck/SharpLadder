using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class SectionSpeech
{
    [JsonPropertyOrder(0)]
    public required IReadOnlyList<Segment> Segments { get; init; }

    [JsonPropertyOrder(1)]
    public required string Audio { get; init; }
}
