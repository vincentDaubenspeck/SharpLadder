using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace SharpLadder.Content;

// The audio slot of a section: SHA-256 over the RFC 8785 bytes of its segment texts in order. The
// writer takes only a list of well-formed strings, so no object or number rule is needed.
internal static class AudioSlot
{
    private const string Prefix = "sha256:";

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // Segment text in its stored form: LF only, NFC. A lone surrogate is refused, never replaced,
    // and so is a noncharacter, which the two runtimes do not normalise alike.
    public static string Normalise(string text)
    {
        RequireWellFormed(text);
        for (var i = 0; i < text.Length; i++)
        {
            var point = char.IsHighSurrogate(text[i]) ? char.ConvertToUtf32(text[i], text[++i]) : text[i];
            if ((point & 0xFFFE) == 0xFFFE || point is >= 0xFDD0 and <= 0xFDEF)
            {
                throw new ArgumentException("a segment text holds a noncharacter", nameof(text));
            }
        }

        return text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Normalize(NormalizationForm.FormC);
    }

    // Whether text is well formed and holds no noncharacter, whatever its line endings and form.
    public static bool IsStorable(string text)
    {
        try
        {
            _ = Normalise(text);
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    // Refuses text that is not already in its stored form, so a slot never covers bytes that differ
    // from the segments beside it.
    public static string Of(IReadOnlyList<string> texts)
    {
        ArgumentNullException.ThrowIfNull(texts);
        foreach (var text in texts)
        {
            if (text is null || !string.Equals(Normalise(text), text, StringComparison.Ordinal))
            {
                throw new ArgumentException("a segment text is not in its stored form (NFC, LF only)", nameof(texts));
            }
        }

        return Prefix + Convert.ToHexStringLower(SHA256.HashData(Serialise(texts)));
    }

    // RFC 8785 section 3.2.2.2 string escaping and array punctuation, with nothing normalised.
    public static byte[] Serialise(IReadOnlyList<string> texts)
    {
        ArgumentNullException.ThrowIfNull(texts);
        var json = new StringBuilder("[");
        for (var i = 0; i < texts.Count; i++)
        {
            var text = texts[i] ?? throw new ArgumentException("a segment text is missing", nameof(texts));
            RequireWellFormed(text);
            if (i > 0)
            {
                json.Append(',');
            }

            Quote(text, json);
        }

        return StrictUtf8.GetBytes(json.Append(']').ToString());
    }

    private static void Quote(string text, StringBuilder json)
    {
        json.Append('"');
        foreach (var c in text)
        {
            _ = c switch
            {
                '"' => json.Append("\\\""),
                '\\' => json.Append("\\\\"),
                '\b' => json.Append("\\b"),
                '\t' => json.Append("\\t"),
                '\n' => json.Append("\\n"),
                '\f' => json.Append("\\f"),
                '\r' => json.Append("\\r"),
                < ' ' => json.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture)),
                _ => json.Append(c),
            };
        }

        json.Append('"');
    }

    private static void RequireWellFormed(string text)
    {
        for (var i = 0; i < text.Length; i++)
        {
            if (char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
            {
                i++;
            }
            else if (char.IsSurrogate(text[i]))
            {
                throw new ArgumentException("a segment text holds a lone surrogate", nameof(text));
            }
        }
    }
}
