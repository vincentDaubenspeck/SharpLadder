using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class WalkSequence
{
    [JsonPropertyOrder(0)]
    public required string Name { get; init; }

    [JsonPropertyOrder(1)]
    public required string IntroBlockId { get; init; }

    [JsonPropertyOrder(2)]
    public required IReadOnlyList<Span> Intro { get; init; }

    [JsonPropertyOrder(3)]
    public required IReadOnlyList<WalkStep> Steps { get; init; }
}
