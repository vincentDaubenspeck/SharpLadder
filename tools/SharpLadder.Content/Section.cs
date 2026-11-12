using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// One shape serves every part kind: a member another kind owns stays null, and so is never written.
internal sealed class Section
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    // Display only: derived from the part order and position, never stored or linked.
    [JsonPropertyOrder(1)]
    public string? Number { get; init; }

    [JsonPropertyOrder(2)]
    public required IReadOnlyList<Span> Title { get; init; }

    [JsonPropertyOrder(3)]
    public string? Rung { get; init; }

    [JsonPropertyOrder(4)]
    public required IReadOnlyList<BodyBlock>? Body { get; init; }

    // Set when a build section closes with two or more approaches after its shared lead.
    [JsonPropertyOrder(5)]
    public IReadOnlyList<Approach>? Approaches { get; set; }

    [JsonPropertyOrder(6)]
    public IReadOnlyList<Card>? Cards { get; init; }

    // Set after the prose is read, since the list must close the section.
    [JsonPropertyOrder(7)]
    public DrillList? Drills { get; set; }

    // Set once the whole section has been read; the schema refuses a section without it.
    [JsonPropertyOrder(8)]
    public SectionSpeech? Spoken { get; set; }

    // The heading's speech=skip summary, spoken in place of the body.
    [JsonIgnore]
    internal string? Summary { get; init; }
}
