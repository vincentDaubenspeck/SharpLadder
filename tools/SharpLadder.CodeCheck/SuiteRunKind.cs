namespace SharpLadder.CodeCheck;

// Which solution a suite run compiles beside the suite; each kind has its own verdict.
internal enum SuiteRunKind
{
    /// <summary>The subject's starter, which the suite must not pass.</summary>
    Starter,

    /// <summary>The subject's reference, which the suite must pass.</summary>
    Reference,

    /// <summary>A wrong solution, which the suite must reject.</summary>
    Wrong,
}
