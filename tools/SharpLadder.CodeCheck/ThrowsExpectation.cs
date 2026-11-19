namespace SharpLadder.CodeCheck;

// The throws block and the type its name resolved to there, for failure lines only: the child
// judges identity by comparing runtime types. Assembly is null when the block has no marker.
internal sealed record ThrowsExpectation(SourceBlock Block, string TypeName, string? Assembly);
