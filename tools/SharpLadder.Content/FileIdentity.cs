using System.Runtime.InteropServices;

namespace SharpLadder.Content;

// What the kernel says a file is: volume serial and 128-bit file id on Windows, device and inode
// on Linux. Two handles with equal identities name the same file.
[StructLayout(LayoutKind.Auto)]
internal readonly record struct FileIdentity(ulong Device, ulong High, ulong Low);
