using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// The full hints record: every ladder with what it hides, and no speech of its own.
internal sealed class HintsPartFile
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "part";

    [JsonPropertyOrder(1)]
    public string Kind { get; } = PartKinds.Hints;

    [JsonPropertyOrder(2)]
    public string? Chapter { get; init; }

    [JsonPropertyOrder(3)]
    public int? Order { get; init; }

    [JsonPropertyOrder(4)]
    public required IReadOnlyList<Ladder> Sections { get; init; }
}
