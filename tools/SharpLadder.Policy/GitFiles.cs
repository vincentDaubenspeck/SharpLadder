using System.Diagnostics;

namespace SharpLadder.Policy;

internal static class GitFiles
{
    internal static IReadOnlyList<string>? List(string directory, params string[] patterns)
    {
        var start = new ProcessStartInfo("git")
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
            WorkingDirectory = directory,
        };
        foreach (var arg in (string[])["-c", "core.quotepath=off", "ls-files", "-z", "--", .. patterns])
        {
            start.ArgumentList.Add(arg);
        }

        using var git = Process.Start(start);
        if (git is null)
        {
            return null;
        }

        var output = git.StandardOutput.ReadToEnd();
        git.WaitForExit();
        return git.ExitCode == 0 ? output.Split('\0', StringSplitOptions.RemoveEmptyEntries) : null;
    }
}
