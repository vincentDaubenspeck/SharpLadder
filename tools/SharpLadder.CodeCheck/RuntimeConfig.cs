using System.Buffers;
using System.Text.Json;

namespace SharpLadder.CodeCheck;

// Each group's runtime configuration names exactly the pinned runtime and forbids rolling forward,
// so no other installed runtime can be chosen for content.
internal static class RuntimeConfig
{
    public static byte[] Json(string runtimeVersion)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var json = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = true }))
        {
            json.WriteStartObject();
            json.WriteStartObject("runtimeOptions");
            json.WriteString("tfm", "net10.0");
            json.WriteString("rollForward", "Disable");
            json.WriteStartObject("framework");
            json.WriteString("name", "Microsoft.NETCore.App");
            json.WriteString("version", runtimeVersion);
            json.WriteEndObject();
            json.WriteEndObject();
            json.WriteEndObject();
        }

        return buffer.WrittenSpan.ToArray();
    }
}
