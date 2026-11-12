using YamlDotNet.Serialization;

namespace SharpLadder.Content;

public sealed class GlossaryFrontMatter
{
    public string? Id { get; set; }

    public string? Term { get; set; }

    [YamlMember(Alias = "short")]
    public string? Brief { get; set; }

    public IList<string?>? See { get; set; }
}
