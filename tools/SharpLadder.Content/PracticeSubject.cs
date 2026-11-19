namespace SharpLadder.Content;

// One problem or drill as the code check runs it: the starter is never an executable block, so
// it reaches the check only here, beside its suite.
internal sealed record PracticeSubject(
    string Id,
    RecordKind Kind,
    string SourceFile,
    string Starter,
    string Suite,
    int Count,
    IReadOnlyList<string> ReviewKeys)
{
    // A drill's reference must also record an edge: check.
    public bool IsDrill => Kind == RecordKind.Drill;
}
