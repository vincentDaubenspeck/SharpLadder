namespace SharpLadder.CodeCheck;

// A stretch of the generated text; Block is null only for the closing directive and the end record.
internal sealed record ProgramSpan(int Start, int Length, SpanKind Kind, SourceBlock? Block);
