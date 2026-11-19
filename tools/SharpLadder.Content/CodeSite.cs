namespace SharpLadder.Content;

// A csharp block with what only its parse knows: where its fence and code start, and its owner.
internal sealed record CodeSite(CodeNode Node, int FenceLine, int SourceLine, BlockOwner Owner, ContainerKind Container);
