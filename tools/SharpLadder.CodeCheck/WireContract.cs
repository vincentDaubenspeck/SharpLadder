namespace SharpLadder.CodeCheck;

// Protocol version 1 between the checker and a group's child: the two channels, the record kinds
// and fields, and the bounds. Records carry no version field; this contract is the version.
internal static class WireContract
{
    public const int ProtocolVersion = 1;

    public const string TokenVariable = "SHARPLADDER_CODECHECK_TOKEN";
    public const string ResultsVariable = "SHARPLADDER_CODECHECK_RESULTS";

    public const int TokenBytes = 32;
    public const int TokenLength = 2 * TokenBytes;

    // The token and a line feed, in ASCII.
    public const int ReleaseLength = TokenLength + 1;

    public const int MaxRecordBytes = 16 * 1024;
    public const int ActualTypeLength = 512;

    // The child's status when start-up or a record fails; it matches no terminal record.
    public const int HarnessFailureExit = 3;

    public const int ContentFailureExit = 1;

    public const string StartKind = "start";
    public const string CheckKind = "check";
    public const string EndKind = "end";
    public const string ExceptionKind = "exception";
    public const string CheckFailedKind = "check-failed";

    public const string TokenField = "token";
    public const string KindField = "kind";
    public const string PidField = "pid";
    public const string CoreLibraryDirectoryField = "coreLibraryDirectory";
    public const string PgidField = "pgid";
    public const string SidField = "sid";
    public const string BlockIdField = "blockId";
    public const string ExactTypeMatchField = "exactTypeMatch";
    public const string ActualTypeField = "actualType";

    // The only names the child inherits; with the two channels they are its whole environment.
    public static IReadOnlyList<string> WindowsInherited { get; } = ["PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE"];

    public static IReadOnlyList<string> LinuxInherited { get; } = ["PATH", "TMPDIR", "HOME"];

    public static TimeSpan FirstRecordPoll { get; } = TimeSpan.FromMilliseconds(10);
}
