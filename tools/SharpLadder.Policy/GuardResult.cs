namespace SharpLadder.Policy;

internal sealed record GuardResult(IReadOnlyList<string> Problems, IReadOnlyList<string> LoweredRules);
