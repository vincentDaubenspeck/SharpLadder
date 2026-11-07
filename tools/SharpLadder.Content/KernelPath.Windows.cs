using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace SharpLadder.Content;

internal static partial class KernelPath
{
    // Win32 opens a root by path; everything below it is opened relative to a folder handle with
    // NtCreateFile, which takes the name as one component, applies no Win32 name rewriting and,
    // with FILE_OPEN_REPARSE_POINT, opens a reparse point as itself instead of following it.
    [SupportedOSPlatform("windows")]
    private static unsafe partial class Windows
    {
        private const uint FileListDirectory = 0x1;
        private const uint FileAddFile = 0x2;
        private const uint FileAddSubdirectory = 0x4;
        private const uint FileTraverse = 0x20;
        private const uint FileReadAttributes = 0x80;
        private const uint Delete = 0x10000;
        private const uint Synchronize = 0x100000;
        private const uint GenericWrite = 0x40000000;
        private const uint GenericRead = 0x80000000;
        private const uint ShareRead = 0x1;
        private const uint ShareAll = 0x7;
        private const uint OpenExisting = 3;
        private const uint FlagOpenReparsePoint = 0x00200000;
        private const uint FlagBackupSemantics = 0x02000000;
        private const uint FileTypeDisk = 1;
        private const uint FileNameNormalized = 0x0;
        private const uint VolumeNameDos = 0x0;
        private const uint AttributeReparsePoint = 0x400;
        private const uint AttributeNormal = 0x80;
        private const uint FileOpen = 1;
        private const uint FileCreate = 2;
        private const uint DirectoryFile = 0x1;
        private const uint SynchronousIo = 0x20;
        private const uint NonDirectoryFile = 0x40;
        private const uint OpenReparsePoint = 0x200000;
        private const uint CaseInsensitive = 0x40;
        private const int FileStandardInfoClass = 1;
        private const int FileDispositionInfoClass = 4;
        private const int FileAttributeTagInfoClass = 9;
        private const int FileIdInfoClass = 18;
        private const int ErrorFileNotFound = 2;
        private const int ErrorPathNotFound = 3;
        private const int StatusObjectNameNotFound = unchecked((int)0xC0000034);
        private const int StatusObjectPathNotFound = unchecked((int)0xC000003A);

        public static SafeFileHandle? TryOpen(string path, string display, bool follow)
        {
            var flags = FlagBackupSemantics | (follow ? 0 : FlagOpenReparsePoint);
            var handle = CreateFile(path, FileReadAttributes | Synchronize, ShareAll, 0, OpenExisting, flags, 0);
            if (!handle.IsInvalid)
            {
                return handle;
            }

            var error = Marshal.GetLastPInvokeError();
            handle.Dispose();
            return error is ErrorFileNotFound or ErrorPathNotFound ? null : throw Failure(display, "CreateFileW", error);
        }

        public static string Canonical(SafeFileHandle handle, string display)
        {
            var buffer = new char[512];
            while (true)
            {
                uint length;
                fixed (char* text = buffer)
                {
                    length = GetFinalPathNameByHandle(handle, text, (uint)buffer.Length, FileNameNormalized | VolumeNameDos);
                }

                if (length == 0)
                {
                    throw Failure(display, "GetFinalPathNameByHandleW (FILE_NAME_NORMALIZED, VOLUME_NAME_DOS)", Marshal.GetLastPInvokeError());
                }

                if (length < buffer.Length)
                {
                    return DriveForm(new string(buffer, 0, (int)length), display);
                }

                buffer = new char[length];
            }
        }

        public static HandleInfo Inspect(SafeFileHandle handle, string display)
        {
            var type = GetFileType(handle);
            if (type != FileTypeDisk)
            {
                var error = Marshal.GetLastPInvokeError();
                throw error != 0 ? Failure(display, "GetFileType", error) : new BoundaryException($"{display}: not a file or folder on a disk");
            }

            IdInfo id;
            StandardInfo standard;
            AttributeTagInfo tag;
            Query(handle, FileIdInfoClass, &id, (uint)sizeof(IdInfo), display, "FileIdInfo");
            Query(handle, FileStandardInfoClass, &standard, (uint)sizeof(StandardInfo), display, "FileStandardInfo");
            Query(handle, FileAttributeTagInfoClass, &tag, (uint)sizeof(AttributeTagInfo), display, "FileAttributeTagInfo");
            if (id.FileIdLow == 0 && id.FileIdHigh == 0)
            {
                throw new BoundaryException($"{display}: the file system gives no file id (FileIdInfo)");
            }

            var isFolder = standard.Directory != 0;
            var isLink = (tag.FileAttributes & AttributeReparsePoint) != 0;

            // A mount point (IO_REPARSE_TAG_MOUNT_POINT) is a reparse point, so IsLink covers it.
            return new HandleInfo(new FileIdentity(id.VolumeSerialNumber, id.FileIdHigh, id.FileIdLow), isFolder, !isFolder, isLink, standard.NumberOfLinks, IsMountRoot: false);
        }

        public static SafeFileHandle? TryOpenChild(SafeFileHandle folder, string name, bool forReading, string display)
        {
            var access = forReading ? GenericRead | FileReadAttributes | Synchronize : FileReadAttributes | Synchronize;
            var options = OpenReparsePoint | SynchronousIo | (forReading ? NonDirectoryFile : 0);
            var handle = Create(folder, name, access, 0, forReading ? ShareRead : ShareAll, FileOpen, options, out var status);
            return handle is not null || status is StatusObjectNameNotFound or StatusObjectPathNotFound
                ? handle
                : throw StatusFailure(display, "NtCreateFile (open)", status);
        }

        public static SafeFileHandle CreateChild(SafeFileHandle folder, string name, bool isFolder, string display)
        {
            var (access, attributes, share, options) = isFolder
                ? (FileListDirectory | FileAddFile | FileAddSubdirectory | FileTraverse | FileReadAttributes | Synchronize, 0u, ShareAll, DirectoryFile)
                : (GenericWrite | FileReadAttributes | Synchronize, AttributeNormal, ShareRead, NonDirectoryFile);
            return Create(folder, name, access, attributes, share, FileCreate, options | OpenReparsePoint | SynchronousIo, out var status)
                ?? throw StatusFailure(display, "NtCreateFile (create new)", status);
        }

        public static void RemoveChild(SafeFileHandle folder, string name, FileIdentity expected, string display)
        {
            using var handle = Create(folder, name, Delete | FileReadAttributes | Synchronize, 0, ShareAll, FileOpen, OpenReparsePoint | SynchronousIo, out var status)
                ?? throw StatusFailure(display, "NtCreateFile (open to remove)", status);
            if (Inspect(handle, display).Id != expected)
            {
                throw new BoundaryException($"{display}: not removed; it is no longer the entry this run created");
            }

            var disposition = new DispositionInfo { DeleteFile = 1 };
            if (!SetFileInformationByHandle(handle, FileDispositionInfoClass, &disposition, (uint)sizeof(DispositionInfo)))
            {
                throw Failure(display, "SetFileInformationByHandle (FileDispositionInfo)", Marshal.GetLastPInvokeError());
            }
        }

        // VOLUME_NAME_DOS answers in \\?\ form; any answer but a drive letter after it is refused.
        private static string DriveForm(string final, string display)
        {
            var onDrive = final.Length >= 7 && final.StartsWith(@"\\?\", StringComparison.Ordinal)
                && char.IsAsciiLetter(final[4]) && final[5] == ':' && final[6] == '\\';
            return onDrive
                ? Path.TrimEndingDirectorySeparator(final[4..])
                : throw new BoundaryException($"{display}: the kernel names it {final}, which is not a path on a drive letter");
        }

        private static void Query(SafeFileHandle handle, int informationClass, void* information, uint size, string display, string name)
        {
            if (!GetFileInformationByHandleEx(handle, informationClass, information, size))
            {
                throw Failure(display, $"GetFileInformationByHandleEx ({name})", Marshal.GetLastPInvokeError());
            }
        }

        private static BoundaryException StatusFailure(string display, string check, int status) =>
            new($"{display}: {check} failed: {Marshal.GetPInvokeErrorMessage((int)RtlNtStatusToDosError(status))} (status 0x{status.ToString("X8", CultureInfo.InvariantCulture)})");

        // Null when NtCreateFile fails, with its status.
        private static SafeFileHandle? Create(SafeFileHandle folder, string name, uint access, uint attributes, uint share, uint disposition, uint options, out int status)
        {
            if (name.Length is 0 or > 255 || name.Contains('\\', StringComparison.Ordinal) || name.Contains('/', StringComparison.Ordinal))
            {
                throw new BoundaryException($"{name}: not a single file name");
            }

            var added = false;
            folder.DangerousAddRef(ref added);
            try
            {
                fixed (char* text = name)
                {
                    var unicode = new UnicodeString { Length = (ushort)(name.Length * 2), MaximumLength = (ushort)(name.Length * 2), Buffer = text };
                    var attributesBlock = new ObjectAttributes
                    {
                        Length = (uint)sizeof(ObjectAttributes),
                        RootDirectory = folder.DangerousGetHandle(),
                        ObjectName = &unicode,
                        Attributes = CaseInsensitive,
                    };
                    IoStatusBlock io;
                    nint raw;
                    status = NtCreateFile(&raw, access, &attributesBlock, &io, null, attributes, share, disposition, options, null, 0);
                    return status == 0 ? new SafeFileHandle(raw, ownsHandle: true) : null;
                }
            }
            finally
            {
                if (added)
                {
                    folder.DangerousRelease();
                }
            }
        }

        [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static partial SafeFileHandle CreateFile(string fileName, uint desiredAccess, uint shareMode, nint securityAttributes, uint creationDisposition, uint flagsAndAttributes, nint templateFile);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static partial uint GetFileType(SafeFileHandle file);

        [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static partial uint GetFinalPathNameByHandle(SafeFileHandle file, char* path, uint length, uint flags);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool GetFileInformationByHandleEx(SafeFileHandle file, int informationClass, void* information, uint size);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool SetFileInformationByHandle(SafeFileHandle file, int informationClass, void* information, uint size);

        [LibraryImport("ntdll.dll")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static partial int NtCreateFile(nint* handle, uint desiredAccess, ObjectAttributes* objectAttributes, IoStatusBlock* ioStatus, long* allocationSize, uint fileAttributes, uint shareAccess, uint createDisposition, uint createOptions, void* eaBuffer, uint eaLength);

        [LibraryImport("ntdll.dll")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static partial uint RtlNtStatusToDosError(int status);

        [StructLayout(LayoutKind.Sequential)]
        private struct IdInfo
        {
            public ulong VolumeSerialNumber;
            public ulong FileIdLow;
            public ulong FileIdHigh;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct StandardInfo
        {
            public long AllocationSize;
            public long EndOfFile;
            public uint NumberOfLinks;
            public byte DeletePending;
            public byte Directory;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct AttributeTagInfo
        {
            public uint FileAttributes;
            public uint ReparseTag;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DispositionInfo
        {
            public byte DeleteFile;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct UnicodeString
        {
            public ushort Length;
            public ushort MaximumLength;
            public char* Buffer;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ObjectAttributes
        {
            public uint Length;
            public nint RootDirectory;
            public UnicodeString* ObjectName;
            public uint Attributes;
            public void* SecurityDescriptor;
            public void* SecurityQualityOfService;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoStatusBlock
        {
            public nint Status;
            public nuint Information;
        }
    }
}
