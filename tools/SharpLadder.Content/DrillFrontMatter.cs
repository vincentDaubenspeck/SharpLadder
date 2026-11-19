using YamlDotNet.Serialization;

namespace SharpLadder.Content;

// YamlDotNet fails on any key not declared here, so a problem field or an authored hash cannot pass.
public sealed class DrillFrontMatter
{
    private string? _variationOf;

    public string? Id { get; set; }

    public string? Chapter { get; set; }

    public string? Rung { get; set; }

    public string? Title { get; set; }

    public string? Type { get; set; }

    public IList<string?>? Ideas { get; set; }

    public IList<string?>? Prerequisites { get; set; }

    public IList<string?>? Prepares { get; set; }

    // Null is a stated value here, so whether the key was written is kept apart from its value.
    public string? VariationOf
    {
        get => _variationOf;
        set => (_variationOf, VariationOfStated) = (value, true);
    }

    [YamlIgnore]
    public bool VariationOfStated { get; private set; }

    public IList<string?>? Ladders { get; set; }

    public SuiteFrontMatter? Tests { get; set; }

    public string? Reference { get; set; }
}
