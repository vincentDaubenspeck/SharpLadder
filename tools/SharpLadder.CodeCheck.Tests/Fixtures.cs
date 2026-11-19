using Xunit;

namespace SharpLadder.CodeCheck.Tests;

internal static class Fixtures
{
    public static string Root(string name) => Path.Combine(Checker.RepositoryRoot, "tools", "SharpLadder.CodeCheck.Tests", "fixtures", name);

    // A fixture root the compiler accepts, assembled; also returns the root as diagnostics show it.
    public static (string Shown, IReadOnlyList<GroupProgram> Groups) Assemble(string name)
    {
        var root = Root(name);
        var (diagnostics, blocks) = PlanSource.Read(Checker.SchemaFolder, root);
        Assert.Empty(diagnostics);
        var result = Assembler.Assemble(blocks);
        Assert.Empty(result.Failures);
        return (Checker.Shown(root), result.Groups);
    }

    public static GroupProgram Single(IReadOnlyList<GroupProgram> groups, string documentId, string group) =>
        Assert.Single(groups, g => g.Key == new GroupKey(documentId, group));

    public static string[] Ids(GroupProgram program) => [.. program.Blocks.Select(b => b.BlockId)];
}
