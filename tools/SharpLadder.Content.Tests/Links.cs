using System.Diagnostics;
using Xunit;

namespace SharpLadder.Content.Tests;

internal sealed class Links : IDisposable
{
    private readonly string _link;
    private readonly bool _isFile;

    private Links(string link, bool isFile)
    {
        _link = link;
        _isFile = isFile;
    }

    // Windows gets a junction, which needs no symbolic link privilege; elsewhere a symbolic link.
    // The target need not exist.
    public static Links Folder(string link, string target)
    {
        if (OperatingSystem.IsWindows())
        {
            Command("cmd.exe", "cannot create a junction", "/d", "/c", "mklink", "/J", link, target);
            return new Links(link, isFile: false);
        }

        return Symbolic(link, target);
    }

    // A symbolic link holding the target exactly as written, so it may be relative.
    public static Links Symbolic(string link, string target)
    {
        try
        {
            Directory.CreateSymbolicLink(link, target);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Assert.Skip("this account cannot create symbolic links: " + e.Message);
        }

        return new Links(link, isFile: false);
    }

    public static Links SymbolicFile(string link, string target)
    {
        try
        {
            File.CreateSymbolicLink(link, target);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Assert.Skip("this account cannot create symbolic links: " + e.Message);
        }

        return new Links(link, isFile: true);
    }

    // A second name for the same file; neither Windows nor Linux needs a privilege for it.
    public static Links Hard(string link, string target)
    {
        if (OperatingSystem.IsWindows())
        {
            Command("cmd.exe", "cannot create a hard link", "/d", "/c", "mklink", "/H", link, target);
        }
        else
        {
            Command("ln", "cannot create a hard link", target, link);
        }

        return new Links(link, isFile: true);
    }

    public static void Command(string program, string skipReason, params string[] args)
    {
        var start = new ProcessStartInfo(program) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in args)
        {
            start.ArgumentList.Add(arg);
        }

        using var process = Process.Start(start)!;
        var error = process.StandardError.ReadToEnd() + process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            Assert.Skip($"{skipReason}: {error}");
        }
    }

    // A recursive delete would try to unmount a junction, which needs elevation; a Unix link
    // that ends in a loop cannot be removed as a folder.
    public void Dispose()
    {
        if (OperatingSystem.IsWindows() && !_isFile)
        {
            Directory.Delete(_link);
        }
        else
        {
            File.Delete(_link);
        }
    }
}
