using System.Text.Json;
using System.Text.Json.Nodes;

namespace SharpLadder.Content;

// Every JSON text the compiler reads or emits is parsed here before any other consumer sees it.
// Names are compared after escapes are decoded, so "type" and "type" are one name.
internal static class StrictJson
{
    private static readonly JsonDocumentOptions Options = new() { AllowDuplicateProperties = false };

    // Throws JsonException on malformed JSON and on any object holding one name twice.
    public static JsonNode? Parse(string text) => JsonNode.Parse(text, nodeOptions: null, documentOptions: Options);
}
