namespace SharpLadder.CodeCheck;

// Receives a child's standard output chunk by chunk, in arrival order, on the drain's own thread.
internal delegate void OutputSink(ReadOnlySpan<byte> chunk);
