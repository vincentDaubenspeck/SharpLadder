using System.Diagnostics;
using System.Security.Cryptography;
using Xunit;

namespace SharpLadder.Content.Tests;

// Copies of the schema and fixture roots with a web/ folder beside them; seeded, the committed
// folders hold what update publishes from those copies.
internal sealed class PayloadWorkspace : IDisposable
{
    private readonly TempFolder _temp = new();
    private int _stages;

    public PayloadWorkspace(bool seed = true, string newline = "\n")
    {
        Repository.CopyTree(Repository.SchemaFolder, Schema, "\n");
        Repository.CopyTree(Repository.Fixture, Content, newline);
        if (seed)
        {
            var seeded = Run("update");
            Assert.True(seeded.Code == 0, seeded.Output);
        }
    }

    public string Root => _temp.Path;

    public string Schema => Path.Combine(Root, "schema");

    public string Content => Path.Combine(Root, "content");

    public string Web => Path.Combine(Root, "web");

    public string Compiled => Path.Combine(Web, "compiled");

    public string Generated => Path.Combine(Web, "src", "generated");

    public static CliResult Invoke(IReadOnlyList<string> args, Action? betweenDestinations = null, byte[]? stdin = null)
    {
        using var output = new StringWriter { NewLine = "\n" };
        using var error = new StringWriter { NewLine = "\n" };
        byte[] stdout = [];
        var code = Cli.Run(args, new CliStreams(output, error, () => new CapturingStream(b => stdout = b), () => new MemoryStream(stdin ?? [])), betweenDestinations);
        return new CliResult(code, output.ToString(), error.ToString(), stdout);
    }

    // The built compiler in its own process, standard output captured as bytes.
    public static async Task<(int Code, byte[] Stdout, string Error)> RunProcessAsync(params string[] args)
    {
        var runtime = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
        var dotnet = Path.Combine(Path.GetFullPath(Path.Combine(runtime, "..", "..", "..")), OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        var start = new ProcessStartInfo(dotnet) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "SharpLadder.Content.dll"));
        foreach (var arg in args)
        {
            start.ArgumentList.Add(arg);
        }

        using var process = System.Diagnostics.Process.Start(start)!;
        var error = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        using var stdout = new MemoryStream();
        await process.StandardOutput.BaseStream.CopyToAsync(stdout, TestContext.Current.CancellationToken).ConfigureAwait(false);
        await process.WaitForExitAsync(TestContext.Current.CancellationToken).ConfigureAwait(false);
        return (process.ExitCode, stdout.ToArray(), await error.ConfigureAwait(false));
    }

    // A file's content hash and write time, by path relative to folder.
    public static Dictionary<string, (string Hash, DateTime Written)> Snapshot(string folder) =>
        Directory.Exists(folder)
            ? Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories).ToDictionary(
                f => Path.GetRelativePath(folder, f),
                f => (Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(f))), File.GetLastWriteTimeUtc(f)),
                StringComparer.Ordinal)
            : [];

    public static void AssertSame(Dictionary<string, (string Hash, DateTime Written)> before, Dictionary<string, (string Hash, DateTime Written)> after)
    {
        Assert.Equal(before.Keys.Order(StringComparer.Ordinal), after.Keys.Order(StringComparer.Ordinal));
        foreach (var (path, value) in before)
        {
            Assert.Equal(value, after[path]);
        }
    }

    // cmd prints the 8.3 form of each component that has one.
    public static string ShortPath(string path)
    {
        var start = new ProcessStartInfo("cmd.exe")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Arguments = $"/d /c for %I in (\"{path}\") do @echo %~sI",
        };
        using var process = System.Diagnostics.Process.Start(start)!;
        var shortName = process.StandardOutput.ReadToEnd().Trim();
        process.StandardError.ReadToEnd();
        process.WaitForExit();
        Assert.SkipUnless(process.ExitCode == 0 && shortName.Length > 0, "cannot read the short name of " + path);
        Assert.SkipUnless(!string.Equals(shortName, path, StringComparison.OrdinalIgnoreCase), "short names are disabled on this volume");
        return shortName;
    }

    public static string Write(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    public string RootOf(string name) => name switch
    {
        "schema" => Schema,
        "content" => Content,
        "compiled" => Compiled,
        "generated" => Generated,
        _ => throw new ArgumentOutOfRangeException(nameof(name), name, "unknown root"),
    };

    public string NewStage() => Path.Combine(Root, $"stage{++_stages}");

    public string[] Args(string mode, string? staging = null, string? compiled = null, string? generated = null) =>
        [mode, Schema, Content, compiled ?? Compiled, generated ?? Generated, staging ?? NewStage()];

    public CliResult Run(string mode, string? staging = null, string? compiled = null, string? generated = null, Action? betweenDestinations = null) =>
        Invoke(Args(mode, staging, compiled, generated), betweenDestinations);

    public void Dispose() => _temp.Dispose();
}
