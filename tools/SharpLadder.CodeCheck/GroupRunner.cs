using System.Globalization;

namespace SharpLadder.CodeCheck;

// Runs one compiled group on an OS backend, from launch to verdict. Compilation is done before the
// one launch deadline starts; cleanup runs on every path before a verdict or a tool failure leaves.
internal sealed class GroupRunner(Locations locations, IRunBackend backend)
{
    private const string AssemblyFile = "SharpLadderCodeGroup.dll";
    private const string ConfigFile = "SharpLadderCodeGroup.runtimeconfig.json";
    private const string ResultsName = "results.jsonl";
    private static readonly TimeSpan DeletionPause = TimeSpan.FromMilliseconds(10);

    // Null when the group passes. A tool or environment failure throws ToolProblem (exit 2).
    public CodeFailure? Run(CompiledGroup group)
    {
        var folder = Directory.CreateTempSubdirectory("sharpladder-run-").FullName;
        try
        {
            return RunIn(folder, group);
        }
        finally
        {
            DeleteRunFolder(folder, Deadline.After(RunLimits.Cleanup));
        }
    }

    // Deletion can briefly fail after process cleanup has completed.
    internal static void DeleteRunFolder(string folder, Deadline deadline)
    {
        while (true)
        {
            Exception failure;
            try
            {
                Directory.Delete(folder, recursive: true);
                return;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                failure = e;
            }

            if (!deadline.Passed)
            {
                var left = deadline.Remaining;
                Thread.Sleep(left < DeletionPause ? left : DeletionPause);
            }

            if (deadline.Passed)
            {
                throw new ToolProblem($"the run folder {folder} could not be deleted: {failure.GetType().Name}: {failure.Message}", failure);
            }
        }
    }

    private static ToolProblem Problem(CompiledGroup group, string what) =>
        new($"group \"{group.Program.Key.Group}\" of {group.Program.Key.DocumentId}: {what}");

    private static OutputStream? CleanUp(IRunningChild child)
    {
        var cleanup = Deadline.After(RunLimits.Cleanup);
        child.Terminate(cleanup);
        return child.AwaitReaders(cleanup);
    }

    private static string NoStart(ResultReader records, ChildState state) => state switch
    {
        _ when records.Fault is { } fault => fault.Reason,
        ChildState.Exited exited => string.Create(CultureInfo.InvariantCulture, $"exited with status {exited.Status} before its start record"),
        ChildState.CapPassed cap => string.Create(CultureInfo.InvariantCulture, $"wrote more than {RunLimits.OutputCapBytes / 1024} KiB to {GroupVerdict.Name(cap.Stream)} before its start record"),
        _ => string.Create(CultureInfo.InvariantCulture, $"wrote no start record within {RunLimits.Launch.TotalSeconds} s"),
    };

    private CodeFailure? RunIn(string folder, CompiledGroup group)
    {
        var assembly = Path.Combine(folder, AssemblyFile);
        var config = Path.Combine(folder, ConfigFile);
        var resultsPath = Path.Combine(folder, ResultsName);
        File.WriteAllBytes(assembly, group.Image.AsSpan());
        File.WriteAllBytes(config, RuntimeConfig.Json(locations.RuntimeVersion));

        var token = RunToken.Create();
        var launch = new ChildLaunch(locations.Muxer, LaunchLine.Arguments(config, assembly), folder, ChildEnvironment.Build(token, resultsPath));
        var records = new ResultReader(token, group, backend.ReportsProcessGroup);
        using var results = new ResultsFile(resultsPath);

        var deadline = Deadline.After(RunLimits.Launch);
        using var child = backend.Start(launch);
        ChildState end;
        try
        {
            end = Supervise(child, group, records, results, deadline, token);
        }
        catch
        {
            CleanUp(child);
            throw;
        }

        var capped = CleanUp(child);
        switch (end)
        {
            case ChildState.Exited when capped is { } stream:
                return GroupVerdict.CapPassed(group, stream);
            case ChildState.Exited exited:
                results.ReadInto(records);
                records.Complete();
                return GroupVerdict.Judge(group, records, exited.Status);
            case ChildState.CapPassed cap:
                return GroupVerdict.CapPassed(group, cap.Stream);
            default:
                return GroupVerdict.TimedOut(group);
        }
    }

    // Start-up, release and execution share the one deadline; the first record is polled for.
    private ChildState Supervise(IRunningChild child, CompiledGroup group, ResultReader records, ResultsFile results, Deadline deadline, string token)
    {
        var state = ChildState.Running;
        while (true)
        {
            results.ReadInto(records);
            if (records.Start is not null || records.Fault is not null || state is not ChildState.StillRunning || deadline.Passed)
            {
                break;
            }

            var poll = deadline.Remaining < WireContract.FirstRecordPoll ? deadline.Remaining : WireContract.FirstRecordPoll;
            state = child.Wait(poll);
        }

        if (records.Start is not { } start)
        {
            throw Problem(group, NoStart(records, state));
        }

        CheckStart(child, group, start);
        if (state is not ChildState.StillRunning)
        {
            throw Problem(group, "ended before its release");
        }

        child.Verified(start);
        child.Release(RunToken.ReleaseLine(token));
        do
        {
            state = child.Wait(deadline.Remaining);
        }
        while (state is ChildState.StillRunning && !deadline.Passed);

        return state;
    }

    // The expected directory is the checker's own; the child supplies only what it observed. It is
    // resolved only now, so a missing runtime is refused by the launch itself, never by a guess here.
    private void CheckStart(IRunningChild child, CompiledGroup group, StartRecord start)
    {
        if (start.ProcessId != child.ProcessId)
        {
            throw Problem(group, string.Create(CultureInfo.InvariantCulture, $"its start record names pid {start.ProcessId}, but the checker started pid {child.ProcessId}"));
        }

        if (backend.ReportsProcessGroup && (start.ProcessGroup != child.ProcessId || start.Session != child.ProcessId))
        {
            throw Problem(group, string.Create(CultureInfo.InvariantCulture, $"its start record names process group {start.ProcessGroup} and session {start.Session}, not its own pid {child.ProcessId}"));
        }

        var expectedRuntime = backend.Canonical(locations.RuntimeDirectory);
        var observed = backend.Canonical(start.CoreLibraryDirectory);
        if (!string.Equals(observed, expectedRuntime, StringComparison.Ordinal))
        {
            throw Problem(group, $"it loaded its core library from {observed}, not from {expectedRuntime}");
        }
    }
}
