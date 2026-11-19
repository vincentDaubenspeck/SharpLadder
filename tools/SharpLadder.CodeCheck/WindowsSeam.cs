namespace SharpLadder.CodeCheck;

// Started reports the direct child's pid as soon as it exists, so a test can prove it dead.
internal sealed record WindowsSeam(WindowsFault Fault, Action<int>? Started = null)
{
    public static WindowsSeam None { get; } = new(WindowsFault.None);
}
