namespace SharpLadder.Content;

// What the code check runs, taken from the compilation itself: the compiled JSON keeps no source
// line or owner. Blocks is empty whenever Diagnostics is not.
internal sealed record ExecutionPlan(IReadOnlyList<Diagnostic> Diagnostics, IReadOnlyList<ExecutableBlock> Blocks);
