using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// The compiled JSON shapes match content/schema. Every property carries an explicit order so
// the output never depends on reflection order.
internal sealed class ChapterFile
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "chapter";

    [JsonPropertyOrder(1)]
    public string? Id { get; init; }

    [JsonPropertyOrder(2)]
    public string? Slug { get; init; }

    [JsonPropertyOrder(3)]
    public string? Title { get; init; }

    [JsonPropertyOrder(4)]
    public int? Order { get; init; }

    [JsonPropertyOrder(5)]
    public Targets? Targets { get; init; }

    [JsonPropertyOrder(6)]
    public required IReadOnlyList<BodyBlock> Intro { get; init; }

    [JsonPropertyOrder(7)]
    public required IReadOnlyList<Section> Sections { get; init; }
}
