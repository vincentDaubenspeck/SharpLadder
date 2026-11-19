using System.Collections.Immutable;

namespace SharpLadder.CodeCheck;

// What a run needs: the assembly with its embedded PDB, the group's blocks and span map, the checks
// that must pass in order and the resolved throws expectation, if any. SourceFile and FirstLine
// place group-level failures; the run order is the assembler's.
internal sealed record CompiledGroup(GroupProgram Program, ImmutableArray<byte> Image, ThrowsExpectation? Throws)
{
    public string SourceFile => Program.Blocks[0].SourceFile;

    public int FirstLine => Program.Blocks[0].SourceLine;

    public IReadOnlyList<string> ExpectedChecks => Program.ExpectedChecks;
}
