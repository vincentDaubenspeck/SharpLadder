using System.Text;

namespace SharpLadder.Content;

// Every text input is checked on its raw bytes, before any reader can normalise a line ending.
internal static class TextAdmission
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // For readers that report in their own form; the refusal itself is the same everywhere.
    public static bool HoldsCarriageReturn(ReadOnlySpan<byte> bytes) => bytes.Contains((byte)'\r');

    // The decoded text, or the diagnostic that refuses the file. UTF-8 never encodes a CR inside a
    // multi-byte sequence, so the byte scan cannot misfire.
    public static (string? Text, Diagnostic? Refusal) Read(byte[] bytes, string display)
    {
        string text;
        try
        {
            text = StrictUtf8.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return (null, new Diagnostic(display, null, "file is not valid UTF-8"));
        }

        if (text.StartsWith('﻿'))
        {
            return (null, new Diagnostic(display, 1, "file starts with a byte order mark; save it as UTF-8 without one"));
        }

        var cr = Array.IndexOf(bytes, (byte)'\r');
        if (cr >= 0)
        {
            var line = 1 + bytes.AsSpan(0, cr).Count((byte)'\n');
            return (null, new Diagnostic(display, line, "file holds a carriage return (CR); save it with LF line endings"));
        }

        return (text, null);
    }
}
