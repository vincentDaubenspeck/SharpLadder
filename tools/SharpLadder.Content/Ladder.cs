using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// One hint ladder: the cue is public; the title, pattern, approach and rungs stay hidden until
// they are revealed, so only the cue catalogue ever reaches a view.
internal sealed class Ladder
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public required IReadOnlyList<Span> Title { get; init; }

    [JsonPropertyOrder(2)]
    public required Cue Cue { get; init; }

    [JsonPropertyOrder(3)]
    public required string Pattern { get; init; }

    [JsonPropertyOrder(4)]
    public required string Approach { get; init; }

    [JsonPropertyOrder(5)]
    public required IReadOnlyList<Rung> Rungs { get; init; }
}
