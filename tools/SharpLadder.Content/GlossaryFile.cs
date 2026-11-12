using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class GlossaryFile
{
    [JsonPropertyOrder(0)]
    public string Type { get; } = "glossary";

    [JsonPropertyOrder(1)]
    public required string Id { get; init; }

    [JsonPropertyOrder(2)]
    public required string Term { get; init; }

    [JsonPropertyOrder(3)]
    public required string Short { get; init; }

    [JsonPropertyOrder(4)]
    public required IReadOnlyList<string> See { get; init; }

    [JsonPropertyOrder(5)]
    public required IReadOnlyList<BodyBlock> Body { get; init; }
}
