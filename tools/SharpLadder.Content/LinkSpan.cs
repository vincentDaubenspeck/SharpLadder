using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class LinkSpan : Span
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    // Absent for a bare #id target, which always means the same source file.
    [JsonPropertyOrder(1)]
    public string? Chapter { get; init; }

    [JsonPropertyOrder(2)]
    public required IReadOnlyList<Span> Content { get; init; }
}
