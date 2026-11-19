using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Built field by field from checked front matter: a source field with no member here never ships.
internal sealed class DrillFile
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "drill";

    [JsonPropertyOrder(1)]
    public required string Id { get; init; }

    [JsonPropertyOrder(2)]
    public required string Chapter { get; init; }

    [JsonPropertyOrder(3)]
    public required string Rung { get; init; }

    [JsonPropertyOrder(4)]
    public required string Title { get; init; }

    // The authored type, the move in words; the record's own type names the kind.
    [JsonPropertyOrder(5)]
    public required string Move { get; init; }

    [JsonPropertyOrder(6)]
    public required IReadOnlyList<string> Ideas { get; init; }

    [JsonPropertyOrder(7)]
    public required IReadOnlyList<string> Prerequisites { get; init; }

    [JsonPropertyOrder(8)]
    public required IReadOnlyList<string> Prepares { get; init; }

    // Written as null when the drill varies no other, since the schema requires the key.
    [JsonPropertyOrder(9)]
    [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    public required string? VariationOf { get; init; }

    [JsonPropertyOrder(10)]
    public required IReadOnlyList<string> Ladders { get; init; }

    [JsonPropertyOrder(11)]
    public required IReadOnlyList<BodyBlock> Statement { get; init; }

    [JsonPropertyOrder(12)]
    public required IReadOnlyList<BodyBlock> Examples { get; init; }

    [JsonPropertyOrder(13)]
    public required IReadOnlyList<BodyBlock> Constraints { get; init; }

    [JsonPropertyOrder(14)]
    public required PracticeStarter Starter { get; init; }

    [JsonPropertyOrder(15)]
    public required SectionSpeech Spoken { get; init; }

    [JsonPropertyOrder(16)]
    public required PracticeSuite Tests { get; init; }
}
