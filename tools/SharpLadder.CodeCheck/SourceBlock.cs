namespace SharpLadder.CodeCheck;

// The checker's copy of one executable block (see ExecutableBlock). Approach is the owning
// approach's id, or null for the compiler's explicit outside-approach owner; a label, title,
// index or the picker never sets it. Container names the content container kind.
internal sealed record SourceBlock(
    string DocumentId,
    string BlockId,
    string Group,
    string SourceFile,
    int FenceLine,
    int SourceLine,
    string? Approach,
    string Source,
    string? Check,
    string? Throws,
    string? Fail,
    string Container,
    int DocumentOrder);
