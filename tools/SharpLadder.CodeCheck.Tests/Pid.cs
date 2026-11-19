using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using Xunit;
using Xunit.Sdk;

namespace SharpLadder.CodeCheck.Tests;

// A pid with the start it had, so a reused pid is never taken for the process that ended. On Linux
// the start is the clock-tick field of /proc/<pid>/stat, read here apart from the checker's own
// reader, and a zombie counts as dead because it cannot run.
internal sealed record Pid(int Id, long StartTicks)
{
    private const int NoSuchProcess = 3;

    public bool Alive
    {
        get
        {
            if (OperatingSystem.IsLinux())
            {
                return Stat(Id) is { } fields && fields[0] is not ("Z" or "X") && Start(fields) == StartTicks;
            }

            try
            {
                using var process = Process.GetProcessById(Id);
                return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == StartTicks;
            }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException or Win32Exception)
            {
                return false;
            }
        }
    }

    // Taken while the process exists: the seam reports the child as soon as it is started.
    public static Pid Of(int id)
    {
        if (OperatingSystem.IsLinux())
        {
            return new(id, Start(Stat(id) ?? throw new InvalidOperationException("the started process ended before its start was read")));
        }

        using var process = Process.GetProcessById(id);
        return new(id, process.StartTime.ToUniversalTime().Ticks);
    }

    // What each descendant wrote before it could be ended: "<pid> <start>", in this OS's start form.
    public static IReadOnlyList<Pid> Ready(string folder) =>
        [.. Directory.GetFiles(folder, "*.ready").Select(f => File.ReadAllText(f).Split(' ')).Select(p => new Pid(int.Parse(p[0], CultureInfo.InvariantCulture), long.Parse(p[1], CultureInfo.InvariantCulture)))];

    // This OS's backend whose seam keeps the direct child's pid as it starts and, on Linux, reports
    // each process group just before it is signalled; Windows signals no group. Each OS takes its own
    // fault.
    public static IRunBackend Watch(List<Pid> started, WindowsFault onWindows = WindowsFault.None, LinuxFault onLinux = LinuxFault.None, Action<int>? signalled = null)
    {
        if (OperatingSystem.IsWindows())
        {
            return new WindowsBackend(new WindowsSeam(onWindows, id => started.Add(Of(id))));
        }

        return OperatingSystem.IsLinux() ? new LinuxBackend(new LinuxSeam(onLinux, id => started.Add(Of(id)), signalled)) : throw SkipException.ForSkip(Runs.NoBackend);
    }

    // The direct child and every descendant that reported ready, none of them still running.
    public static void AllDead(IReadOnlyList<Pid> started, string folder, int descendants)
    {
        var ready = Ready(folder);
        Assert.Single(started);
        Assert.Equal(descendants, ready.Count);
        Assert.DoesNotContain(started.Concat(ready), p => p.Alive);
    }

    // The fields after the name's last ')', from the state on; null once the entry is gone.
    private static string[]? Stat(int id)
    {
        try
        {
            var stat = File.ReadAllText(string.Create(CultureInfo.InvariantCulture, $"/proc/{id}/stat"));
            return stat[(stat.LastIndexOf(')') + 2)..].TrimEnd('\n').Split(' ');
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException || (e is IOException && e.HResult == NoSuchProcess))
        {
            return null;
        }
    }

    // Field 22, starttime, is the twentieth after the name.
    private static long Start(string[] fields) => long.Parse(fields[19], CultureInfo.InvariantCulture);
}
