namespace SharpLadder.Content;

/// <summary>A link target admitted by form, kept for the same-file anchor check.</summary>
internal sealed record LinkTarget(string Target, string Id, string? Chapter, int Line);
