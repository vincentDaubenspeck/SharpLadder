namespace SharpLadder.CodeCheck.Tests;

// Content for groups compiled with the test-only harness variant: each relaunched process writes
// its readiness file in the folder before the content that started it goes on.
internal static class Descendants
{
    // One sleeping descendant, started by the group's own process.
    public static string Sleeper(string folder) =>
        $"using var sleeper = SharpLadderHarness.Relaunch(\"sharpladder-sleep\", @\"{folder}\");\nSharpLadderHarness.AwaitReady(@\"{folder}\", 1);\n";

    // An intermediate that starts a sleeping descendant and exits, leaving it orphaned.
    public static string Orphan(string folder) =>
        $"using var orphan = SharpLadderHarness.Relaunch(\"sharpladder-orphan\", @\"{folder}\");\norphan.WaitForExit();\nSharpLadderHarness.AwaitReady(@\"{folder}\", 2);\n";
}
