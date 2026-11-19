using Xunit;
using Xunit.Sdk;

namespace SharpLadder.CodeCheck.Tests;

// Groups run through the shared runner with this OS's backend. Only Linux and Windows have one, so
// elsewhere a run test is skipped, never passed.
internal static class Runs
{
    public const string File = "chapters/run/blocks.md";

    public const string NoBackend = "code groups run only on Linux and Windows";

    public static SourceBlock Block(string id, int fence, string source, string? group = null, string? check = null, string? throws = null) =>
        new(File, id, group ?? id, File, fence, fence + 1, null, source, check, throws, null, "Section", fence);

    public static CompiledGroup Compile(GroupCompiler compiler, params SourceBlock[] blocks)
    {
        var assembled = Assembler.Assemble(blocks);
        Assert.Empty(assembled.Failures);
        return Ready(compiler, Assert.Single(assembled.Groups));
    }

    public static CompiledGroup Ready(GroupCompiler compiler, GroupProgram program)
    {
        var outcome = compiler.Compile(program);
        Assert.Empty(outcome.Failures);
        return Assert.IsType<CompiledGroup>(outcome.Ready);
    }

    public static string? Run(GroupCompiler compiler, params SourceBlock[] blocks) => Run(Compile(compiler, blocks));

    public static string? Run(CompiledGroup group, IRunBackend? backend = null) =>
        new GroupRunner(Locations.FromRepository(Checker.RepositoryRoot), backend ?? Backend()).Run(group)?.ToString();

    public static IRunBackend Backend()
    {
        if (OperatingSystem.IsWindows())
        {
            return new WindowsBackend();
        }

        return OperatingSystem.IsLinux() ? new LinuxBackend() : throw SkipException.ForSkip(NoBackend);
    }

    public static void RequireBackend() => Assert.SkipUnless(OperatingSystem.IsWindows() || OperatingSystem.IsLinux(), NoBackend);
}
