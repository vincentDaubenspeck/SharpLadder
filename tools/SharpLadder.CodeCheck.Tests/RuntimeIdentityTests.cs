using System.Diagnostics;
using Xunit;
using static SharpLadder.CodeCheck.Tests.Runs;

namespace SharpLadder.CodeCheck.Tests;

// The runtime proofs: the child runs on the chosen install's 10.0.15 and on nothing else, whatever
// the checker's own environment says. Roots that lack a runtime are copies; the live install is
// only ever read.
[Collection(Serial.Name)]
public sealed class RuntimeIdentityTests(CompilerFixture fixture, ITestOutputHelper output) : IClassFixture<CompilerFixture>
{
    private const string Runtimes = "Microsoft.NETCore.App";

    // The host's own status when no framework satisfies the configuration, 0x80008096, of which a
    // Linux exit status keeps the low byte: it refused before the harness could write a start
    // record, so no content ran.
    private static readonly string NoFramework = OperatingSystem.IsWindows()
        ? "group \"identity\" of chapters/run/blocks.md: exited with status -2147450730 before its start record"
        : "group \"identity\" of chapters/run/blocks.md: exited with status 150 before its start record";

    // The runner's own values, read before any test here changes them.
    private static readonly string?[] OriginalRoots = [.. new[] { "DOTNET_ROOT", "DOTNET_ROOT_X64", "DOTNET_ROOT_ARM64", "DOTNET_ROOT(x86)" }.Select(Environment.GetEnvironmentVariable)];

    private static Locations Live => Locations.FromRepository(Checker.RepositoryRoot);

    [Fact]
    public void ChildRunsOnTheChosenInstall()
    {
        var (failure, observed) = Prove(Live);

        Assert.Null(failure);
        AssertObserved(Live, observed);
        output.WriteLine($"child start-up, creation to first block: {observed[3]} ms");
    }

    [Fact]
    public void RollForwardInTheCheckersEnvironmentChangesNothing()
    {
        // Copies of the 10.0.15 files under the names 10.0.16 and 11.0.0: version-named stand-ins
        // a rolled-forward host would pick, not genuine newer runtimes.
        using var root = CopiedRoot("10.0.15", "10.0.16", "11.0.0");
        var copied = Locations.FromRepository(root.Path);
        foreach (var policy in new[] { "LatestPatch", "LatestMajor" })
        {
            var (failure, observed) = WithVariables([("DOTNET_ROLL_FORWARD", policy)], () => Prove(copied));

            Assert.Null(failure);
            AssertObserved(copied, observed);
        }
    }

    [Fact]
    public void CopiedRootWithoutTheRuntimeExitsTwoAndRunsNothing()
    {
        using var root = CopiedRoot("10.0.16", "11.0.0");

        var problem = Assert.Throws<ToolProblem>(() => Prove(Locations.FromRepository(root.Path)));

        Assert.Equal(NoFramework, problem.Message);
    }

    [Fact]
    public void AmbientInstallChangesNothing()
    {
        RequireBackend();
        var backend = Backend();
        var privateRoot = backend.Canonical(Path.GetDirectoryName(Live.Muxer)!);
        var ambient = Ambient(backend, privateRoot);
        if (ambient is null)
        {
            Assert.False(string.Equals(Environment.GetEnvironmentVariable("GITHUB_ACTIONS"), "true", StringComparison.Ordinal), "no .NET install apart from the private one on the hosted runner");
            Assert.Skip("no .NET install apart from the private one on this machine");
        }

        output.WriteLine($"ambient install: {ambient}");
        var (code, listed) = ListRuntimes(Live.Muxer, ambient);
        Assert.Equal(0, code);
        Assert.NotEmpty(listed);
        Assert.All(listed, line => Assert.StartsWith(privateRoot + Path.DirectorySeparatorChar, backend.Canonical(line[(line.IndexOf('[', StringComparison.Ordinal) + 1)..^1]), StringComparison.Ordinal));

        var (failure, observed) = WithVariables([("DOTNET_ROOT", ambient), ("DOTNET_ROOT_X64", ambient)], () => Prove(Live));

        Assert.Null(failure);
        AssertObserved(Live, observed);
    }

    [Fact]
    public void MissingRuntimeExitsTwoAndRunsNothing()
    {
        using var root = CopiedRoot();

        var problem = Assert.Throws<ToolProblem>(() => Prove(Locations.FromRepository(root.Path)));

        Assert.Equal(NoFramework, problem.Message);
    }

    private static void AssertObserved(Locations locations, string[] observed)
    {
        var backend = Backend();
        var expected = backend.Canonical(locations.RuntimeDirectory);
        Assert.Equal("10.0.15", observed[0]);
        Assert.Equal(expected, backend.Canonical(observed[1]));
        Assert.Equal(expected, backend.Canonical(observed[2]));
    }

    private static T WithVariables<T>((string Name, string Value)[] variables, Func<T> run)
    {
        var before = variables.Select(v => Environment.GetEnvironmentVariable(v.Name)).ToArray();
        try
        {
            foreach (var (name, value) in variables)
            {
                Environment.SetEnvironmentVariable(name, value);
            }

            return run();
        }
        finally
        {
            for (var i = 0; i < variables.Length; i++)
            {
                Environment.SetEnvironmentVariable(variables[i].Name, before[i]);
            }
        }
    }

    // A private short-path root: the muxer, its host resolver and each named runtime folder.
    private static TempFolder CopiedRoot(params string[] runtimes)
    {
        var live = Live;
        var root = new TempFolder();
        var dotnet = Path.Combine(root.Path, ".tools", "dotnet");
        Copy(live.ToolPins, Path.Combine(root.Path, "tools", "tool-pins.json"));
        Copy(live.Muxer, Path.Combine(dotnet, Path.GetFileName(live.Muxer)));
        CopyTree(Path.Combine(Path.GetDirectoryName(live.Muxer)!, "host"), Path.Combine(dotnet, "host"));
        foreach (var runtime in runtimes)
        {
            CopyTree(live.RuntimeDirectory, Path.Combine(dotnet, "shared", Runtimes, runtime));
        }

        return root;
    }

    private static void CopyTree(string from, string to)
    {
        foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            Copy(file, Path.Combine(to, Path.GetRelativePath(from, file)));
        }
    }

    private static void Copy(string from, string to)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(to)!);
        System.IO.File.Copy(from, to);
    }

    // The first install outside the private root whose own muxer lists a runtime. A muxer on PATH may
    // be a link into its install, as /usr/bin/dotnet is on Linux; the install is where it leads.
    private static string? Ambient(IRunBackend backend, string privateRoot)
    {
        string[] linuxRoots = OperatingSystem.IsLinux() ? ["/usr/share/dotnet", "/usr/lib/dotnet"] : [];
        var known = new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 }
            .Select(f => Path.Combine(Environment.GetFolderPath(f), "dotnet"))
            .Append(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "dotnet"))
            .Append(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dotnet"))
            .Concat(linuxRoots);
        var onPath = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var candidate in OriginalRoots.OfType<string>().Concat(onPath).Concat(known))
        {
            var muxer = Path.Combine(candidate, Path.GetFileName(Live.Muxer));
            if (!System.IO.File.Exists(muxer))
            {
                continue;
            }

            var install = System.IO.File.ResolveLinkTarget(muxer, returnFinalTarget: true) is { } target ? Path.GetDirectoryName(target.FullName)! : candidate;
            if (string.Equals(backend.Canonical(install), privateRoot, StringComparison.Ordinal))
            {
                continue;
            }

            var (code, listed) = ListRuntimes(Path.Combine(install, Path.GetFileName(Live.Muxer)), null);
            if (code == 0 && listed.Any(l => l.StartsWith(Runtimes + " ", StringComparison.Ordinal)))
            {
                return install;
            }
        }

        return null;
    }

    private static (int Code, string[] Lines) ListRuntimes(string muxer, string? dotnetRoot)
    {
        var start = new ProcessStartInfo(muxer) { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add("--list-runtimes");
        foreach (var name in new[] { "DOTNET_ROOT", "DOTNET_ROOT_X64" })
        {
            start.Environment.Remove(name);
            if (dotnetRoot is not null)
            {
                start.Environment[name] = dotnetRoot;
            }
        }

        using var process = Process.Start(start)!;
        var lines = process.StandardOutput.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        process.WaitForExit();
        return (process.ExitCode, lines);
    }

    // The group reports what it loaded, not what it was configured with: its version, the core
    // library's directory, the native runtime module's directory from the module list, and how
    // long after its creation its first block ran.
    private (string? Failure, string[] Observed) Prove(Locations locations)
    {
        using var folder = new TempFolder();
        var file = Path.Combine(folder.Path, "observed.txt");
        var source = "var core = Path.GetDirectoryName(typeof(object).Assembly.Location)!;\n"
            + "var nativeName = OperatingSystem.IsWindows() ? \"coreclr.dll\" : \"libcoreclr.so\";\n"
            + "var native = \"\";\n"
            + "using var self = System.Diagnostics.Process.GetCurrentProcess();\n"
            + "foreach (System.Diagnostics.ProcessModule module in self.Modules)\n{\n"
            + "    if (string.Equals(module.ModuleName, nativeName, StringComparison.OrdinalIgnoreCase))\n    {\n"
            + "        native = Path.GetDirectoryName(module.FileName)!;\n    }\n}\n\n"
            + "var startUp = (DateTime.Now - self.StartTime).TotalMilliseconds;\n"
            + $"File.WriteAllLines(@\"{file}\", [Environment.Version.ToString(), core, native, startUp.ToString(\"F0\")]);\n";
        var group = Compile(fixture.Compiler, Block("identity", 10, source, check: "Environment.Version == new Version(10, 0, 15)"));
        var failure = new GroupRunner(locations, Backend()).Run(group)?.ToString();
        return (failure, System.IO.File.Exists(file) ? System.IO.File.ReadAllLines(file) : []);
    }
}
