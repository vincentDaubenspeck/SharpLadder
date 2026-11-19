namespace SharpLadder.CodeCheck;

// Runs one compiled group through the shared child lifecycle and judges how it ended. A group's
// verdict comes from its results file alone, so its standard output is drained and discarded.
internal sealed class GroupRunner(Locations locations, IRunBackend backend)
{
    // Null when the group passes. A tool or environment failure throws ToolProblem (exit 2).
    public CodeFailure? Run(CompiledGroup group)
    {
        var end = new ChildRun(locations, backend).Run(
            group.Image,
            $"group \"{group.Program.Key.Group}\" of {group.Program.Key.DocumentId}",
            token => new ResultReader(token, group, backend.ReportsProcessGroup),
            StandardOutputFeed.Discard,
            RunLimits.Launch);
        return end.State switch
        {
            ChildState.Exited exited => GroupVerdict.Judge(group, end.Records, exited.Status),
            ChildState.CapPassed cap => GroupVerdict.CapPassed(group, cap.Stream),
            _ => GroupVerdict.TimedOut(group),
        };
    }
}
