using System.Text.Json.Serialization;

namespace SharpLadder.Content;

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
    public required IReadOnlyList<BodyBlock> Body { get; init; }

    // Set once the whole section has been read; the schema refuses a section without it.
    [JsonPropertyOrder(4)]
    public SectionSpeech? Spoken { get; set; }

    // The heading's speech=skip summary, spoken in place of the body.
    [JsonIgnore]
    internal string? Summary { get; init; }
}
