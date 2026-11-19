using System.Security.Cryptography;
using System.Text;

namespace SharpLadder.Content;

// What a practice record derives from its sources rather than states.
internal static class PracticePayload
{
    public const int MaxCodeLine = 86;

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // Over exactly the emitted text, so a reader can recompute it from the record alone.
    public static string Hash(string text) => "sha256:" + Convert.ToHexStringLower(SHA256.HashData(StrictUtf8.GetBytes(text)));

    // Each line over the limit, 1-based, with its length in code points.
    public static IEnumerable<(int Line, int Length)> LongLines(string text) =>
        text.Split('\n')
            .Select((line, index) => (Line: index + 1, Length: ContentIds.SpokenLength(line)))
            .Where(l => l.Length > MaxCodeLine);
}
