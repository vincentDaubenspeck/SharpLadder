using System.Collections.Immutable;
using Microsoft.CodeAnalysis;

namespace SharpLadder.CodeCheck;

// A suite run's compilation: the content failures, one printed line each, or the image to run. The
// solution's model binds names in the whole compilation, as the starter's shape check needs.
internal sealed record SuiteBuild(IReadOnlyList<string> Failures, ImmutableArray<byte> Image, SemanticModel Solution);
