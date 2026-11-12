using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class ErrorFile
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "error";

    [JsonPropertyOrder(1)]
    public required string Kind { get; init; }

    [JsonPropertyOrder(2)]
    public required string Id { get; init; }

    // Absent for a wrong-output entry, which has no diagnostic to name.
    [JsonPropertyOrder(3)]
    public string? Code { get; init; }

    [JsonPropertyOrder(4)]
    public required string Wrote { get; init; }

    [JsonPropertyOrder(5)]
    public required string Got { get; init; }

    [JsonPropertyOrder(6)]
    public required IReadOnlyList<string> See { get; init; }

    [JsonPropertyOrder(7)]
    public required IReadOnlyList<BodyBlock> Cause { get; init; }

    [JsonPropertyOrder(8)]
    public required IReadOnlyList<BodyBlock> Hint { get; init; }
}
