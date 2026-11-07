using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace SharpLadder.Content;

internal static partial class KernelPath
{
    // ENOSYS and EXDEV from openat2 get their own diagnostic; any other error is reported as is.
    public static BoundaryException LinuxOpenFailure(string display, int error) => error switch
    {
        LinuxNotImplemented => new BoundaryException($"{display}: openat2 is not available (ENOSYS); the content compiler needs Linux 5.8 or later"),
        LinuxCrossDevice => new BoundaryException($"{display}: {MountRefusal}"),
        _ => Failure(display, "openat2", error),
    };

    // Linux: a root is opened by path; everything below it with openat2 on a folder descriptor,
    // which refuses to follow a link or cross a mount there, so a symbolic link is opened as itself
    // or refused. statx reads type, link count, identity and mount root from the descriptor itself.
    private static unsafe partial class Unix
    {
        // __NR_openat2 is 437 on x86_64 (syscall_64.tbl) and in the generic table arm64 uses.
        private const long OpenAt2Number = 437;

        // RESOLVE_NO_XDEV | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS | RESOLVE_BENEATH.
        private const ulong ResolveInside = 0x1 | 0x2 | 0x4 | 0x8;
        private const ulong AttributeMountRoot = 0x2000;
        private const int AtFolderOfProcess = -100;
        private const int AtSymlinkNoFollow = 0x100;
        private const int AtRemoveFolder = 0x200;
        private const int AtEmptyPath = 0x1000;
        private const int ReadOnly = 0x0;
        private const int WriteOnly = 0x1;
        private const int CreateFlag = 0x40;
        private const int Exclusive = 0x80;
        private const int NoControllingTerminal = 0x100;
        private const int NonBlocking = 0x800;
        private const int CloseOnExec = 0x80000;
        private const int PathOnly = 0x200000;
        private const uint WantedMask = 0x1 | 0x2 | 0x4 | 0x100;
        private const int TypeMask = 0xF000;
        private const int TypeFolder = 0x4000;
        private const int TypeRegular = 0x8000;
        private const int TypeLink = 0xA000;
        private const int NoSuchEntry = 2;
        private const int NotAFolder = 20;
        private const int PathMax = 4096;

        // The two flags whose values differ between the x64 and the generic (arm64) Linux ABI.
        private static int FolderOnly => RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? 0x4000 : 0x10000;

        private static int NoFollow => RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? 0x8000 : 0x20000;

        public static SafeFileHandle? TryOpen(string path, string display, bool follow)
        {
            var descriptor = OpenAt(AtFolderOfProcess, path, PathOnly | CloseOnExec | (follow ? 0 : NoFollow), 0);
            return Wrap(descriptor, display, "open");
        }

        public static string Canonical(SafeFileHandle handle, string path, string display)
        {
            var buffer = new byte[PathMax];
            string canonical;
            fixed (byte* resolved = buffer)
            {
                if (RealPath(path, resolved) is null)
                {
                    throw Failure(display, "realpath", Marshal.GetLastPInvokeError());
                }

                canonical = Marshal.PtrToStringUTF8((nint)resolved)!;
            }

            // glibc resolves links in user space, so its answer counts only if the kernel finds
            // the opened folder itself there, with no link at its last component.
            using var check = TryOpen(canonical, display, follow: false)
                ?? throw new BoundaryException($"{display}: realpath gives {canonical}, which cannot be opened");
            if (!canonical.StartsWith('/') || Inspect(check, display).Id != Inspect(handle, display).Id)
            {
                throw new BoundaryException($"{display}: realpath gives {canonical}, which is not what the kernel opened");
            }

            return canonical;
        }

        public static HandleInfo Inspect(SafeFileHandle handle, string display)
        {
            StatxBuffer buffer;
            var result = Statx(Descriptor(handle), string.Empty, AtEmptyPath | AtSymlinkNoFollow, WantedMask, &buffer);
            GC.KeepAlive(handle);
            if (result != 0)
            {
                throw Failure(display, "statx", Marshal.GetLastPInvokeError());
            }

            if ((buffer.Mask & WantedMask) != WantedMask)
            {
                throw new BoundaryException($"{display}: statx did not report the type, mode, link count and inode");
            }

            // A bind mount keeps the device and inode of its source, so only this flag reveals one.
            if ((buffer.AttributesMask & AttributeMountRoot) == 0)
            {
                throw new BoundaryException($"{display}: statx cannot tell whether it is a mount point (Linux 5.8 or later is required)");
            }

            var type = buffer.Mode & TypeMask;
            var id = new FileIdentity(((ulong)buffer.DeviceMajor << 32) | buffer.DeviceMinor, 0, buffer.Inode);
            var mountRoot = (buffer.Attributes & AttributeMountRoot) != 0;
            return new HandleInfo(id, type == TypeFolder, type == TypeRegular, type == TypeLink, buffer.Links, mountRoot);
        }

        public static SafeFileHandle? TryOpenChild(SafeFileHandle folder, string name, bool forReading, string display)
        {
            // O_NONBLOCK keeps a FIFO from stalling the open; the caller refuses all but regular files.
            var flags = NoFollow | CloseOnExec | (forReading ? ReadOnly | NonBlocking | NoControllingTerminal : PathOnly);
            var descriptor = OpenInside(folder, name, flags, 0, out var error);
            if (descriptor >= 0)
            {
                return new SafeFileHandle(descriptor, ownsHandle: true);
            }

            return error is NoSuchEntry or NotAFolder ? null : throw LinuxOpenFailure(display, error);
        }

        public static SafeFileHandle CreateChild(SafeFileHandle folder, string name, bool isFolder, string display)
        {
            int descriptor;
            int error;
            if (isFolder)
            {
                if (MakeFolderAt(Descriptor(folder), Single(name), 0x1FF) != 0)
                {
                    throw Failure(display, "mkdirat", Marshal.GetLastPInvokeError());
                }

                GC.KeepAlive(folder);

                // The caller checks the new folder's identity, type and device through this handle.
                descriptor = OpenInside(folder, name, PathOnly | FolderOnly | NoFollow | CloseOnExec, 0, out error);
            }
            else
            {
                descriptor = OpenInside(folder, name, WriteOnly | CreateFlag | Exclusive | NoFollow | NoControllingTerminal | CloseOnExec, 0x1B6, out error);
            }

            return descriptor >= 0
                ? new SafeFileHandle(descriptor, ownsHandle: true)
                : throw LinuxOpenFailure(display, error);
        }

        public static void RemoveChild(SafeFileHandle folder, string name, FileIdentity expected, bool isFolder, string display)
        {
            using (var probe = TryOpenChild(folder, name, forReading: false, display)
                ?? throw new BoundaryException($"{display}: not removed; it is no longer there"))
            {
                if (Inspect(probe, display).Id != expected)
                {
                    throw new BoundaryException($"{display}: not removed; it is no longer the entry this run created");
                }
            }

            var result = UnlinkAt(Descriptor(folder), Single(name), isFolder ? AtRemoveFolder : 0);
            GC.KeepAlive(folder);
            if (result != 0)
            {
                throw Failure(display, "unlinkat", Marshal.GetLastPInvokeError());
            }
        }

        private static int OpenInside(SafeFileHandle folder, string name, int flags, uint mode, out int error)
        {
            var how = new OpenHow { Flags = (uint)flags, Mode = mode, Resolve = ResolveInside };
            var result = Syscall(OpenAt2Number, Descriptor(folder), Single(name), &how, (nuint)sizeof(OpenHow));
            error = result < 0 ? Marshal.GetLastPInvokeError() : 0;
            GC.KeepAlive(folder);
            return result < 0 ? -1 : (int)result;
        }

        // The caller keeps the handle alive across the call, so the descriptor cannot be reused.
        private static int Descriptor(SafeFileHandle handle) => (int)handle.DangerousGetHandle();

        private static string Single(string name) =>
            name.Length is 0 or > 255 || name.Contains('/', StringComparison.Ordinal) || name is "." or ".."
                ? throw new BoundaryException($"{name}: not a single file name")
                : name;

        private static SafeFileHandle? Wrap(int descriptor, string display, string check)
        {
            if (descriptor >= 0)
            {
                return new SafeFileHandle(descriptor, ownsHandle: true);
            }

            var error = Marshal.GetLastPInvokeError();
            return error is NoSuchEntry or NotAFolder ? null : throw Failure(display, check, error);
        }

        // openat is variadic in C; the mode is always passed, as glibc reads it only with O_CREAT.
        [LibraryImport("libc", EntryPoint = "openat", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
        private static partial int OpenAt(int folder, string path, int flags, uint mode);

        // glibc has no openat2 wrapper. syscall is variadic in C, so every argument is passed at
        // full register width.
        [LibraryImport("libc", EntryPoint = "syscall", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
        private static partial long Syscall(long number, long folder, string path, OpenHow* how, nuint size);

        [LibraryImport("libc", EntryPoint = "mkdirat", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
        private static partial int MakeFolderAt(int folder, string path, uint mode);

        [LibraryImport("libc", EntryPoint = "unlinkat", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
        private static partial int UnlinkAt(int folder, string path, int flags);

        [LibraryImport("libc", EntryPoint = "realpath", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
        private static partial byte* RealPath(string path, byte* resolved);

        [LibraryImport("libc", EntryPoint = "statx", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
        private static partial int Statx(int folder, string path, int flags, uint mask, StatxBuffer* buffer);

        // struct open_how from linux/openat2.h: three u64 fields, 24 bytes.
        [StructLayout(LayoutKind.Sequential)]
        private struct OpenHow
        {
            public ulong Flags;
            public ulong Mode;
            public ulong Resolve;
        }

        // struct statx from the Linux UAPI; only the fields read here are named.
        [StructLayout(LayoutKind.Explicit, Size = 256)]
        private struct StatxBuffer
        {
            [FieldOffset(0)]
            public uint Mask;

            [FieldOffset(8)]
            public ulong Attributes;

            [FieldOffset(16)]
            public uint Links;

            [FieldOffset(28)]
            public ushort Mode;

            [FieldOffset(32)]
            public ulong Inode;

            [FieldOffset(56)]
            public ulong AttributesMask;

            [FieldOffset(136)]
            public uint DeviceMajor;

            [FieldOffset(140)]
            public uint DeviceMinor;
        }
    }
}
