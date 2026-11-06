using Xunit;

namespace SharpLadder.Policy.Tests;

public sealed class ProjectAssetsTests
{
    [Fact]
    public void UnrestoredProjectIsReportedAsNotRestored()
    {
        var dir = Directory.CreateTempSubdirectory("sharpladder-assets-");
        try
        {
            var project = Path.Combine(dir.FullName, "Fx.csproj");
            const string Text = "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n"
                + "    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n";
            File.WriteAllText(project, Text);

            var assets = ProjectAssets.Evaluate(Host(), project);

            Assert.False(string.IsNullOrEmpty(assets));
            Assert.Equal("Fx.csproj: not restored; run dotnet restore", ProjectAssets.Problem("Fx.csproj", assets, File.Exists));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void RestoredProjectPasses()
    {
        var project = Path.Combine(RepositoryRoot(), "tools", "SharpLadder.Policy.Tests", "SharpLadder.Policy.Tests.csproj");

        var assets = ProjectAssets.Evaluate(Host(), project);

        Assert.False(string.IsNullOrEmpty(assets));
        Assert.Null(ProjectAssets.Problem("SharpLadder.Policy.Tests.csproj", assets, File.Exists));
    }

    [Fact]
    public void ProjectThatDoesNotEvaluateFailsClosed()
    {
        var project = Path.Combine(Path.GetTempPath(), "sharpladder-missing-" + Guid.NewGuid().ToString("N"), "Fx.csproj");

        var assets = ProjectAssets.Evaluate(Host(), project);

        Assert.Null(assets);
        Assert.Equal(
            "Fx.csproj: ProjectAssetsFile does not evaluate, so the check cannot tell whether it is restored",
            ProjectAssets.Problem("Fx.csproj", assets, File.Exists));
    }

    [Fact]
    public void ProjectWithoutAnAssetsFileNeedsNoRestore()
    {
        Assert.Null(ProjectAssets.Problem("Fx.csproj", string.Empty, _ => false));
    }

    // The checks set DOTNET_ROOT to the pinned SDK, so the tests evaluate with it too.
    private static string Host()
    {
        var root = Environment.GetEnvironmentVariable("DOTNET_ROOT");
        var host = root is null ? null : Path.Combine(root, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        return host is not null && File.Exists(host) ? host : "dotnet";
    }

    private static string RepositoryRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "SharpLadder.sln")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("SharpLadder.sln not found above the test output.");
    }
}
