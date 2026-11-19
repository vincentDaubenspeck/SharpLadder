namespace SharpLadder.CodeCheck;

// What a wait on the child saw: still running when the wait ran out, the direct child's exit
// status, or a stream that passed its cap, which ends the run as soon as it is seen.
internal abstract record ChildState
{
    public static ChildState Running { get; } = new StillRunning();

    internal sealed record StillRunning : ChildState;

    internal sealed record Exited(int Status) : ChildState;

    internal sealed record CapPassed(OutputStream Stream) : ChildState;
}
