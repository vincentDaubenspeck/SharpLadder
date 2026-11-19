using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace SharpLadder.CodeCheck;

// One group's child on Windows: created suspended with only its three pipe ends inheritable, put in
// a kill-on-close job without breakaway before it runs, then resumed. Both output pipes are drained
// from the start on their own threads, counted against the cap and discarded.
[SupportedOSPlatform("windows")]
internal sealed unsafe class WindowsChild : IRunningChild
{
    private const uint KilledStatus = 1;
    private const int NoStream = -1;

    private static readonly TimeSpan ProofPoll = TimeSpan.FromMilliseconds(10);

    // Invalid handles a fault seam hands to the real call.
    private static readonly SafeFileHandle InvalidFile = new(0, ownsHandle: false);
    private static readonly SafeWaitHandle InvalidWait = new(0, ownsHandle: false);

    private readonly WindowsSeam _seam;
    private readonly ManualResetEvent _capped = new(initialState: false);
    private SafeWaitHandle? _job;
    private SafeWaitHandle? _process;
    private SafeFileHandle? _input;
    private SafeFileHandle? _childInput;
    private SafeFileHandle? _childOutput;
    private SafeFileHandle? _childError;
    private SafeFileHandle? _outputRead;
    private SafeFileHandle? _errorRead;
    private ExitSignal? _exited;
    private Thread? _output;
    private Thread? _error;
    private int _cappedStream = NoStream;
    private IOException? _readFault;

    private WindowsChild(WindowsSeam seam) => _seam = seam;

    public int ProcessId { get; private set; }

    private OutputStream? Capped => Volatile.Read(ref _cappedStream) is var stream and not NoStream ? (OutputStream)stream : null;

    public static WindowsChild Start(ChildLaunch launch, WindowsSeam seam)
    {
        var child = new WindowsChild(seam);
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

    // The thread's last Win32 error, as a failure line shows it.
    public static string Error() => string.Create(CultureInfo.InvariantCulture, $"Windows error {Marshal.GetLastPInvokeError()}");

    // The job already holds the child and everything it starts; verification adds nothing to clean up.
    public void Verified(StartRecord start)
    {
    }

    public void Release(byte[] line)
    {
        var target = _seam.Fault == WindowsFault.ReleaseWrite ? InvalidFile : _input!;
        uint written;
        bool wrote;
        fixed (byte* bytes = line)
        {
            wrote = WindowsNative.WriteFile(target, bytes, (uint)line.Length, &written, 0);
        }

        if (!wrote)
        {
            throw new ToolProblem($"the release line could not be written to the code group ({Error()})");
        }

        if (written != line.Length)
        {
            throw new ToolProblem("the release line was written only in part to the code group");
        }

        // Content then reads end of input.
        _input!.Dispose();
    }

    public ChildState Wait(TimeSpan timeout)
    {
        var signalled = WaitHandle.WaitAny([_capped, _exited!], timeout);
        if (Capped is { } stream)
        {
            return new ChildState.CapPassed(stream);
        }

        return signalled == WaitHandle.WaitTimeout ? ChildState.Running : new ChildState.Exited(ExitStatus());
    }

    public void Terminate(Deadline cleanup)
    {
        EndJob(_job!, cleanup, _seam);
        Reap(_process!, cleanup);
    }

    // Only after the job is proven empty can no process still hold a write end of either pipe.
    public OutputStream? AwaitReaders(Deadline cleanup)
    {
        if (!_output!.Join(cleanup.Remaining) || !_error!.Join(cleanup.Remaining))
        {
            throw new ToolProblem("the code group's output pipes were still open after its job was empty");
        }

        if (Volatile.Read(ref _readFault) is { } fault)
        {
            throw new ToolProblem($"the code group's output could not be read ({fault.Message})", fault);
        }

        return Capped;
    }

    public void Dispose()
    {
        // Closing the job kills whatever is left in it, as it would if the checker itself crashed.
        _job?.Dispose();
        _input?.Dispose();
        _childInput?.Dispose();
        _childOutput?.Dispose();
        _childError?.Dispose();
        var drained = (_output?.Join(RunLimits.Cleanup) ?? true) & (_error?.Join(RunLimits.Cleanup) ?? true);
        _exited?.Dispose();
        _process?.Dispose();
        if (drained)
        {
            _outputRead?.Dispose();
            _errorRead?.Dispose();
            _capped.Dispose();
        }
    }

    internal static string CommandLine(string program, IReadOnlyList<string> arguments)
    {
        var line = new StringBuilder();
        Quote(line, program);
        foreach (var argument in arguments)
        {
            line.Append(' ');
            Quote(line, argument);
        }

        return line.ToString();
    }

    // The block the child receives as its whole environment, sorted by name as Windows expects.
    internal static string EnvironmentBlock(IEnumerable<KeyValuePair<string, string>> environment)
    {
        var block = new StringBuilder();
        foreach (var (name, value) in environment.OrderBy(e => e.Key, StringComparer.OrdinalIgnoreCase))
        {
            block.Append(name).Append('=').Append(value).Append('\0');
        }

        return block.Append('\0').ToString();
    }

    private static SafeWaitHandle CreateJob()
    {
        var job = WindowsNative.CreateJobObject(0, 0);
        if (job.IsInvalid)
        {
            var error = Error();
            job.Dispose();
            throw new ToolProblem($"the code group's job could not be created ({error})");
        }

        WindowsNative.ExtendedLimitInformation limits = default;
        limits.BasicLimitInformation.LimitFlags = WindowsNative.JobObjectLimitKillOnJobClose;
        if (!WindowsNative.SetHandleInformation(job, WindowsNative.HandleFlagInherit, 0)
            || !WindowsNative.SetInformationJobObject(job, WindowsNative.JobObjectExtendedLimitInformation, &limits, (uint)sizeof(WindowsNative.ExtendedLimitInformation)))
        {
            var error = Error();
            job.Dispose();
            throw new ToolProblem($"the code group's job could not be set to kill on close ({error})");
        }

        return job;
    }

    // Only the child's end is inheritable, and only the handle list lets it reach the child.
    private static (SafeFileHandle Child, SafeFileHandle Checker) Pipe(bool childReads)
    {
        if (!WindowsNative.CreatePipe(out var read, out var write, 0, 0))
        {
            var error = Error();
            read.Dispose();
            write.Dispose();
            throw new ToolProblem($"the code group's pipes could not be created ({error})");
        }

        if (!WindowsBackend.Inheritable(childReads ? read : write, inherit: true) || !WindowsBackend.Inheritable(childReads ? write : read, inherit: false))
        {
            var error = Error();
            read.Dispose();
            write.Dispose();
            throw new ToolProblem($"the code group's pipes could not be prepared ({error})");
        }

        return childReads ? (read, write) : (write, read);
    }

    private static WindowsNative.ProcessInformation Create(ChildLaunch launch, WindowsSeam seam, SafeFileHandle input, SafeFileHandle output, SafeFileHandle error)
    {
        var commandLine = (CommandLine(launch.Muxer, launch.Arguments) + "\0").ToCharArray();
        var withheld = seam.Fault == WindowsFault.StartUp ? WireContract.TokenVariable : null;
        var environment = EnvironmentBlock(launch.Environment.Where(e => !string.Equals(e.Key, withheld, StringComparison.Ordinal))).ToCharArray();
        var image = seam.Fault == WindowsFault.Start ? launch.Muxer + ".absent" : launch.Muxer;

        nuint size = 0;
        WindowsNative.InitializeProcThreadAttributeList(0, 1, 0, &size);
        var list = Marshal.AllocHGlobal((nint)size);
        try
        {
            if (!WindowsNative.InitializeProcThreadAttributeList(list, 1, 0, &size))
            {
                throw new ToolProblem($"the code group's start attributes could not be prepared ({Error()})");
            }

            try
            {
                var handles = stackalloc nint[] { input.DangerousGetHandle(), output.DangerousGetHandle(), error.DangerousGetHandle() };
                if (!WindowsNative.UpdateProcThreadAttribute(list, 0, WindowsNative.ProcThreadAttributeHandleList, handles, (nuint)(3 * sizeof(nint)), 0, 0))
                {
                    throw new ToolProblem($"the code group's inherited handles could not be listed ({Error()})");
                }

                var startup = new WindowsNative.StartupInfoEx { AttributeList = list };
                startup.StartupInfo.Size = sizeof(WindowsNative.StartupInfoEx);
                startup.StartupInfo.Flags = WindowsNative.UseStandardHandles;
                startup.StartupInfo.StdInput = handles[0];
                startup.StartupInfo.StdOutput = handles[1];
                startup.StartupInfo.StdError = handles[2];
                const uint flags = WindowsNative.CreateSuspended | WindowsNative.CreateUnicodeEnvironment | WindowsNative.ExtendedStartupInfoPresent | WindowsNative.CreateNoWindow;
                WindowsNative.ProcessInformation created;
                fixed (char* line = commandLine)
                {
                    fixed (char* block = environment)
                    {
                        if (!WindowsNative.CreateProcess(image, line, 0, 0, inheritHandles: true, flags, block, launch.WorkingDirectory, &startup, &created))
                        {
                            throw new ToolProblem($"the code group's process could not be started ({Error()})");
                        }
                    }
                }

                return created;
            }
            finally
            {
                WindowsNative.DeleteProcThreadAttributeList(list);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(list);
        }
    }

    // A child the job does not hold is ended on its own; one it holds goes with the whole job.
    private static void Enter(SafeWaitHandle job, SafeWaitHandle process, SafeWaitHandle thread, WindowsSeam seam)
    {
        if (!WindowsNative.AssignProcessToJobObject(seam.Fault == WindowsFault.Assignment ? InvalidWait : job, process))
        {
            var error = Error();
            WindowsNative.TerminateProcess(process, KilledStatus);
            Reap(process, Deadline.After(RunLimits.Cleanup));
            throw new ToolProblem($"the code group's process could not be put in its job ({error})");
        }

        if (WindowsNative.ResumeThread(seam.Fault == WindowsFault.Resume ? InvalidWait : thread) == WindowsNative.ResumeFailed)
        {
            var error = Error();
            var cleanup = Deadline.After(RunLimits.Cleanup);
            EndJob(job, cleanup, seam);
            Reap(process, cleanup);
            throw new ToolProblem($"the code group's process could not be resumed in its job ({error})");
        }
    }

    // A count the job cannot report is a failure, never an empty job.
    private static void EndJob(SafeWaitHandle job, Deadline cleanup, WindowsSeam seam)
    {
        if (!WindowsNative.TerminateJobObject(job, KilledStatus))
        {
            throw new ToolProblem($"the code group's job could not be terminated ({Error()})");
        }

        uint active;
        while ((active = ActiveProcesses(job, seam)) > 0)
        {
            if (cleanup.Passed)
            {
                throw new ToolProblem(string.Create(CultureInfo.InvariantCulture, $"the code group's job still held {active} processes {RunLimits.Cleanup.TotalSeconds} s after it was terminated"));
            }

            Thread.Sleep(ProofPoll);
        }
    }

    private static uint ActiveProcesses(SafeWaitHandle job, WindowsSeam seam)
    {
        WindowsNative.BasicAccountingInformation accounting;
        var length = seam.Fault == WindowsFault.ProcessCount ? 0u : (uint)sizeof(WindowsNative.BasicAccountingInformation);
        if (!WindowsNative.QueryInformationJobObject(job, WindowsNative.JobObjectBasicAccountingInformation, &accounting, length, null))
        {
            throw new ToolProblem($"the code group's job could not report its live processes ({Error()})");
        }

        return accounting.ActiveProcesses;
    }

    private static void Reap(SafeWaitHandle process, Deadline cleanup)
    {
        if (WindowsNative.WaitForSingleObject(process, (uint)Math.Ceiling(cleanup.Remaining.TotalMilliseconds)) != WindowsNative.WaitObject0)
        {
            throw new ToolProblem(string.Create(CultureInfo.InvariantCulture, $"the code group's process had not ended {RunLimits.Cleanup.TotalSeconds} s after it was terminated"));
        }
    }

    // The quoting the C runtime and CommandLineToArgvW undo, so each argument arrives unchanged.
    private static void Quote(StringBuilder line, string argument)
    {
        if (argument.Length > 0 && !argument.Any(c => c is ' ' or '\t' or '\n' or '\v' or '"'))
        {
            line.Append(argument);
            return;
        }

        line.Append('"');
        var slashes = 0;
        foreach (var c in argument)
        {
            if (c == '\\')
            {
                slashes++;
                continue;
            }

            line.Append('\\', c == '"' ? (2 * slashes) + 1 : slashes).Append(c);
            slashes = 0;
        }

        line.Append('\\', 2 * slashes).Append('"');
    }

    [System.Diagnostics.CodeAnalysis.SuppressMessage("IDisposableAnalyzers.Correctness", "IDISP003", Justification = "AnalyzerPolicy IDISP003: Launch runs once, while every field it sets is still null | Scope: the WindowsChild.Launch method | Guard: Launch is private and called only by Start, once, on the instance Start has just constructed, and no field Launch sets has an initializer | Decision: off")]
    private void Launch(ChildLaunch launch)
    {
        _job = CreateJob();
        (_childInput, _input) = Pipe(childReads: true);
        (_childOutput, _outputRead) = Pipe(childReads: false);
        (_childError, _errorRead) = Pipe(childReads: false);
        var created = Create(launch, _seam, _childInput, _childOutput, _childError);

        // The checker's copies of the child's ends would keep the pipes open after the child is gone.
        _childInput.Dispose();
        _childOutput.Dispose();
        _childError.Dispose();
        _process = new SafeWaitHandle(created.Process, ownsHandle: true);
        ProcessId = created.ProcessId;
        using (var thread = new SafeWaitHandle(created.Thread, ownsHandle: true))
        {
            _seam.Started?.Invoke(created.ProcessId);
            Enter(_job, _process, thread, _seam);
        }

        _exited = new ExitSignal(_process);
        _output = Reader(_outputRead, OutputStream.StandardOutput);
        _error = Reader(_errorRead, OutputStream.StandardError);
    }

    private int ExitStatus()
    {
        uint status;
        if (!WindowsNative.GetExitCodeProcess(_process!, &status))
        {
            throw new ToolProblem($"the code group's exit status could not be read ({Error()})");
        }

        return unchecked((int)status);
    }

    private Thread Reader(SafeFileHandle pipe, OutputStream stream)
    {
        var thread = new Thread(() => Drain(pipe, stream)) { IsBackground = true, Name = "code group " + GroupVerdict.Name(stream) };
        thread.Start();
        return thread;
    }

    // Past the cap the stream is still drained, so the child is never left blocked on a full pipe.
    private void Drain(SafeFileHandle pipe, OutputStream stream)
    {
        try
        {
            using var reader = new FileStream(pipe, FileAccess.Read, bufferSize: 0);
            var buffer = new byte[16 * 1024];
            long total = 0;
            int read;
            while ((read = reader.Read(buffer)) > 0)
            {
                total += read;
                if (total > RunLimits.OutputCapBytes && Interlocked.CompareExchange(ref _cappedStream, (int)stream, NoStream) == NoStream)
                {
                    _capped.Set();
                }
            }
        }
        catch (IOException e)
        {
            Interlocked.CompareExchange(ref _readFault, e, null);
        }
    }

    // The process handle is owned and closed by _process; owning it here would close it twice.
    private sealed class ExitSignal : WaitHandle
    {
        public ExitSignal(SafeWaitHandle process) => SafeWaitHandle = new SafeWaitHandle(process.DangerousGetHandle(), ownsHandle: false);
    }
}
