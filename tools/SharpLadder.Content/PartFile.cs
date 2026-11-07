using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class PartFile
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "part";

    [JsonPropertyOrder(1)]
    public string? Kind { get; init; }

    [JsonPropertyOrder(2)]
    public string? Chapter { get; init; }

    [JsonPropertyOrder(3)]
    public int? Order { get; init; }

    [JsonPropertyOrder(4)]
    public required IReadOnlyList<Section> Sections { get; init; }
}
