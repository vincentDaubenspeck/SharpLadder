using System.Buffers;
using System.Text;
using System.Text.Json;

namespace SharpLadder.CodeCheck;

// What the leak scan compares: each scanned file or entry as views of text, and the lines of a view
// as the scan matches them. Reference, starter, suite and exclusion lines go through Lines only:
// they are source text, compared as written, never decoded.
internal static class LeakText
{
    public const int MaxBytes = 64 * 1024 * 1024;

    private const int ChunkBytes = 81920;

    // Build output is not always valid UTF-8 (fonts, images); a bad sequence becomes U+FFFD.
    private static readonly UTF8Encoding Lenient = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false);

    private static readonly SearchValues<char> LineBreaks = SearchValues.Create("\r\n");

    // A stream is read to its end only while it stays within the limit, whatever length it reports.
    public static byte[] Read(Stream stream, string display)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[ChunkBytes];
        int count;
        while ((count = stream.Read(chunk)) > 0)
        {
            if (buffer.Length + count > MaxBytes)
            {
                throw Oversize(display);
            }

            buffer.Write(chunk, 0, count);
        }

        return buffer.ToArray();
    }

    // The raw text, the lexically decoded text and, for a .json file, each string token's value.
    public static IReadOnlyList<(string View, string Text)> Views(string name, byte[] bytes, string display)
    {
        if (bytes.Length > MaxBytes)
        {
            throw Oversize(display);
        }

        var raw = Lenient.GetString(bytes.AsSpan(Bom(bytes)));
        var views = new List<(string View, string Text)> { ("raw", raw) };
        var decoded = Decode(raw);
        if (!ReferenceEquals(decoded, raw))
        {
            views.Add(("decoded", decoded));
        }

        if (name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            views.AddRange(JsonStrings(bytes, display).Select(s => ("JSON string", s)));
        }

        return views;
    }

    // Lines split on CR, LF or CRLF, each with whitespace runs made one space, then trimmed.
    public static List<string> Lines(string text)
    {
        var lines = new List<string>();
        var rest = text.AsSpan();
        while (rest.IndexOfAny(LineBreaks) is var at and >= 0)
        {
            lines.Add(Normalise(rest[..at]));
            rest = rest[(rest[at] == '\r' && at + 1 < rest.Length && rest[at + 1] == '\n' ? at + 2 : at + 1)..];
        }

        lines.Add(Normalise(rest));
        return lines;
    }

    public static string Normalise(ReadOnlySpan<char> line)
    {
        var normalised = new StringBuilder(line.Length);
        var space = false;
        foreach (var c in line)
        {
            if (char.IsWhiteSpace(c))
            {
                space = true;
                continue;
            }

            if (space && normalised.Length > 0)
            {
                normalised.Append(' ');
            }

            space = false;
            normalised.Append(c);
        }

        return normalised.ToString();
    }

    // One pass, left to right, over the closed table of C# string escapes plus JSON's \/; anything
    // else after a backslash is left as it is. A \u unit stays one UTF-16 unit, so an escaped
    // surrogate pair becomes its character. The same instance comes back when there is no escape.
    public static string Decode(string text)
    {
        var at = text.IndexOf('\\', StringComparison.Ordinal);
        if (at < 0)
        {
            return text;
        }

        var decoded = new StringBuilder(text.Length);
        decoded.Append(text, 0, at);
        while (at < text.Length)
        {
            var used = text[at] == '\\' ? Escape(decoded, text, at) : 0;
            if (used == 0)
            {
                decoded.Append(text[at]);
                used = 1;
            }

            at += used;
        }

        return decoded.ToString();
    }

    // Appends the value of the escape whose backslash is at text[at] and returns its length, or
    // returns 0 when no table entry starts there.
    private static int Escape(StringBuilder decoded, string text, int at)
    {
        if (at + 1 == text.Length)
        {
            return 0;
        }

        if (Simple(text[at + 1]) is { } simple)
        {
            decoded.Append(simple);
            return 2;
        }

        var (min, max) = text[at + 1] switch
        {
            'u' => (4, 4),
            'U' => (8, 8),
            'x' => (1, 4),
            _ => (0, 0),
        };
        if (max == 0)
        {
            return 0;
        }

        var digits = Hex(text, at + 2, min, max, out var value);
        if (digits == 0 || value > 0x10FFFF)
        {
            return 0;
        }

        // As the C# lexer does: below U+10000 the value is one UTF-16 unit, a lone surrogate included.
        decoded.Append(value < 0x10000 ? ((char)value).ToString() : char.ConvertFromUtf32((int)value));
        return digits + 2;
    }

    private static char? Simple(char escaped) => escaped switch
    {
        '\'' => '\'',
        '"' => '"',
        '\\' => '\\',
        '0' => '\0',
        'a' => '\a',
        'b' => '\b',
        'e' => '\e',
        'f' => '\f',
        'n' => '\n',
        'r' => '\r',
        't' => '\t',
        'v' => '\v',
        '/' => '/',
        _ => null,
    };

    // The ASCII hex digits read greedily from start, at most max; 0 when fewer than min are there.
    private static int Hex(string text, int start, int min, int max, out uint value)
    {
        value = 0;
        var count = 0;
        while (count < max && start + count < text.Length && char.IsAsciiHexDigit(text[start + count]))
        {
            var digit = text[start + count];
            value = (value * 16) + (uint)(char.IsAsciiDigit(digit) ? digit - '0' : (digit | 0x20) - 'a' + 10);
            count++;
        }

        return count >= min ? count : 0;
    }

    private static int Bom(byte[] bytes) => bytes.AsSpan().StartsWith(Encoding.UTF8.Preamble) ? 3 : 0;

    // Property names are string tokens too. A .json file that does not parse cannot be scanned.
    private static List<string> JsonStrings(byte[] bytes, string display)
    {
        var values = new List<string>();
        var reader = new Utf8JsonReader(bytes.AsSpan(Bom(bytes)));
        try
        {
            while (reader.Read())
            {
                if (reader.TokenType is JsonTokenType.String or JsonTokenType.PropertyName)
                {
                    values.Add(reader.GetString()!);
                }
            }
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            throw new ToolProblem($"{display}: does not parse as JSON, so it cannot be scanned ({e.Message})", e);
        }

        return values;
    }

    private static ToolProblem Oversize(string display) =>
        new($"{display}: larger than {MaxBytes / (1024 * 1024)} MiB, the most the leak scan reads of one file");
}
