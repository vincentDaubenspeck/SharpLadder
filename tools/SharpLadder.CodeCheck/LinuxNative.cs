using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace SharpLadder.CodeCheck;

/// <summary>
/// The libc calls behind the Linux backend: the group kill, the release write, the process-table
/// reads and the realpath that canonicalises a directory. The runtime maps "libc" to the C library.
/// </summary>
[SupportedOSPlatform("linux")]
internal static unsafe partial class LinuxNative
{
    public const int NoSuchEntry = 2;
    public const int NoSuchProcess = 3;
    public const int Interrupted = 4;
    public const int SignalKill = 9;
    public const int ReadOnly = 0;
    public const int CloseOnExec = 0x80000;
    public const int PathMax = 4096;

    [LibraryImport("libc", EntryPoint = "kill", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    public static partial int Kill(int target, int signal);

    [LibraryImport("libc", EntryPoint = "write", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    public static partial nint Write(int descriptor, byte* buffer, nuint count);

    // open is variadic in C; the mode is always passed, as glibc reads it only with O_CREAT.
    [LibraryImport("libc", EntryPoint = "open", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    public static partial int Open(string path, int flags, uint mode);

    [LibraryImport("libc", EntryPoint = "read", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    public static partial nint Read(int descriptor, byte* buffer, nuint count);

    [LibraryImport("libc", EntryPoint = "close", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    public static partial int Close(int descriptor);

    [LibraryImport("libc", EntryPoint = "realpath", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    public static partial byte* RealPath(string path, byte* resolved);
}
