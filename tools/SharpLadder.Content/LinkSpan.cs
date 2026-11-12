using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class LinkSpan : Span
{
    public const string Anchor = "anchor";
    public const string ErrorEntry = "error";

    // What the target is, decided once every file is read, so no reader infers it from the id.
    [JsonPropertyOrder(0)]
    public string Kind { get; set; } = Anchor;

    [JsonPropertyOrder(1)]
    public required string Id { get; init; }

    // Absent for a bare #id target, which always means the same source file.
    [JsonPropertyOrder(2)]
    public string? Chapter { get; init; }

    [JsonPropertyOrder(3)]
    public required IReadOnlyList<Span> Content { get; init; }
}
