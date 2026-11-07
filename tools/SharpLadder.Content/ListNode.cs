using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class ListNode : BodyBlock
{
    [JsonPropertyOrder(1)]
    public required bool Ordered { get; init; }

    [JsonPropertyOrder(2)]
    public int? Start { get; init; }

    [JsonPropertyOrder(3)]
    public required IReadOnlyList<ListItemNode> Items { get; init; }
}
