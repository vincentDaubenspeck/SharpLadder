using Xunit;
using static SharpLadder.CodeCheck.Tests.Runs;

namespace SharpLadder.CodeCheck.Tests;

// Its own class so a repeat run of the timing-sensitive tests can select it by name.
public sealed class TimeoutTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    [Fact]
    public void InfiniteLoopTimesOut() =>
        Assert.Equal(
            "chapters/run/blocks.md:11 spin timed out after 5 s",
            Run(fixture.Compiler, Block("spin", 10, "var spinning = true;\nwhile (spinning)\n{\n}\n")));
}
