using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

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
        var payloads = committed
            .Where(p => p.Key.StartsWith(Payload.CompiledFolder + "/", StringComparison.Ordinal) && !string.Equals(p.Key, Payload.ManifestPath, StringComparison.Ordinal))
            .OrderBy(p => p.Key, StringComparer.Ordinal);
        foreach (var (path, bytes) in payloads)
        {
            if (bytes.AsSpan().StartsWith((byte[])[0xEF, 0xBB, 0xBF]))
            {
                problems.Add($"{path}: starts with a byte-order mark");
                continue;
            }

            string text;
            try
            {
                text = Protocol.GetString(bytes);
            }
            catch (DecoderFallbackException e)
            {
                problems.Add($"{path}: not UTF-8: {e.Message}");
                continue;
            }

            if (schema.Validate(text) is { } problem)
            {
                problems.Add($"{path}: schema: {problem}");
                continue;
            }

            records.Add(new Record(path, text));
        }

        return problems.Count > 0 ? (null, problems) : (JsonSerializer.Serialize(new Envelope(1, records), Json), []);
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

    private sealed record Record(string Path, string Text);
}
