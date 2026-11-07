using System.Text.Json.Serialization;

namespace SharpLadder.Content;

internal sealed class Targets
{
    [JsonPropertyOrder(0)]
    public int? Csharp { get; init; }

    [JsonPropertyOrder(1)]
    public int? Dotnet { get; init; }
}
