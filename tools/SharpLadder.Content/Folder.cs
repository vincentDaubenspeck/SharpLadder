using Microsoft.Win32.SafeHandles;

namespace SharpLadder.Content;

// An open folder inside a designated root, or the root itself. Every child is opened relative to
// this handle and never through a link, so containment is the chain of handles, not path text.
internal sealed class Folder : IDisposable
{
    private readonly SafeFileHandle _handle;

    // The device or volume of the root this folder was reached from.
    private readonly ulong _device;

    private Folder(SafeFileHandle handle, string canonical, string display, FileIdentity id, ulong device)
    {
        _handle = handle;
        _device = device;
        Canonical = canonical;
        Display = display;
        Id = id;
    }

    public string Canonical { get; }

    public string Display { get; }

    public FileIdentity Id { get; }

    // A link above the root or at its last component is followed by the kernel; what it reaches
    // is the root.
    public static Folder OpenRoot(string path, string display)
    {
        if (KernelPath.EntryProblem(path) is { } problem)
        {
            throw new BoundaryException($"{display}: {problem}");
        }

        var handle = KernelPath.TryOpen(path, display) ?? throw new BoundaryException($"{display}: folder not found");
        try
        {
            var info = KernelPath.Inspect(handle, display);
            if (!info.IsFolder)
            {
                throw new BoundaryException($"{display}: not a folder");
            }

            if (info.IsMountRoot)
            {
                throw new BoundaryException($"{display}: a root folder must not be a mount point; mount points are accepted only above it");
            }

            return new Folder(handle, KernelPath.Canonical(handle, path, display), display, info.Id, info.Id.Device);
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    // The folder at a canonical path recorded earlier, only while it keeps the recorded identity.
    public static Folder Reopen(string canonical, FileIdentity id, string display)
    {
        var handle = KernelPath.TryOpen(canonical, display, follow: false) ?? throw new BoundaryException($"{display}: no longer there");
        try
        {
            var info = KernelPath.Inspect(handle, display);
            if (info.Id != id || info.IsLink || !info.IsFolder)
            {
                throw new BoundaryException($"{display}: no longer the folder this run opened");
            }

            return new Folder(handle, canonical, display, id, id.Device);
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    // A child is shown in the separator style of the display it extends.
    public string ChildDisplay(string name) => Display switch
    {
        "." or "" => name,
        _ when Display.Contains('\\', StringComparison.Ordinal) && !Display.Contains('/', StringComparison.Ordinal) => Path.Join(Display, name),
        _ => $"{Display.TrimEnd('/')}/{name}",
    };

    // The entries in ordinal name order. A link or other reparse point anywhere in the listing is
    // refused, whatever its name.
    public List<(string Name, bool IsFolder)> List()
    {
        using (Reopen(Canonical, Id, Display))
        {
        }

        var entries = new List<(string Name, bool IsFolder)>();
        foreach (var entry in new DirectoryInfo(Canonical).EnumerateFileSystemInfos())
        {
            if (entry.Attributes.HasFlag(FileAttributes.ReparsePoint) || entry.Name is "." or "..")
            {
                throw LinkRefused(ChildDisplay(entry.Name));
            }

            entries.Add((entry.Name, entry is DirectoryInfo));
        }

        entries.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        return entries;
    }

    public Folder? TryOpenFolder(string name)
    {
        var display = ChildDisplay(name);
        var handle = KernelPath.TryOpenChild(_handle, name, forReading: false, display);
        if (handle is null)
        {
            return null;
        }

        try
        {
            var info = KernelPath.Inspect(handle, display);
            if (info.IsLink)
            {
                throw LinkRefused(display);
            }

            if (!info.IsFolder)
            {
                throw new BoundaryException($"{display}: not a folder");
            }

            Inside(info, display);
            return new Folder(handle, Path.Join(Canonical, name), display, info.Id, _device);
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    public Folder OpenFolder(string name) =>
        TryOpenFolder(name) ?? throw new BoundaryException($"{ChildDisplay(name)}: no longer there");

    // The whole file, read through a handle that is a regular file with one hard link, inside
    // this folder as the parent this run recorded.
    public byte[] ReadFile(string name)
    {
        var display = ChildDisplay(name);
        HandleInfo info;
        using (var probe = KernelPath.TryOpenChild(_handle, name, forReading: false, display)
            ?? throw new BoundaryException($"{display}: no longer there"))
        {
            info = KernelPath.Inspect(probe, display);
        }

        if (info.IsLink)
        {
            throw LinkRefused(display);
        }

        Inside(info, display);
        if (!info.IsRegularFile)
        {
            throw new BoundaryException($"{display}: not a regular file; only regular files are read");
        }

        if (info.Links != 1)
        {
            throw new BoundaryException($"{display}: has {info.Links} hard links; an input file must have exactly one");
        }

        using var file = KernelPath.TryOpenChild(_handle, name, forReading: true, display)
            ?? throw new BoundaryException($"{display}: no longer there");
        if (KernelPath.Inspect(file, display) != info || KernelPath.Inspect(_handle, Display).Id != Id)
        {
            throw new BoundaryException($"{display}: changed while it was being opened");
        }

        var bytes = new byte[RandomAccess.GetLength(file)];
        var read = 0;
        while (read < bytes.Length)
        {
            var count = RandomAccess.Read(file, bytes.AsSpan(read), read);
            if (count == 0)
            {
                throw new BoundaryException($"{display}: shorter than its reported length");
            }

            read += count;
        }

        return bytes;
    }

    public Folder CreateFolder(string name)
    {
        var display = ChildDisplay(name);
        var handle = KernelPath.CreateChild(_handle, name, isFolder: true, display);
        try
        {
            var info = KernelPath.Inspect(handle, display);
            if (info.IsLink || !info.IsFolder)
            {
                throw new BoundaryException($"{display}: the new folder is not a plain folder");
            }

            Inside(info, display);
            return new Folder(handle, Path.Join(Canonical, name), display, info.Id, _device);
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    // Create-new only: an entry that already has the name is never opened, let alone changed.
    public SafeFileHandle CreateFile(string name, out FileIdentity id)
    {
        var display = ChildDisplay(name);
        var handle = KernelPath.CreateChild(_handle, name, isFolder: false, display);
        try
        {
            var info = KernelPath.Inspect(handle, display);
            if (info.IsLink || !info.IsRegularFile)
            {
                throw new BoundaryException($"{display}: the new file is not a regular file");
            }

            Inside(info, display);
            id = info.Id;
            return handle;
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    public void Remove(string name, FileIdentity id, bool isFolder) =>
        KernelPath.RemoveChild(_handle, name, id, isFolder, ChildDisplay(name));

    public void Dispose() => _handle.Dispose();

    private static BoundaryException LinkRefused(string display) =>
        new($"{display}: links and reparse points are not accepted at or below a root folder");

    // openat2 already refuses a mount crossing on Linux; these checks hold even where it could
    // not, and on Windows a volume change without a reparse point is refused all the same.
    private void Inside(HandleInfo info, string display)
    {
        if (info.IsMountRoot || info.Id.Device != _device)
        {
            throw new BoundaryException($"{display}: {KernelPath.MountRefusal}");
        }
    }
}
