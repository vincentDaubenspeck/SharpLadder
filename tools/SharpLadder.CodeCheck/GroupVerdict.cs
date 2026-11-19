using System.Globalization;

namespace SharpLadder.CodeCheck;

// Completion and exit status judged together: a group passes only on a complete, exact record
// sequence whose terminal record matches the status. Null means the group passed.
internal static class GroupVerdict
{
    public static CodeFailure TimedOut(CompiledGroup group) =>
        GroupLevel(group, string.Create(CultureInfo.InvariantCulture, $"timed out after {RunLimits.Launch.TotalSeconds} s"));

    public static CodeFailure CapPassed(CompiledGroup group, OutputStream stream) =>
        GroupLevel(group, string.Create(CultureInfo.InvariantCulture, $"wrote more than {RunLimits.OutputCapBytes / 1024} KiB to {Name(stream)}"));

    public static string Name(OutputStream stream) => stream == OutputStream.StandardOutput ? "standard output" : "standard error";

    public static CodeFailure? Judge(CompiledGroup group, ResultReader records, int exitStatus)
    {
        if (records.Start is null)
        {
            throw new ToolProblem($"group \"{group.Program.Key.Group}\" of {group.Program.Key.DocumentId}: a verdict was asked for without a start record");
        }

        if (records.Fault is { } fault)
        {
            return GroupLevel(group, fault.Reason);
        }

        if (records.Terminal is not { } terminal)
        {
            return GroupLevel(group, "ended early");
        }

        var endStatus = string.Equals(terminal.Kind, WireContract.EndKind, StringComparison.Ordinal) ? 0 : WireContract.ContentFailureExit;
        if (exitStatus != endStatus)
        {
            return GroupLevel(group, string.Create(CultureInfo.InvariantCulture, $"exited with status {exitStatus} after its {terminal.Kind} record"));
        }

        return terminal.Kind switch
        {
            WireContract.EndKind => group.Throws is { } throws
                ? CodeFailure.At(throws.Block, $"has throws={throws.TypeName}, but it did not throw")
                : null,
            WireContract.CheckFailedKind => CheckFailed(Block(group, terminal.BlockId!)),
            _ => Exception(group, records, terminal),
        };
    }

    private static CodeFailure CheckFailed(SourceBlock block) => CodeFailure.At(block, $"check is false: {block.Check}");

    private static CodeFailure? Exception(CompiledGroup group, ResultReader records, TerminalRecord terminal)
    {
        var actual = terminal.ActualType;
        if (terminal.BlockId is not { } blockId)
        {
            return GroupLevel(group, $"threw {actual} while no block was executing");
        }

        var block = Block(group, blockId);
        if (group.Throws is not { } throws || !string.Equals(throws.Block.BlockId, blockId, StringComparison.Ordinal))
        {
            return new CodeFailure(block.SourceFile, block.SourceLine, block.BlockId, $"threw {actual}, but it is not marked throws");
        }

        if (!terminal.ExactTypeMatch)
        {
            return CodeFailure.At(block, $"has throws={throws.TypeName}, but it threw {actual}");
        }

        // The throws block's own check cannot run once its statement has thrown; every earlier one must have.
        var required = group.ExpectedChecks.Count(id => !string.Equals(id, blockId, StringComparison.Ordinal));
        return records.ChecksRecorded < required
            ? GroupLevel(group, ResultReader.MissingCheck(group.ExpectedChecks[records.ChecksRecorded], terminal.Record))
            : null;
    }

    private static SourceBlock Block(CompiledGroup group, string blockId) =>
        group.Program.Blocks.First(b => string.Equals(b.BlockId, blockId, StringComparison.Ordinal));

    private static CodeFailure GroupLevel(CompiledGroup group, string reason) =>
        new(group.SourceFile, group.FirstLine, group.Program.Blocks[0].BlockId, reason);
}
