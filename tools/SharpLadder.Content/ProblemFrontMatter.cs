namespace SharpLadder.Content;

// YamlDotNet fails on any key not declared here, so a drill field or an authored hash cannot pass.
public sealed class ProblemFrontMatter
{
    public string? Id { get; set; }

    public string? Chapter { get; set; }

    public int? Number { get; set; }

    public string? Link { get; set; }

    public string? Title { get; set; }

    public IList<string?>? PatternTags { get; set; }

    public IList<string?>? Ladders { get; set; }

    public SuiteFrontMatter? Tests { get; set; }

    public string? Reference { get; set; }

    public string? ParaphraseCheckedAt { get; set; }
}
