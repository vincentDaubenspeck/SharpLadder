using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SharpLadder.Content;

namespace SharpLadder.CodeCheck;

// The pin, the list and the stamp are read alike: strict UTF-8, strict JSON, one object.
internal static class JsonFile
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    public static JsonObject Read(string path, string shown)
    {
        try
        {
            return StrictJson.Parse(File.ReadAllText(path, StrictUtf8)) as JsonObject
                ?? throw new ToolProblem($"{shown}: not a JSON object");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or DecoderFallbackException)
        {
            throw new ToolProblem($"{shown}: cannot be read: {e.Message}", e);
        }
    }

    public static string? Text(JsonObject json, string name) =>
        json[name] is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;
}
