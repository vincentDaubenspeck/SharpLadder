using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace SharpLadder.CodeCheck;

// Windows has no process group to report; the job holds the child and everything it starts.
[SupportedOSPlatform("windows")]
internal sealed class WindowsBackend(WindowsSeam seam) : IRunBackend
{
    private const string LongPrefix = @"\\?\";

    public WindowsBackend()
        : this(WindowsSeam.None)
    {
    }

    public bool ReportsProcessGroup => false;

    // The final path of the opened directory, so 8.3 short names, links and case resolve alike.
    public unsafe string Canonical(string directory)
    {
        using var handle = WindowsNative.CreateFile(directory, WindowsNative.FileReadAttributes, WindowsNative.FileShareAll, 0, WindowsNative.OpenExisting, WindowsNative.FileFlagBackupSemantics, 0);
        if (handle.IsInvalid)
        {
            throw new ToolProblem($"{directory} cannot be opened to resolve its canonical path ({WindowsChild.Error()})");
        }

        var length = WindowsNative.GetFinalPathNameByHandle(handle, null, 0, 0);
        var buffer = new char[Math.Max(length, 1)];
        uint written;
        fixed (char* path = buffer)
        {
            written = WindowsNative.GetFinalPathNameByHandle(handle, path, (uint)buffer.Length, 0);
        }

        if (written == 0 || written >= buffer.Length)
        {
            throw new ToolProblem($"{directory} cannot be resolved to its canonical path ({WindowsChild.Error()})");
        }

        var final = new string(buffer, 0, (int)written);
        return final.StartsWith(LongPrefix, StringComparison.Ordinal) && final.Length > 5 && final[5] == ':' ? final[4..] : final;
    }

    public IRunningChild Start(ChildLaunch launch, OutputSink output) => WindowsChild.Start(launch, output, seam);

    internal static bool Inheritable(SafeFileHandle handle, bool inherit) =>
        WindowsNative.SetHandleInformation(handle, WindowsNative.HandleFlagInherit, inherit ? WindowsNative.HandleFlagInherit : 0);
}
