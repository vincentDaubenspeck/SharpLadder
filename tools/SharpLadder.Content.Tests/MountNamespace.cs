using System.Diagnostics;
using Xunit;

namespace SharpLadder.Content.Tests;

// Runs the compiler in a private mount namespace after bind mounts that would otherwise need
// root: through an unprivileged user namespace where the kernel allows one, else through sudo
// without a password prompt, with the compiler dropped back to the calling user. Skips when
// neither can mount.
internal static class MountNamespace
{
    private const string Ready = "mount-namespace-ready";

    // Arguments: bind pairs, then --, then the command. The marker shows the mounts took effect.
    private const string Script = """
        while [ "$1" != "--" ]; do mount --bind "$1" "$2" || exit 97; shift 2; done
        shift
        echo mount-namespace-ready
        if [ -n "${SUDO_UID:-}" ]; then exec setpriv --reuid="$SUDO_UID" --regid="$SUDO_GID" --clear-groups "$@"; fi
        exec "$@"
        """;

    public static (int Code, string Text) Compile(IReadOnlyList<(string Source, string Target)> binds, params string[] args)
    {
        Assert.SkipUnless(OperatingSystem.IsLinux(), "bind mounts are a Linux case");
        var runtime = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
        var dotnet = Path.GetFullPath(Path.Combine(runtime, "..", "..", "..", "dotnet"));
        var compiler = Path.Combine(AppContext.BaseDirectory, "SharpLadder.Content.dll");
        var tail = new List<string> { "sh", "-c", Script, "sh" };
        foreach (var (source, target) in binds)
        {
            tail.Add(source);
            tail.Add(target);
        }

        tail.AddRange(["--", dotnet, compiler, .. args]);
        var problems = new List<string>();
        foreach (var prefix in new[] { new[] { "unshare", "--user", "--map-root-user", "--mount" }, ["sudo", "-n", "unshare", "--mount"] })
        {
            var (code, text) = Start([.. prefix, .. tail]);
            var marker = text.IndexOf(Ready + "\n", StringComparison.Ordinal);
            if (marker >= 0)
            {
                return (code, text[(marker + Ready.Length + 1)..]);
            }

            problems.Add($"{prefix[0]}: exit {code}: {text.Trim()}");
        }

        Assert.Skip("cannot bind mount in a private namespace here: " + string.Join("; ", problems));
        return default;
    }

    private static (int Code, string Text) Start(IReadOnlyList<string> command)
    {
        var start = new ProcessStartInfo(command[0]) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in command.Skip(1))
        {
            start.ArgumentList.Add(arg);
        }

        try
        {
            // Both streams stay far below a pipe buffer, so reading one after the other cannot stall.
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            return (process.ExitCode, output + error);
        }
        catch (System.ComponentModel.Win32Exception e)
        {
            return (-1, e.Message);
        }
    }
}
