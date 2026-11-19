namespace SharpLadder.CodeCheck;

// One deadline bounds a child from launch to exit, start-up and release included; cleanup has its own.
internal static class RunLimits
{
    public const int OutputCapBytes = 64 * 1024;

    public static TimeSpan Launch { get; } = TimeSpan.FromSeconds(5);

    // A suite runs every check of its subject in one child, where a group runs a few blocks.
    public static TimeSpan Suite { get; } = TimeSpan.FromSeconds(10);

    public static TimeSpan Cleanup { get; } = TimeSpan.FromSeconds(2);
}
