namespace SharpLadder.Content;

// DocumentId is the source path under the content root, SourceFile that path as diagnostics show
// it. Lines are 1-based: FenceLine is the opening fence, SourceLine the first code line.
// DocumentOrder counts the csharp blocks of one document from 0, in source order.
internal sealed record ExecutableBlock(
    string DocumentId,
    string BlockId,
    string Group,
    string SourceFile,
    int FenceLine,
    int SourceLine,
    BlockOwner Owner,
    string Source,
    string? Check,
    string? Throws,
    string? Fail,
    ContainerKind ContainerKind,
    int DocumentOrder);
