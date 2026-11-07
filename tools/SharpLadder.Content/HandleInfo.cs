using System.Runtime.InteropServices;

namespace SharpLadder.Content;

// IsLink is a symbolic link on Linux and any reparse point on Windows. On Linux a FIFO, socket or
// device is neither a folder nor a regular file. IsMountRoot is the root of a Linux mount, a bind
// mount included.
[StructLayout(LayoutKind.Auto)]
internal readonly record struct HandleInfo(FileIdentity Id, bool IsFolder, bool IsRegularFile, bool IsLink, uint Links, bool IsMountRoot);
