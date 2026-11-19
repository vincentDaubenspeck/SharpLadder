namespace SharpLadder.CodeCheck;

// The child's own account of itself before release; the checker validates it and never takes the
// expected runtime directory from it. ProcessGroup and Session are present on Linux only.
internal sealed record StartRecord(int ProcessId, string CoreLibraryDirectory, int? ProcessGroup, int? Session);
