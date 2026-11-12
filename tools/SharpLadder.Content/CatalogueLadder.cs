using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// A ladder as the catalogue holds it: its id, its cue and the speech of that cue alone.
internal sealed class CatalogueLadder
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public required Cue Cue { get; init; }

    [JsonPropertyOrder(2)]
    public required SectionSpeech Spoken { get; init; }
}
