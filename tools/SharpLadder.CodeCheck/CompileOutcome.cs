namespace SharpLadder.CodeCheck;

// A group's verdict before any run. Failures are content failures; Ready is the group to run, and
// is null both for a failed group and for a fail group that passed, which never runs.
internal sealed record CompileOutcome(IReadOnlyList<CodeFailure> Failures, CompiledGroup? Ready);
