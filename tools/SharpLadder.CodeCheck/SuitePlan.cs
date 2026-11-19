namespace SharpLadder.CodeCheck;

// One subject's suite as the checker runs it, copied from the compiler's plan: the starter and the
// suite text, the declared check count and the review keys its reference must record.
internal sealed record SuitePlan(
    string Subject,
    bool IsDrill,
    string SourceFile,
    string SuiteFile,
    string Starter,
    string Suite,
    int Count,
    IReadOnlyList<string> ReviewKeys);
