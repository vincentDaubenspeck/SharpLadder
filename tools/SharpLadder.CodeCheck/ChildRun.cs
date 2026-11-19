using System.Collections.Immutable;
using System.Globalization;

namespace SharpLadder.CodeCheck;

// The lifecycle every compiled child shares, from launch to the deleted run folder: the start record
// polled for, the identity checked, the release, the wait, and cleanup on every path before a result
// or a tool failure leaves. Compilation is done before the one deadline starts; callers judge the end.
internal sealed class ChildRun(Locations locations, IRunBackend backend)
{
    private const string AssemblyFile = "SharpLadderCodeGroup.dll";
    private const string ConfigFile = "SharpLadderCodeGroup.runtimeconfig.json";
    private const string ResultsName = "results.jsonl";
    private static readonly TimeSpan DeletionPause = TimeSpan.FromMilliseconds(10);

    // Subject names the run in tool failures; the reader is made for this run's token. A tool or
    // environment failure throws ToolProblem (exit 2).
    public RunEnd Run(ImmutableArray<byte> image, string subject, Func<string, ResultReader> reader, OutputSink output, TimeSpan limit)
    {
        var folder = Directory.CreateTempSubdirectory("sharpladder-run-").FullName;
        try
        {
            return RunIn(folder, image, subject, reader, output, limit);
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

    private static OutputStream? CleanUp(IRunningChild child)
    {
        var cleanup = Deadline.After(RunLimits.Cleanup);
        child.Terminate(cleanup);
        return child.AwaitReaders(cleanup);
    }

    private static string NoStart(ResultReader records, ChildState state, TimeSpan limit) => state switch
    {
        _ when records.Fault is { } fault => fault.Reason,
        ChildState.Exited exited => string.Create(CultureInfo.InvariantCulture, $"exited with status {exited.Status} before its start record"),
        ChildState.CapPassed cap => string.Create(CultureInfo.InvariantCulture, $"wrote more than {RunLimits.OutputCapBytes / 1024} KiB to {GroupVerdict.Name(cap.Stream)} before its start record"),
        _ => string.Create(CultureInfo.InvariantCulture, $"wrote no start record within {limit.TotalSeconds} s"),
    };

    private RunEnd RunIn(string folder, ImmutableArray<byte> image, string subject, Func<string, ResultReader> reader, OutputSink output, TimeSpan limit)
    {
        var assembly = Path.Combine(folder, AssemblyFile);
        var config = Path.Combine(folder, ConfigFile);
        var resultsPath = Path.Combine(folder, ResultsName);
        File.WriteAllBytes(assembly, image.AsSpan());
        File.WriteAllBytes(config, RuntimeConfig.Json(locations.RuntimeVersion));

        var token = RunToken.Create();
        var launch = new ChildLaunch(locations.Muxer, LaunchLine.Arguments(config, assembly), folder, ChildEnvironment.Build(token, resultsPath));
        var records = reader(token);
        using var results = new ResultsFile(resultsPath);

        var deadline = Deadline.After(limit);
        using var child = backend.Start(launch, output);
        ChildState end;
        try
        {
            end = Supervise(child, subject, records, results, deadline, token, limit);
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
                return new RunEnd(new ChildState.CapPassed(stream), records);
            case ChildState.Exited:
                results.ReadInto(records);
                records.Complete();
                return new RunEnd(end, records);
            default:
                return new RunEnd(end, records);
        }
    }

    // Start-up, release and execution share the one deadline; the first record is polled for.
    private ChildState Supervise(IRunningChild child, string subject, ResultReader records, ResultsFile results, Deadline deadline, string token, TimeSpan limit)
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
            throw new ToolProblem($"{subject}: {NoStart(records, state, limit)}");
        }

        CheckStart(child, subject, start);
        if (state is not ChildState.StillRunning)
        {
            throw new ToolProblem($"{subject}: ended before its release");
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
    private void CheckStart(IRunningChild child, string subject, StartRecord start)
    {
        if (start.ProcessId != child.ProcessId)
        {
            throw new ToolProblem(string.Create(CultureInfo.InvariantCulture, $"{subject}: its start record names pid {start.ProcessId}, but the checker started pid {child.ProcessId}"));
        }

        if (backend.ReportsProcessGroup && (start.ProcessGroup != child.ProcessId || start.Session != child.ProcessId))
        {
            throw new ToolProblem(string.Create(CultureInfo.InvariantCulture, $"{subject}: its start record names process group {start.ProcessGroup} and session {start.Session}, not its own pid {child.ProcessId}"));
        }

        var expectedRuntime = backend.Canonical(locations.RuntimeDirectory);
        var observed = backend.Canonical(start.CoreLibraryDirectory);
        if (!string.Equals(observed, expectedRuntime, StringComparison.Ordinal))
        {
            throw new ToolProblem($"{subject}: it loaded its core library from {observed}, not from {expectedRuntime}");
        }
    }
}
