using System.Globalization;

namespace SharpLadder.Content;

// A walk-it hook is made from its block id and positions alone, so it can name no other block,
// sequence or step, and no text from the source.
internal static class WalkItHooks
{
    /// <summary>The hook of a sequence's intro.</summary>
    /// <param name="blockId">The section-qualified id of the block.</param>
    /// <param name="sequence">The sequence's position from 1.</param>
    /// <returns>The hook ending .s0.</returns>
    public static string Intro(string blockId, int sequence) => Step(blockId, sequence, 0);

    /// <summary>The hook of one step.</summary>
    /// <param name="blockId">The section-qualified id of the block.</param>
    /// <param name="sequence">The sequence's position from 1.</param>
    /// <param name="step">The step's position from 1.</param>
    /// <returns>The hook ending .s and the step's position.</returns>
    public static string Step(string blockId, int sequence, int step) =>
        string.Create(CultureInfo.InvariantCulture, $"{blockId}.{sequence}.s{step}");

    /// <summary>The first id or hook in a block that its position does not issue.</summary>
    /// <param name="block">The compiled block.</param>
    /// <param name="blockId">The id the block's position issues.</param>
    /// <returns>The refusal, or null when every id and hook is its own position's.</returns>
    public static string? Misplaced(WalkItNode block, string blockId)
    {
        if (!string.Equals(block.BlockId, blockId, StringComparison.Ordinal))
        {
            return Problem("block id", block.BlockId, blockId);
        }

        for (var s = 0; s < block.Sequences.Count; s++)
        {
            var sequence = block.Sequences[s];
            var own = Intro(blockId, s + 1);
            if (!string.Equals(sequence.IntroBlockId, own, StringComparison.Ordinal))
            {
                return Problem("hook", sequence.IntroBlockId, own);
            }

            for (var k = 0; k < sequence.Steps.Count; k++)
            {
                own = Step(blockId, s + 1, k + 1);
                if (!string.Equals(sequence.Steps[k].BlockId, own, StringComparison.Ordinal))
                {
                    return Problem("hook", sequence.Steps[k].BlockId, own);
                }
            }
        }

        return null;
    }

    private static string Problem(string what, string found, string own) =>
        $"walk-it {what} {PlainYaml.Shown(found)} is not the one its position issues, {PlainYaml.Shown(own)}";
}
