using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace SharpLadder.CodeCheck;

// One group's child on Linux, started through setsid by its explicit path, so it leads a new session
// and process group before the muxer runs. Process keeps the three pipes and closes the checker's
// copies of the child's ends; both output pipes are drained from the start on their own threads,
// counted against the cap and discarded.
[SupportedOSPlatform("linux")]
internal sealed unsafe class LinuxChild : IRunningChild
{
    private const string Setsid = "/usr/bin/setsid";
    private const int NoStream = -1;
    private const int InvalidDescriptor = -1;

    // A directory procfs never has, so the listing itself fails.
    private const string AbsentTable = ProcessTable.Root + "/sharpladder-absent";

    private static readonly TimeSpan Poll = TimeSpan.FromMilliseconds(10);

    private readonly LinuxSeam _seam;
    private Process? _process;
    private Stream? _input;
    private Stream? _outputRead;
    private Stream? _errorRead;
    private Thread? _output;
    private Thread? _error;
    private int _cappedStream = NoStream;
    private IOException? _readFault;
    private int? _group;

    private LinuxChild(LinuxSeam seam) => _seam = seam;

    public int ProcessId { get; private set; }

    private OutputStream? Capped => Volatile.Read(ref _cappedStream) is var stream and not NoStream ? (OutputStream)stream : null;

    public static LinuxChild Start(ChildLaunch launch, LinuxSeam seam)
    {
        var child = new LinuxChild(seam);
        try
        {
            child.Launch(launch);
            return child;
        }
        catch
        {
            child.Dispose();
            throw;
        }
    }

    // An errno value as a failure line shows it.
    public static string Error(int error) => string.Create(CultureInfo.InvariantCulture, $"Linux error {error}");

    // The runner has checked pid = pgid = sid = the started pid; from here on cleanup is the group's.
    // Checked again here, as a pgid of 0 or 1 would reach the checker's own group or every process.
    public void Verified(StartRecord start)
    {
        if (start.ProcessGroup is not { } group || group != ProcessId || group <= 1)
        {
            throw new ToolProblem("the code group's start record does not name its own process group");
        }

        _group = group;
    }

    public void Release(byte[] line)
    {
        if (_input is not PipeStream pipe)
        {
            throw new ToolProblem("the code group's standard input is not a pipe");
        }

        var handle = pipe.SafePipeHandle;
        var added = false;
        nint written;
        int error;
        try
        {
            handle.DangerousAddRef(ref added);
            var descriptor = _seam.Fault == LinuxFault.ReleaseWrite ? InvalidDescriptor : (int)handle.DangerousGetHandle();
            fixed (byte* bytes = line)
            {
                do
                {
                    written = LinuxNative.Write(descriptor, bytes, (nuint)line.Length);
                    error = written < 0 ? Marshal.GetLastPInvokeError() : 0;
                }
                while (error == LinuxNative.Interrupted);
            }
        }
        finally
        {
            if (added)
            {
                handle.DangerousRelease();
            }
        }

        if (written < 0)
        {
            throw new ToolProblem($"the release line could not be written to the code group ({Error(error)})");
        }

        if (written != line.Length)
        {
            throw new ToolProblem("the release line was written only in part to the code group");
        }

        // Content then reads end of input.
        pipe.Dispose();
    }

    // The exit is polled in short slices, so a passed cap is seen while the child still runs.
    public ChildState Wait(TimeSpan timeout)
    {
        var until = Deadline.After(timeout);
        while (true)
        {
            var exited = _process!.WaitForExit(until.Remaining < Poll ? until.Remaining : Poll);
            if (Capped is { } stream)
            {
                return new ChildState.CapPassed(stream);
            }

            if (exited)
            {
                return new ChildState.Exited(_process.ExitCode);
            }

            if (until.Passed)
            {
                return ChildState.Running;
            }
        }
    }

    // Never signal an unverified group: before verification only the directly owned child is ended.
    public void Terminate(Deadline cleanup)
    {
        if (_group is { } group)
        {
            Signal(group);
            Prove(group, cleanup);
        }
        else
        {
            EndDirectChild();
        }

        Reap(cleanup);
    }

    // Only after the group is proven dead can no process of it still hold a write end of either pipe.
    public OutputStream? AwaitReaders(Deadline cleanup)
    {
        if (!_output!.Join(cleanup.Remaining) || !_error!.Join(cleanup.Remaining))
        {
            throw new ToolProblem("the code group's output pipes were still open after its processes had ended");
        }

        if (Volatile.Read(ref _readFault) is { } fault)
        {
            throw new ToolProblem($"the code group's output could not be read ({fault.Message})", fault);
        }

        return Capped;
    }

    [System.Diagnostics.CodeAnalysis.SuppressMessage("IDisposableAnalyzers.Correctness", "IDISP007", Justification = "AnalyzerPolicy IDISP007: Process leaves the pipe streams it handed out to their user to close | Scope: the LinuxChild.Dispose method | Guard: LinuxChild closes the streams itself, the input in Release and Dispose and the two read streams in Dispose once both reader threads have ended | Decision: off")]
    public void Dispose()
    {
        // A start that failed part way leaves only a direct child, which is never verified.
        if (ProcessId != 0 && _group is null)
        {
            _process!.Kill();
        }

        _input?.Dispose();
        var drained = (_output?.Join(RunLimits.Cleanup) ?? true) & (_error?.Join(RunLimits.Cleanup) ?? true);
        if (drained)
        {
            _outputRead?.Dispose();
            _errorRead?.Dispose();
        }

        _process?.Dispose();
    }

    [System.Diagnostics.CodeAnalysis.SuppressMessage("IDisposableAnalyzers.Correctness", "IDISP003", Justification = "AnalyzerPolicy IDISP003: Launch runs once, while every field it sets is still null | Scope: the LinuxChild.Launch method | Guard: Launch is private and called only by Start, once, on the instance Start has just constructed, and no field Launch sets has an initializer | Decision: off")]
    private void Launch(ChildLaunch launch)
    {
        var start = new ProcessStartInfo(_seam.Fault == LinuxFault.Start ? Setsid + ".absent" : Setsid)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = launch.WorkingDirectory,
        };

        // Its options end here, so setsid never reads the launch line as its own.
        start.ArgumentList.Add("--");
        start.ArgumentList.Add(launch.Muxer);
        foreach (var argument in launch.Arguments)
        {
            start.ArgumentList.Add(argument);
        }

        // The launch's environment is the child's whole environment: none of the checker's is kept.
        start.Environment.Clear();
        var withheld = _seam.Fault == LinuxFault.StartUp ? WireContract.TokenVariable : null;
        foreach (var (name, value) in launch.Environment)
        {
            if (!string.Equals(name, withheld, StringComparison.Ordinal))
            {
                start.Environment[name] = value;
            }
        }

        _process = new Process { StartInfo = start };
        try
        {
            if (!_process.Start())
            {
                throw new ToolProblem("the code group's process could not be started");
            }
        }
        catch (Win32Exception e)
        {
            throw new ToolProblem($"the code group's process could not be started ({Error(e.NativeErrorCode)})", e);
        }

        ProcessId = _process.Id;
        _seam.Started?.Invoke(ProcessId);
        _input = _process.StandardInput.BaseStream;
        _outputRead = _process.StandardOutput.BaseStream;
        _errorRead = _process.StandardError.BaseStream;
        _output = Reader(_outputRead, OutputStream.StandardOutput);
        _error = Reader(_errorRead, OutputStream.StandardError);
    }

    // The retained pgid still reaches the group after its leader has exited. ESRCH means the group is
    // gone; any other error leaves its death unproven.
    private void Signal(int group)
    {
        _seam.Signalled?.Invoke(group);
        if (LinuxNative.Kill(-group, LinuxNative.SignalKill) != 0 && Marshal.GetLastPInvokeError() is var error and not LinuxNative.NoSuchProcess)
        {
            throw new ToolProblem($"the code group's process group could not be killed ({Error(error)})");
        }
    }

    private void Prove(int group, Deadline cleanup)
    {
        var root = _seam.Fault == LinuxFault.Enumeration ? AbsentTable : ProcessTable.Root;
        int live;
        while ((live = ProcessTable.LiveMembers(root, group)) > 0)
        {
            if (cleanup.Passed)
            {
                throw new ToolProblem(string.Create(CultureInfo.InvariantCulture, $"the code group's process group still held {live} processes {RunLimits.Cleanup.TotalSeconds} s after it was killed"));
            }

            Thread.Sleep(Poll);
        }
    }

    // Kill does nothing once the child has exited, so a reused pid is never reached.
    private void EndDirectChild()
    {
        try
        {
            _process!.Kill();
        }
        catch (Win32Exception e)
        {
            throw new ToolProblem($"the code group's process could not be killed ({Error(e.NativeErrorCode)})", e);
        }
    }

    // The runtime reaps its own child before it reports the exit.
    private void Reap(Deadline cleanup)
    {
        if (!_process!.WaitForExit(cleanup.Remaining))
        {
            throw new ToolProblem(string.Create(CultureInfo.InvariantCulture, $"the code group's process had not ended {RunLimits.Cleanup.TotalSeconds} s after it was killed"));
        }
    }

    private Thread Reader(Stream pipe, OutputStream stream)
    {
        var thread = new Thread(() => Drain(pipe, stream)) { IsBackground = true, Name = "code group " + GroupVerdict.Name(stream) };
        thread.Start();
        return thread;
    }

    // Past the cap the stream is still drained, so the child is never left blocked on a full pipe.
    private void Drain(Stream pipe, OutputStream stream)
    {
        try
        {
            var buffer = new byte[16 * 1024];
            long total = 0;
            int read;
            while ((read = pipe.Read(buffer)) > 0)
            {
                total += read;
                if (total > RunLimits.OutputCapBytes)
                {
                    Interlocked.CompareExchange(ref _cappedStream, (int)stream, NoStream);
                }
            }
        }
        catch (IOException e)
        {
            Interlocked.CompareExchange(ref _readFault, e, null);
        }
    }
}
