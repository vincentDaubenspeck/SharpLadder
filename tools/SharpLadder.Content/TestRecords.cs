using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// The round-trip transport: every committed compiled JSON payload except the manifest, decoded and
// validated from the bytes the drift comparison accepted, sent as one envelope on standard output.
internal static class TestRecords
{
    private static readonly UTF8Encoding Protocol = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // Non-ASCII text travels as UTF-8, not as escapes, so the transport carries it as it is.
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static (string? Envelope, IReadOnlyList<string> Problems) Build(IReadOnlyDictionary<string, byte[]> committed, IContentSchema schema)
    {
        var problems = new List<string>();
        var records = new List<Record>();
        var kinds = Payload.Kinds(committed);
        var payloads = committed
            .Where(p => p.Key.StartsWith(Payload.CompiledFolder + "/", StringComparison.Ordinal) && !string.Equals(p.Key, Payload.ManifestPath, StringComparison.Ordinal))
            .OrderBy(p => p.Key, StringComparer.Ordinal);
        foreach (var (path, bytes) in payloads)
        {
            var (text, refusal) = Decode(bytes);
            if (text is null)
            {
                problems.Add($"{path}: {refusal}");
                continue;
            }

            // The manifest names the kind, and the record must be valid as exactly that kind.
            if (!kinds.TryGetValue(path, out var stated))
            {
                problems.Add($"{path}: the manifest states no kind for it");
                continue;
            }

            var (kind, part) = stated;

            if (schema.Validate(text, kind) is { } problem)
            {
                problems.Add($"{path}: schema: {problem}");
                continue;
            }

            // The part kind is the manifest's, and the accepted payload must state the same one.
            if (part is not null && !string.Equals((JsonNode.Parse(text) as JsonObject)?["kind"]?.GetValue<string>(), part, StringComparison.Ordinal))
            {
                problems.Add($"{path}: the manifest states the part kind {part}, and the record holds another");
                continue;
            }

            records.Add(new Record(path, Payload.KindName(kind), part, text));
        }

        return problems.Count > 0 ? (null, problems) : (JsonSerializer.Serialize(new Envelope(3, records), Json), []);
    }

    // The text of one payload file, or why its bytes are refused before any schema sees them.
    public static (string? Text, string? Refusal) Decode(byte[] bytes)
    {
        if (bytes.AsSpan().StartsWith((byte[])[0xEF, 0xBB, 0xBF]))
        {
            return (null, "starts with a byte-order mark");
        }

        try
        {
            return (Protocol.GetString(bytes), null);
        }
        catch (DecoderFallbackException e)
        {
            return (null, "not UTF-8: " + e.Message);
        }
    }

    // The protocol fixes its own encoding; Console.Out would follow the console's instead.
    public static void Write(Func<Stream> openStandardOutput, string envelope)
    {
        using var stream = openStandardOutput();
        using var writer = new StreamWriter(stream, Protocol, bufferSize: 4096, leaveOpen: true);
        writer.Write(envelope);
        writer.Flush();
    }

    private sealed record Envelope(int Version, IReadOnlyList<Record> Records);

    private sealed record Record(string Path, string Kind, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Part, string Text);
}
