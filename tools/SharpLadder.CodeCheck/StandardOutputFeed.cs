namespace SharpLadder.CodeCheck;

// Hands the drained standard output to a run's sink, never more than the cap: past it the run has
// failed whatever was written, and the drain goes on only so the child never blocks on a full pipe.
// A sink that throws is fed nothing more; its fault is reported once both readers have ended.
internal sealed class StandardOutputFeed(OutputSink sink)
{
    private long _fed;
    private Exception? _fault;

    // Group runs judge only their results file.
    public static OutputSink Discard { get; } = static _ => { };

    // Called only by the standard output drain, one chunk at a time.
    public void Write(ReadOnlySpan<byte> chunk)
    {
        var room = RunLimits.OutputCapBytes - _fed;
        if (Volatile.Read(ref _fault) is not null || room <= 0)
        {
            return;
        }

        var part = chunk.Length <= room ? chunk : chunk[..(int)room];
        _fed += part.Length;
        try
        {
            sink(part);
        }
        catch (Exception e)
        {
            // Any exception from the sink is the checker's own fault, so the run ends as a tool fault.
            Volatile.Write(ref _fault, e);
        }
    }

    // Called after both readers have ended, so every chunk has been handed on or has faulted.
    public void ThrowIfFaulted()
    {
        if (Volatile.Read(ref _fault) is { } fault)
        {
            throw new ToolProblem($"the code group's standard output could not be read ({fault.GetType().Name}: {fault.Message})", fault);
        }
    }
}
