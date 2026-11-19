namespace SharpLadder.CodeCheck;

// One program per (document, group), in one fixed order (document path, then first fence line) so
// every run takes the same order. Ownership is settled for every group before anything is
// assembled; a group of mixed owners is refused whole, never split, merged or resolved.
internal static class Assembler
{
    public static AssemblyResult Assemble(IReadOnlyList<SourceBlock> blocks)
    {
        var groups = blocks
            .GroupBy(b => new GroupKey(b.DocumentId, b.Group))
            .Select(g => g.OrderBy(b => b.DocumentOrder).ToList())
            .OrderBy(g => g[0].DocumentId, StringComparer.Ordinal)
            .ThenBy(g => g[0].FenceLine)
            .ToList();

        var mixed = groups
            .Where(g => g.Select(b => b.Approach).Distinct(StringComparer.Ordinal).Skip(1).Any())
            .SelectMany(g => g.Select(b => CodeFailure.At(b, $"group \"{b.Group}\" mixes owners; this block belongs to {Owner(b)}")))
            .ToList();
        if (mixed.Count > 0)
        {
            return new AssemblyResult(mixed, []);
        }

        var failures = new List<CodeFailure>();
        var programs = new List<GroupProgram>();
        foreach (var members in groups)
        {
            if (ProgramGenerator.Generate(new GroupKey(members[0].DocumentId, members[0].Group), members, failures) is { } program)
            {
                programs.Add(program);
            }
        }

        return failures.Count > 0 ? new AssemblyResult(failures, []) : new AssemblyResult([], programs);
    }

    private static string Owner(SourceBlock block) => block.Approach is { } id ? $"approach \"{id}\"" : "no approach";
}
