namespace SharpLadder.Content;

/// <summary>A link target admitted by form, kept with its span for the cross-file checks.</summary>
internal sealed record LinkTarget(string Target, string Id, string? Chapter, int Line, LinkSpan? Span = null, TermSpan? Term = null);
