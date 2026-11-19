using System.Collections.Immutable;
using Microsoft.CodeAnalysis;

namespace SharpLadder.CodeCheck.Tests;

// The live reference set, only ever read, loaded once for a test class as the checker loads it once
// for a run.
public sealed class CompilerFixture : IDisposable
{
    private readonly ReferenceSet _set = ReferenceSet.Load(Locations.FromRepository(Checker.RepositoryRoot));

    public CompilerFixture()
    {
        Compiler = new GroupCompiler(_set.References);
        Descendants = new GroupCompiler(_set.References, HarnessSource.WithDescendants);
    }

    internal GroupCompiler Compiler { get; }

    // The test-only harness variant, whose relaunched processes become a group's descendants.
    internal GroupCompiler Descendants { get; }

    internal ImmutableArray<MetadataReference> References => _set.References;

    public void Dispose() => _set.Dispose();
}
