using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// Built by naming each public field, so nothing a ladder hides can reach it.
internal sealed class HintsCatalogue
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "hints-catalogue";

    [JsonPropertyOrder(1)]
    public string? Chapter { get; init; }

    [JsonPropertyOrder(2)]
    public int? Order { get; init; }

    [JsonPropertyOrder(3)]
    public required IReadOnlyList<CatalogueLadder> Ladders { get; init; }
}
