namespace SharpLadder.CodeCheck;

// Groups is empty whenever Failures is not: nothing runs from a partly refused plan.
internal sealed record AssemblyResult(IReadOnlyList<CodeFailure> Failures, IReadOnlyList<GroupProgram> Groups);
