using System.Diagnostics;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// Neither a junction nor a Linux symbolic link needs a privilege, so a failure to make one fails.
internal sealed class FolderLink : IDisposable
{
    private readonly string _path;

    public FolderLink(string path, string target)
    {
        _path = path;
        if (!OperatingSystem.IsWindows())
        {
            Directory.CreateSymbolicLink(path, target);
            return;
        }

        var start = new ProcessStartInfo("cmd.exe") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var argument in (string[])["/d", "/c", "mklink", "/J", path, target])
        {
            start.ArgumentList.Add(argument);
        }

        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
        process.WaitForExit();
        Assert.True(process.ExitCode == 0, "the junction could not be made: " + output);
    }

    // Removes the link itself, never what it reaches.
    public void Dispose()
    {
        if (OperatingSystem.IsWindows())
        {
            Directory.Delete(_path);
        }
        else
        {
            File.Delete(_path);
        }
    }
}
