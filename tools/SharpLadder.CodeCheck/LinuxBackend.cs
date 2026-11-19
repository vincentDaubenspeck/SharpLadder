using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace SharpLadder.CodeCheck;

// The child leads its own session and process group, which its start record reports.
[SupportedOSPlatform("linux")]
internal sealed class LinuxBackend(LinuxSeam seam) : IRunBackend
{
    public LinuxBackend()
        : this(LinuxSeam.None)
    {
    }

    public bool ReportsProcessGroup => true;

    // realpath: absolute, every link resolved, no dot segments and no trailing separator.
    public unsafe string Canonical(string directory)
    {
        var buffer = new byte[LinuxNative.PathMax];
        fixed (byte* resolved = buffer)
        {
            if (LinuxNative.RealPath(directory, resolved) is null)
            {
                throw new ToolProblem($"{directory} cannot be resolved to its canonical path ({LinuxChild.Error(Marshal.GetLastPInvokeError())})");
            }

            return Marshal.PtrToStringUTF8((nint)resolved)!;
        }
    }

    public IRunningChild Start(ChildLaunch launch) => LinuxChild.Start(launch, seam);
}
