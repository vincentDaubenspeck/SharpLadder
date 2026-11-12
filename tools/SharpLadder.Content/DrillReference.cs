using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// One drill as the drill part names it: the id is kept as written for a later stage to resolve,
// and the label is all a learner sees of it here.
internal sealed class DrillReference
{
    [JsonPropertyOrder(0)]
    public required string BlockId { get; init; }

    [JsonPropertyOrder(1)]
    public required string Id { get; init; }

    [JsonPropertyOrder(2)]
    public required string Label { get; init; }
}
