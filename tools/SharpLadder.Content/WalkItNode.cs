using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class WalkItNode : BodyBlock
{
    [JsonPropertyOrder(1)]
    public required string Id { get; init; }

    [JsonPropertyOrder(2)]
    public required IReadOnlyList<Span> Title { get; init; }

    // Each cell is a long, a string or null, so it serialises as the number, string or null the
    // schema's cell admits.
    [JsonPropertyOrder(3)]
    public required IReadOnlyList<object?> Cells { get; init; }

    [JsonPropertyOrder(4)]
    public required IReadOnlyList<WalkSequence> Sequences { get; init; }
}
