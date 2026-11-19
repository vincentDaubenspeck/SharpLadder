namespace SharpLadder.Content;

// A block belongs to one approach, named by its id, or explicitly to none; a label, title,
// position or the picker's choice never decides it.
internal abstract record BlockOwner
{
    private BlockOwner()
    {
    }

    public static BlockOwner Outside { get; } = new OutsideApproach();

    public sealed record InApproach(string ApproachId) : BlockOwner;

    public sealed record OutsideApproach : BlockOwner;
}
