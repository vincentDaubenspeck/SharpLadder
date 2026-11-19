using System.Diagnostics;

namespace SharpLadder.CodeCheck;

// Measured on the monotonic clock, so a change of the wall clock neither stretches nor cuts it.
internal sealed class Deadline
{
    private readonly long _start;
    private readonly TimeSpan _length;

    private Deadline(TimeSpan length)
    {
        _start = Stopwatch.GetTimestamp();
        _length = length;
    }

    public TimeSpan Remaining
    {
        get
        {
            var left = _length - Stopwatch.GetElapsedTime(_start);
            return left > TimeSpan.Zero ? left : TimeSpan.Zero;
        }
    }

    public bool Passed => Remaining == TimeSpan.Zero;

    public static Deadline After(TimeSpan length) => new(length);
}
