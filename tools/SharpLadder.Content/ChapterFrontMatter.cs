namespace SharpLadder.Content;

// YamlDotNet fails on any key the front matter types do not declare. Missing fields stay null
// so the schema names them.
public sealed class ChapterFrontMatter
{
    public string? Id { get; set; }

    public string? Slug { get; set; }

    public string? Title { get; set; }

    public int? Order { get; set; }

    public TargetsFrontMatter? Targets { get; set; }
}
