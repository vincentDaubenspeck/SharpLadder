using System.Diagnostics;

namespace SharpLadder.Policy;

// A project without its restore output compiles against no packages, so its errors say
// nothing about its code. MSBuild names the assets file the restore writes; the check reads
// that property rather than assuming where the file lives.
internal static class ProjectAssets
{
    internal const string Property = "ProjectAssetsFile";

    // Null, unlike empty, means evaluation failed, so the restore state is unknown.
    internal static string? Evaluate(string host, string project)
    {
        var start = new ProcessStartInfo(host)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(project) ?? Environment.CurrentDirectory,
        };
        foreach (var arg in (string[])["msbuild", project, "-getProperty:" + Property, "-nologo"])
        {
            start.ArgumentList.Add(arg);
        }

        Process? started;
        try
        {
            started = Process.Start(start);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return null;
        }

        using var msbuild = started;
        if (msbuild is null)
        {
            return null;
        }

        // Drained so a full error pipe cannot stall the child; a failure shows in the exit code.
        msbuild.ErrorDataReceived += (_, _) => { };
        msbuild.BeginErrorReadLine();
        var output = msbuild.StandardOutput.ReadToEnd();
        msbuild.WaitForExit();
        var value = output.Trim();
        return msbuild.ExitCode == 0 && !value.Contains('\n', StringComparison.Ordinal) ? value : null;
    }

    internal static string? Problem(string name, string? assetsFile, Func<string, bool> exists)
    {
        if (assetsFile is null)
        {
            return name + ": " + Property + " does not evaluate, so the check cannot tell whether it is restored";
        }

        return assetsFile.Length > 0 && !exists(assetsFile) ? name + ": not restored; run dotnet restore" : null;
    }
}
