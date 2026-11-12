using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// A ladder's public situation, as written, at the first block position of its section.
internal sealed class Cue
{
    [JsonPropertyOrder(0)]
    public required string BlockId { get; init; }

    [JsonPropertyOrder(1)]
    public required string Text { get; init; }
}
