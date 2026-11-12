using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// The closing list of a drill section: one item per drill, in the recommended order.
internal sealed class DrillList
{
    [JsonPropertyOrder(0)]
    public required string BlockId { get; init; }

    [JsonPropertyOrder(1)]
    public required IReadOnlyList<DrillReference> Items { get; init; }
}
