using SharpLadder.Content;

namespace SharpLadder.CodeCheck;

// Reads content through the compiler, as the command line does, into the checker's own blocks.
internal static class PlanSource
{
    public static (IReadOnlyList<string> Diagnostics, IReadOnlyList<SourceBlock> Blocks) Read(string schemaFolder, string contentRoot)
    {
        using var schemaRoot = Folder.OpenRoot(schemaFolder, schemaFolder);
        using var root = Folder.OpenRoot(contentRoot, ContentCompiler.DisplayPath(Environment.CurrentDirectory, contentRoot));
        var (schema, problems) = SchemaSet.Load(InputTree.Read(schemaRoot));
        if (schema is null)
        {
            throw new ToolProblem("schema: " + string.Join("; ", problems));
        }

        var plan = ContentCompiler.Plan(InputTree.ReadContent(root), schema);
        return (plan.Diagnostics.Select(d => d.ToString()).ToList(), plan.Blocks.Select(Copy).ToList());
    }

    public static SourceBlock Copy(ExecutableBlock block) => new(
        block.DocumentId,
        block.BlockId,
        block.Group,
        block.SourceFile,
        block.FenceLine,
        block.SourceLine,
        block.Owner switch
        {
            BlockOwner.InApproach owned => owned.ApproachId,
            BlockOwner.OutsideApproach => null,
            _ => throw new ToolProblem("a code block has an owner this checker does not know"),
        },
        block.Source,
        block.Check,
        block.Throws,
        block.Fail,
        block.ContainerKind.ToString(),
        block.DocumentOrder);
}
