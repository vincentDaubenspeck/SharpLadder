using System.Collections.Immutable;

namespace SharpLadder.CodeCheck;

// Runs each subject's suite against its starter, its reference and then each wrong solution, one
// child at a time through the shared lifecycle, subjects in id order. A suite reports on standard
// output, which the parser reads as it is drained; its results file holds the start record alone.
internal sealed class SuiteRunner(Locations locations, IRunBackend backend, SuiteCompiler compiler, TimeSpan? limit = null)
{
    private readonly TimeSpan _limit = limit ?? RunLimits.Suite;

    // Children started; a solution that does not compile is never run, so it is not counted.
    public int Runs { get; private set; }

    // Content failures are added to the caller's list as they are found. A tool or environment
    // failure throws ToolProblem (exit 2) and ends the check, after the failures already added.
    public void Check(IReadOnlyList<SuitePlan> plans, SolutionSet solutions, List<string> failures)
    {
        foreach (var plan in plans.OrderBy(p => p.Subject, StringComparer.Ordinal))
        {
            var reference = solutions.Reference(plan.Subject);
            var held = Starter(plan, failures);
            held &= Reference(plan, new SuiteSolution(SuiteRunKind.Reference, reference.Display, reference.Text), failures);
            foreach (var wrong in solutions.Wrong(plan.Subject))
            {
                if (!held)
                {
                    failures.Add(SuiteVerdict.NotRun(wrong));
                    continue;
                }

                var solution = new SuiteSolution(SuiteRunKind.Wrong, wrong.Display, wrong.Text);
                if (Build(plan, solution, failures) is { } image && SuiteVerdict.Wrong(solution, RunOne(plan, solution, image), plan.Count) is { } failure)
                {
                    failures.Add(failure);
                }
            }
        }
    }

    // One run of a compiled suite; its tool faults throw before any content rule is applied.
    internal SuiteEnd RunOne(SuitePlan plan, SuiteSolution solution, ImmutableArray<byte> image)
    {
        var lines = new CheckLines(plan.Count);
        Runs++;
        var end = new ChildRun(locations, backend).Run(image, solution.Name, token => ResultReader.StartOnly(token, backend.ReportsProcessGroup), lines.Append, _limit);
        SuiteVerdict.ThrowIfToolFault(solution, end);
        if (end.State is ChildState.Exited)
        {
            try
            {
                lines.End();
            }
            catch (Exception e)
            {
                // The parser is the checker's own, so its fault is never a verdict on the content.
                throw new ToolProblem($"{solution.Name}: its result lines could not be read ({e.GetType().Name}: {e.Message})", e);
            }
        }

        return new SuiteEnd(end.State, lines);
    }

    private ImmutableArray<byte>? Build(SuitePlan plan, SuiteSolution solution, List<string> failures)
    {
        var build = compiler.Compile(plan, solution);
        failures.AddRange(build.Failures);
        return build.Failures.Count > 0 ? null : build.Image;
    }

    // The starter must compile with the suite, be only a stub and not pass.
    private bool Starter(SuitePlan plan, List<string> failures)
    {
        var starter = new SuiteSolution(SuiteRunKind.Starter, plan.SourceFile, plan.Starter);
        var build = compiler.Compile(plan, starter);
        if (build.Failures.Count > 0)
        {
            failures.AddRange(build.Failures);
            return false;
        }

        var shape = StarterShape.Problems(build.Solution);
        if (shape.Count > 0)
        {
            failures.AddRange(shape.Select(p => $"{starter.Place(p.Line)}: {p.Reason}"));
            return false;
        }

        if (SuiteVerdict.Starter(starter, RunOne(plan, starter, build.Image), plan.Count, _limit) is { } failure)
        {
            failures.Add(failure);
            return false;
        }

        return true;
    }

    private bool Reference(SuitePlan plan, SuiteSolution reference, List<string> failures)
    {
        if (Build(plan, reference, failures) is not { } image)
        {
            return false;
        }

        var reasons = SuiteVerdict.Reference(plan, reference, RunOne(plan, reference, image), _limit);
        failures.AddRange(reasons);
        return reasons.Count == 0;
    }
}
