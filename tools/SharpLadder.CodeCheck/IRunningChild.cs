namespace SharpLadder.CodeCheck;

// A started child. From Start on, the backend drains standard output and standard error
// concurrently, counting each against RunLimits.OutputCapBytes, and hands standard output up to
// that cap to the sink it was started with. A failure of the OS, of a proof or of the sink throws
// ToolProblem; the runner then cleans up, and the run exits 2.
internal interface IRunningChild : IDisposable
{
    int ProcessId { get; }

    // The start record passed validation: cleanup from here on covers the verified group.
    void Verified(StartRecord start);

    // Writes the release line to standard input and closes it, leaving content at end of input.
    void Release(byte[] line);

    // Returns at the direct child's exit or a passed cap, or Running once the timeout has elapsed.
    ChildState Wait(TimeSpan timeout);

    // Called on every path: kills what remains, proves death and reaps the direct child in time.
    void Terminate(Deadline cleanup);

    // Called after Terminate, so the readers can finish; the stream that passed its cap, if any.
    // On return the sink has received every chunk it will ever receive.
    OutputStream? AwaitReaders(Deadline cleanup);
}
