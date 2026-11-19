namespace SharpLadder.Content;

// The hash is derived from the suite file, so an authored one is an unknown key.
public sealed class SuiteFrontMatter
{
    public string? File { get; set; }

    public int? Version { get; set; }

    public int? Count { get; set; }

    public IDictionary<string, ReviewFrontMatter?>? Review { get; set; }
}
