namespace SharpLadder.CodeCheck;

// The reference root as read: every subject's reference and wrong solutions in file-name order, or
// the content failures, one printed line each. Files is empty whenever Failures is not.
internal sealed record SolutionSet(IReadOnlyList<string> Failures, IReadOnlyList<SolutionFile> Files)
{
    public SolutionFile Reference(string subject) =>
        Files.Single(f => string.Equals(f.Subject, subject, StringComparison.Ordinal) && f.Kind is null);

    public IReadOnlyList<SolutionFile> Wrong(string subject) =>
        [.. Files.Where(f => string.Equals(f.Subject, subject, StringComparison.Ordinal) && f.Kind is not null)];
}
