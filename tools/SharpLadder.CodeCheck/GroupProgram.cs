namespace SharpLadder.CodeCheck;

// One assembled group: its Program.cs text, its blocks in document order, the map of every
// stretch of the text, the block ids whose checks must pass in order, and its throws block.
internal sealed record GroupProgram(
    GroupKey Key,
    string? Approach,
    string Text,
    IReadOnlyList<SourceBlock> Blocks,
    IReadOnlyList<ProgramSpan> Spans,
    IReadOnlyList<string> ExpectedChecks,
    SourceBlock? ThrowsBlock);
