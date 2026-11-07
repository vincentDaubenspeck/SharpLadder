using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace SharpLadder.Content;

/// <summary>
/// The filesystem boundary. Each designated root (schema folder, content root, output folder) is
/// opened and kernel-canonicalised, permitting links and mount points only above that root. Every
/// read or write uses a handle opened through a directory chain whose kernel identities establish
/// containment within its designated root, with no reparse point, symbolic link, mount point or
/// other device or volume at or below that root. Both input trees are read whole, every entry at
/// every depth, before anything is compiled. Neither the output root nor any of its ancestors
/// shares the identity of any folder in either input tree; the output folder is empty or absent
/// before anything is created. The output parent's identity and containment are rechecked
/// immediately before each write. Existing destination files are never modified in place; input
/// files must be regular files with a single hard link. Unverifiable canonicalisation, identity
/// or containment fails closed. Concurrent mutation of these trees during a run is outside the
/// contract.
/// </summary>
internal static partial class KernelPath
{
    public const string WindowsForm = @"a full path that starts with a drive letter, such as C:\folder";

    public const string LinuxForm = "a full path that starts with /";

    public const string MountRefusal = "mount points and other devices or volumes are not accepted at or below a root folder";

    private const int LinuxCrossDevice = 18;
    private const int LinuxNotImplemented = 38;

    // Null when the path is in an accepted form. The form is checked as text only so that the
    // kernel, not this code, decides where an accepted path leads.
    public static string? EntryProblem(string path)
    {
        var platform = PlatformProblem();
        if (platform is not null)
        {
            return platform;
        }

        var windows = OperatingSystem.IsWindows();
        var form = windows ? WindowsForm : LinuxForm;
        var rest = windows ? DriveRest(path) : (path.StartsWith('/') ? path[1..] : null);

        // A NUL would end the string the kernel sees early, so another path would be opened.
        if (rest is null || path.Contains('\0', StringComparison.Ordinal))
        {
            return $"not accepted; give {form}, with no device, UNC or relative form and no . or .. segments";
        }

        var separator = windows ? '\\' : '/';
        if (rest.EndsWith(separator))
        {
            rest = rest[..^1];
        }

        if (rest.Length == 0)
        {
            return null;
        }

        foreach (var segment in rest.Split(separator))
        {
            if (!IsPlainSegment(segment, windows))
            {
                return $"segment \"{segment}\" is not accepted; give {form}, with no empty, . or .. segments"
                    + (windows ? ", no / and no : after the drive, and no name that ends in a dot or space" : string.Empty);
            }
        }

        return null;
    }

    // With follow, a link above a root or at its last component leads where the kernel says;
    // without it, a link at the last component is opened as itself. Null when nothing is there.
    public static SafeFileHandle? TryOpen(string path, string display, bool follow = true)
    {
        if (OperatingSystem.IsWindows())
        {
            return Windows.TryOpen(path, display, follow);
        }

        Supported();
        return Unix.TryOpen(path, display, follow);
    }

    // The kernel's own name for what handle refers to; path is how it was opened.
    public static string Canonical(SafeFileHandle handle, string path, string display)
    {
        if (OperatingSystem.IsWindows())
        {
            return Windows.Canonical(handle, display);
        }

        Supported();
        return Unix.Canonical(handle, path, display);
    }

    public static HandleInfo Inspect(SafeFileHandle handle, string display)
    {
        if (OperatingSystem.IsWindows())
        {
            return Windows.Inspect(handle, display);
        }

        Supported();
        return Unix.Inspect(handle, display);
    }

    // Opens name inside folder without following a link there. Null when nothing is there.
    public static SafeFileHandle? TryOpenChild(SafeFileHandle folder, string name, bool forReading, string display)
    {
        if (OperatingSystem.IsWindows())
        {
            return Windows.TryOpenChild(folder, name, forReading, display);
        }

        Supported();
        return Unix.TryOpenChild(folder, name, forReading, display);
    }

    // Create-new: fails if anything, a link included, already has the name.
    public static SafeFileHandle CreateChild(SafeFileHandle folder, string name, bool isFolder, string display)
    {
        if (OperatingSystem.IsWindows())
        {
            return Windows.CreateChild(folder, name, isFolder, display);
        }

        Supported();
        return Unix.CreateChild(folder, name, isFolder, display);
    }

    // Removes name from folder only while it still has the identity this run recorded for it.
    public static void RemoveChild(SafeFileHandle folder, string name, FileIdentity expected, bool isFolder, string display)
    {
        if (OperatingSystem.IsWindows())
        {
            Windows.RemoveChild(folder, name, expected, display);
            return;
        }

        Supported();
        Unix.RemoveChild(folder, name, expected, isFolder, display);
    }

    // The identity of every folder from the file system root down to canonical, canonical included.
    public static List<FileIdentity> Ancestors(string canonical, string display)
    {
        var chain = new List<string>();
        for (var path = canonical; path is not null; path = Path.GetDirectoryName(path))
        {
            chain.Add(path);
        }

        chain.Reverse();
        var identities = new List<FileIdentity>();
        foreach (var path in chain)
        {
            using var handle = TryOpen(path, display, follow: false) ?? throw new BoundaryException($"{display}: cannot open {path}, which the kernel named as an ancestor");
            var info = Inspect(handle, display);
            if (info.IsLink)
            {
                throw new BoundaryException($"{display}: the kernel's canonical path passes through a link at {path}");
            }

            identities.Add(info.Id);
        }

        return identities;
    }

    public static BoundaryException Failure(string display, string check, int error) =>
        new($"{display}: {check} failed: {Marshal.GetPInvokeErrorMessage(error)} (error {error})");

    private static string? PlatformProblem()
    {
        if (OperatingSystem.IsWindows())
        {
            return null;
        }

        var architecture = RuntimeInformation.ProcessArchitecture;
        return OperatingSystem.IsLinux() && architecture is Architecture.X64 or Architecture.Arm64
            ? null
            : "the content compiler runs only on Windows and on Linux (x64 or arm64)";
    }

    private static void Supported()
    {
        if (PlatformProblem() is { } problem)
        {
            throw new BoundaryException(problem);
        }
    }

    private static string? DriveRest(string path) =>
        path.Length >= 3 && char.IsAsciiLetter(path[0]) && path[1] == ':' && path[2] == '\\' ? path[3..] : null;

    private static bool IsPlainSegment(string segment, bool windows)
    {
        if (segment.Length == 0 || segment is "." or "..")
        {
            return false;
        }

        // Win32 drops a trailing dot or space and reads : as a stream name, so the kernel would
        // be given another name than the one written.
        return !windows || (!segment.Contains('/', StringComparison.Ordinal) && !segment.Contains(':', StringComparison.Ordinal)
            && !segment.EndsWith('.') && !segment.EndsWith(' '));
    }
}
