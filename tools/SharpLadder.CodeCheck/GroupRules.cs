namespace SharpLadder.CodeCheck;

// The restrictions that hold once blocks are grouped; a type-only tail must stay a tail, so no
// marker, check or statement ever follows a type declaration.
internal static class GroupRules
{
    public static void Check(GroupKey key, IReadOnlyList<SourceBlock> blocks, IReadOnlyList<BlockShape> shapes, List<CodeFailure> failures)
    {
        for (var i = 0; i < blocks.Count; i++)
        {
            var block = blocks[i];
            var shape = shapes[i];
            if (shape.HoldsLineDirective)
            {
                failures.Add(CodeFailure.At(block, "holds a #line directive; a block cannot move the mapping of its own lines"));
            }

            // A fail block is its group's only block and never runs, so an open end may be its lesson.
            if (shape.RunsPastEnd && block.Fail is null)
            {
                failures.Add(CodeFailure.At(block, "runs past its own end (an open statement, brace, comment, string or #if); a block must be complete code"));
            }

            if (block.Throws is not null && i < blocks.Count - 1)
            {
                failures.Add(CodeFailure.At(block, $"has throws but is not the last block of its group \"{key.Group}\""));
            }

            if (shape.Declares && block.Check is not null)
            {
                failures.Add(CodeFailure.At(block, "declares a type and has a check; a block that declares a type carries no check"));
            }

            if (shape.Declares && Enumerable.Range(i + 1, blocks.Count - i - 1).Any(j => shapes[j].FirstStatement is not null || blocks[j].Check is not null))
            {
                failures.Add(CodeFailure.At(block, $"declares a type, but a later block of its group \"{key.Group}\" holds statements or a check; type declarations go in the final blocks"));
            }

            if (block.Fail is not null && blocks.Count > 1)
            {
                failures.Add(CodeFailure.At(block, $"has fail but its group \"{key.Group}\" holds other blocks; a fail block is a group of its own"));
            }
        }
    }
}
