using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class TableNode : BodyBlock
{
    [JsonPropertyOrder(1)]
    public required IReadOnlyList<IReadOnlyList<Span>> Headers { get; init; }

    // Every row holds one cell per header; an empty cell is an empty span list.
    [JsonPropertyOrder(2)]
    public required IReadOnlyList<IReadOnlyList<IReadOnlyList<Span>>> Rows { get; init; }
}
