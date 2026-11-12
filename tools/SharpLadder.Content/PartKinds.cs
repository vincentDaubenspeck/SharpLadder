namespace SharpLadder.Content;

// The part kinds the compiler reads; a kind outside this list is refused before any schema runs.
internal static class PartKinds
{
    public const string Cards = "cards";

    public const string Build = "build";

    public const string Drill = "drill";

    public const string Hints = "hints";

    public static readonly IReadOnlyList<string> Names = ["syntax", "build", "idioms", "gotchas", "library", Cards, Drill, Hints];

    public static bool IsAdmitted(string? name) => name is not null && Names.Contains(name, StringComparer.Ordinal);

    public static string Listed() => string.Join(", ", Names);
}
