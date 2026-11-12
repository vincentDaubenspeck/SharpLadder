namespace SharpLadder.Content;

public sealed class ErrorFrontMatter
{
    public string? Id { get; set; }

    public string? Kind { get; set; }

    public string? Code { get; set; }

    public string? Wrote { get; set; }

    public string? Got { get; set; }

    public IList<string?>? See { get; set; }
}
