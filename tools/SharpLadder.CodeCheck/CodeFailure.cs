using System.Globalization;

namespace SharpLadder.CodeCheck;

// One content failure, printed as file:line block-id reason.
internal sealed record CodeFailure(string File, int Line, string BlockId, string Reason)
{
    public static CodeFailure At(SourceBlock block, string reason) => new(block.SourceFile, block.FenceLine, block.BlockId, reason);

    public override string ToString() => string.Create(CultureInfo.InvariantCulture, $"{File}:{Line} {BlockId} {Reason}");
}
