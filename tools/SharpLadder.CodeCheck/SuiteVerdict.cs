using System.Globalization;

namespace SharpLadder.CodeCheck;

// Judges how a suite run ended (PD 9.2, 13.9). No terminal record is expected: a completed run passes
// only with exit status 0, exactly the declared number of recorded checks, every one passed and
// nothing unrecorded. Tool faults are decided first and for every kind of run alike.
internal static class SuiteVerdict
{
    private const string EdgePrefix = "edge:";

    // A reader fault, or a completed run with the status only the start-up uses, whatever it wrote.
    public static void ThrowIfToolFault(SuiteSolution solution, RunEnd end)
    {
        if (end.Records.Fault is { } fault)
        {
            throw new ToolProblem($"{solution.Name}: {fault.Reason}");
        }

        if (end.State is ChildState.Exited { Status: WireContract.HarnessFailureExit })
        {
            throw new ToolProblem(string.Create(CultureInfo.InvariantCulture, $"{solution.Name}: exited with status {WireContract.HarnessFailureExit}, which only the checker's start-up uses"));
        }
    }

    public static bool Passes(int status, CheckLines lines, int declared) =>
        status == 0 && lines.Checks.Count == declared && lines.Checks.All(c => c.Pass) && lines.Unrecorded == 0;

    // Null when the suite does not pass the starter.
    public static string? Starter(SuiteSolution starter, SuiteEnd end, int declared, TimeSpan limit) => end.State switch
    {
        ChildState.Exited exited when Passes(exited.Status, end.Lines, declared) => $"{starter.Name}: the suite passes the starter",
        ChildState.Exited => null,
        _ => $"{starter.Name}: {Unfinished(end.State, limit)}",
    };

    // Every way the reference falls short, one line each; empty when it passes and names its checks.
    public static IReadOnlyList<string> Reference(SuitePlan plan, SuiteSolution reference, SuiteEnd end, TimeSpan limit)
    {
        if (end.State is not ChildState.Exited exited)
        {
            return [$"{reference.Name}: {Unfinished(end.State, limit)}"];
        }

        var lines = end.Lines;
        var reasons = new List<string>();
        if (exited.Status != 0)
        {
            reasons.Add(string.Create(CultureInfo.InvariantCulture, $"the suite exited with status {exited.Status}"));
        }

        if (lines.Checks.Count != plan.Count)
        {
            reasons.Add(string.Create(CultureInfo.InvariantCulture, $"the suite recorded {lines.Checks.Count} of its {plan.Count} declared checks"));
        }

        reasons.AddRange(lines.Checks.Where(c => !c.Pass).Select(c => $"check \"{c.Name}\" fails"));
        if (lines.Unrecorded > 0)
        {
            reasons.Add(string.Create(CultureInfo.InvariantCulture, $"{lines.Unrecorded} result lines were not recorded: past the declared count or with a name over {CheckLines.MaxNameLength} characters"));
        }

        if (lines.Checks.Any(c => c.Name.Length == 0))
        {
            reasons.Add("a check has an empty name");
        }

        var names = lines.Checks.Select(c => c.Name).Where(n => n.Length > 0).ToList();
        reasons.AddRange(names.GroupBy(n => n, StringComparer.Ordinal).Where(g => g.Count() > 1).Select(g => $"check \"{g.Key}\" is recorded more than once"));
        if (plan.IsDrill && !names.Any(n => n.StartsWith(EdgePrefix, StringComparison.Ordinal)))
        {
            reasons.Add($"no check name starts with \"{EdgePrefix}\", which a drill's suite needs");
        }

        reasons.AddRange(plan.ReviewKeys.Where(k => !names.Contains(k, StringComparer.Ordinal)).Select(k => $"tests.review names \"{k}\", which the suite did not record"));
        return [.. reasons.Select(r => $"{reference.Name}: {r}")];
    }

    // Null when the suite rejects the wrong solution: a failed check, a missing line, a nonzero exit
    // or the deadline. Past the cap the rejection is not established.
    public static string? Wrong(SuiteSolution wrong, SuiteEnd end, int declared) => end.State switch
    {
        ChildState.Exited exited when Passes(exited.Status, end.Lines, declared) => $"{wrong.Name}: the suite passes this wrong solution",
        ChildState.CapPassed cap => $"{wrong.Name}: {Capped(cap)}, so its rejection is not established",
        _ => null,
    };

    public static string NotRun(SolutionFile wrong) => $"{wrong.Display}: not run, because the starter or the reference of {wrong.Subject} failed";

    private static string Unfinished(ChildState state, TimeSpan limit) => state is ChildState.CapPassed cap
        ? Capped(cap)
        : string.Create(CultureInfo.InvariantCulture, $"the suite run did not end within {limit.TotalSeconds} s");

    private static string Capped(ChildState.CapPassed cap) =>
        string.Create(CultureInfo.InvariantCulture, $"the suite run wrote more than {RunLimits.OutputCapBytes / 1024} KiB to {GroupVerdict.Name(cap.Stream)}");
}
