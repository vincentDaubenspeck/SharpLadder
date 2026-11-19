namespace SharpLadder.CodeCheck;

// Started reports the direct child's pid as soon as it exists, and Signalled each process group just
// before it is killed, so a test can prove every process dead and no unverified group signalled.
internal sealed record LinuxSeam(LinuxFault Fault, Action<int>? Started = null, Action<int>? Signalled = null)
{
    public static LinuxSeam None { get; } = new(LinuxFault.None);
}
