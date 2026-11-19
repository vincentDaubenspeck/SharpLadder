using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// Classes that set variables in the test process's own environment run apart from every other.
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class Serial
{
    public const string Name = "serial";
}
