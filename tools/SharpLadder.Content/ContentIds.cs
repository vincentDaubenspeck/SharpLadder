using System.Text.RegularExpressions;

namespace SharpLadder.Content;

/// <summary>The immutable ID format and the limits shared by headings and code fences.</summary>
internal static partial class ContentIds
{
    // Blocks of a chapter's intro use this prefix, so no heading may take it.
    public const string IntroPrefix = "intro";

    public const int MaxSpokenLength = 200;

    public const string FormatRule = "is not lowercase letters, digits and hyphens starting with a letter, at most 48 characters";

    public static bool IsValid(string id) => IdPattern().IsMatch(id);

    [GeneratedRegex(@"^[a-z][a-z0-9-]{0,47}\z", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex IdPattern();
}
