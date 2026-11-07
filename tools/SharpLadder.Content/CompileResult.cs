namespace SharpLadder.Content;

internal sealed record CompileResult(IReadOnlyList<Diagnostic> Diagnostics, IReadOnlyList<OutputFile> Files);
