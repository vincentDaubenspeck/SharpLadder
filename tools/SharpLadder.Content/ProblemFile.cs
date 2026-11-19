using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Built field by field from checked front matter: a source field with no member here never ships.
internal sealed class ProblemFile
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "problem";

    [JsonPropertyOrder(1)]
    public required string Id { get; init; }

    [JsonPropertyOrder(2)]
    public required string Chapter { get; init; }

    [JsonPropertyOrder(3)]
    public required int Number { get; init; }

    [JsonPropertyOrder(4)]
    public required string Link { get; init; }

    [JsonPropertyOrder(5)]
    public required string Title { get; init; }

    [JsonPropertyOrder(6)]
    public required IReadOnlyList<string> PatternTags { get; init; }

    [JsonPropertyOrder(7)]
    public required IReadOnlyList<string> Ladders { get; init; }

    [JsonPropertyOrder(8)]
    public required IReadOnlyList<BodyBlock> Statement { get; init; }

    [JsonPropertyOrder(9)]
    public required IReadOnlyList<BodyBlock> Examples { get; init; }

    [JsonPropertyOrder(10)]
    public required IReadOnlyList<BodyBlock> Constraints { get; init; }

    [JsonPropertyOrder(11)]
    public required PracticeStarter Starter { get; init; }

    [JsonPropertyOrder(12)]
    public required SectionSpeech Spoken { get; init; }

    [JsonPropertyOrder(13)]
    public required PracticeSuite Tests { get; init; }
}
