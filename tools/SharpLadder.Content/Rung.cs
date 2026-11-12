using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// One hint; its id is unique only within its ladder, so it is always named ladder-id/rung-id.
internal sealed class Rung
{
    [JsonPropertyOrder(0)]
    public required string Id { get; init; }

    [JsonPropertyOrder(1)]
    public required IReadOnlyList<Span> Content { get; init; }
}
