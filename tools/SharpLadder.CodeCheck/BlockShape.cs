namespace SharpLadder.CodeCheck;

// What the parsed group shows of one block. Offsets count from the start of the block's source.
internal sealed record BlockShape(int? FirstStatement, int? FirstDeclaration, bool RunsPastEnd, bool HoldsLineDirective)
{
    public bool Declares => FirstDeclaration is not null;
}
