using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace SharpLadder.CodeCheck;

// The Linux process table, read for the death proof. Only ENOENT or ESRCH on one process's own entry
// means that process is gone; a listing that fails, a denied read and a malformed line are errors,
// and none of them is ever taken as an empty group.
[SupportedOSPlatform("linux")]
internal static unsafe class ProcessTable
{
    public const string Root = "/proc";

    // A stat line is a few hundred bytes; one that fills this is not what the kernel writes.
    private const int StatBytes = 4096;

    // Every process of the group that is not a zombie; a zombie cannot run.
    public static int LiveMembers(string root, int group)
    {
        List<string> entries;
        try
        {
            entries = [.. Directory.EnumerateFileSystemEntries(root).Select(Path.GetFileName).OfType<string>()];
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ToolProblem($"the process table could not be listed ({e.GetType().Name})", e);
        }

        var live = 0;
        foreach (var entry in entries)
        {
            if (int.TryParse(entry, NumberStyles.None, CultureInfo.InvariantCulture, out var pid)
                && Read(root, pid) is { State: not 'Z' } stat
                && stat.ProcessGroup == group)
            {
                live++;
            }
        }

        return live;
    }

    // Null only when this one entry vanished.
    public static ProcessStat? Read(string root, int pid)
    {
        var path = string.Create(CultureInfo.InvariantCulture, $"{root}/{pid}/stat");
        var descriptor = LinuxNative.Open(path, LinuxNative.ReadOnly | LinuxNative.CloseOnExec, 0);
        if (descriptor < 0)
        {
            var error = Marshal.GetLastPInvokeError();
            return Vanished(error) ? null : throw Unreadable(path, error);
        }

        try
        {
            var buffer = new byte[StatBytes];
            var length = 0;
            fixed (byte* start = buffer)
            {
                while (true)
                {
                    var read = LinuxNative.Read(descriptor, start + length, (nuint)(buffer.Length - length));
                    if (read == 0)
                    {
                        break;
                    }

                    if (read < 0)
                    {
                        var error = Marshal.GetLastPInvokeError();
                        if (error == LinuxNative.Interrupted)
                        {
                            continue;
                        }

                        return Vanished(error) ? null : throw Unreadable(path, error);
                    }

                    length += (int)read;
                    if (length == buffer.Length)
                    {
                        throw new ToolProblem($"{path} is malformed");
                    }
                }
            }

            return ProcessStat.Parse(buffer.AsSpan(0, length)) is { } stat && stat.ProcessId == pid
                ? stat
                : throw new ToolProblem($"{path} is malformed");
        }
        finally
        {
            LinuxNative.Close(descriptor);
        }
    }

    private static bool Vanished(int error) => error is LinuxNative.NoSuchEntry or LinuxNative.NoSuchProcess;

    private static ToolProblem Unreadable(string path, int error) =>
        new($"{path} could not be read ({LinuxChild.Error(error)})");
}
