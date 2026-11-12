using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class CliTests
{
    [Fact]
    public void FixtureCompilesAndWritesTheWholeOutput()
    {
        using var work = new TempFolder();
        var output = Path.Combine(work.Path, "out");

        var (code, lines) = Run(Repository.SchemaFolder, Repository.Fixture, output);

        Assert.Equal(0, code);
        Assert.Equal("PASS content compiler", lines[^1]);
        Assert.Equal(20, Directory.EnumerateFiles(output, "*", SearchOption.AllDirectories).Count());
        Assert.Equal(["out"], Directory.EnumerateFileSystemEntries(work.Path).Select(Path.GetFileName), StringComparer.Ordinal);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void OutputUnderTheContentRootIsRejected(bool trailingSeparator)
    {
        using var content = CopyOfFixture();
        var root = trailingSeparator ? content.Path + Path.DirectorySeparatorChar : content.Path;
        var output = Path.Combine(content.Path, "generated");

        var (code, lines) = Run(Repository.SchemaFolder, root, output);

        Assert.Equal(2, code);
        Assert.Contains($"  {output}: the output folder must lie outside the content root, and must not be it", lines, StringComparer.Ordinal);
        Assert.False(Directory.Exists(output));
    }

    [Fact]
    public void OutputThroughALinkToTheContentRootIsRejected()
    {
        using var content = CopyOfFixture();
        using var work = new TempFolder();
        var link = Path.Combine(work.Path, "link");
        using var linked = Links.Folder(link, content.Path);
        var output = Path.Combine(link, "out");

        var (code, lines) = Run(Repository.SchemaFolder, content.Path, output);

        Assert.Equal(2, code);
        Assert.Contains($"  {output}: the output folder must lie outside the content root, and must not be it", lines, StringComparer.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(content.Path, "out")));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void OutputIsAbsentOrEmptyWhenAFileCannotBeWritten(bool outputExists)
    {
        using var content = CopyOfFixture();
        using var work = new TempFolder();

        // The 254-character source name is legal; its 256-character .json name passes the 255 limit of NTFS and ext4.
        content.Write(
            $"chapters/fixture-basics/{new string('z', 251)}.md",
            "---\nkind: syntax\nchapter: ch-fixture\norder: 3\n---\n\n## Extra {#syn-fix-extra}\n\nText.\n");
        var output = Path.Combine(work.Path, "nested", "out");
        if (outputExists)
        {
            Directory.CreateDirectory(output);
        }

        var (code, lines) = Run(Repository.SchemaFolder, content.Path, output);

        Assert.Equal(2, code);
        Assert.Contains(lines, l => l.StartsWith($"  {output}: output not written: ", StringComparison.Ordinal));
        Assert.Equal("FAIL content compiler", lines[^1]);
        if (outputExists)
        {
            Assert.Empty(Directory.EnumerateFileSystemEntries(output));
            Assert.Equal(["out"], Directory.EnumerateFileSystemEntries(Path.GetDirectoryName(output)!).Select(Path.GetFileName), StringComparer.Ordinal);
        }
        else
        {
            Assert.Empty(Directory.EnumerateFileSystemEntries(work.Path));
        }
    }

    [Fact]
    public void MalformedSchemaExitsWithASetupError()
    {
        using var schema = new TempFolder();
        foreach (var file in Directory.EnumerateFiles(Repository.SchemaFolder))
        {
            var text = File.ReadAllText(file).Replace("\"minimum\": 1", "\"minimum\": \"not-a-number\"", StringComparison.Ordinal);
            schema.Write(Path.GetFileName(file), text);
        }

        using var work = new TempFolder();

        var (code, lines) = Run(schema.Path, Repository.Fixture, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains(lines, l => l.StartsWith("  schema: the schema files do not form a valid draft-07 schema: ", StringComparison.Ordinal));
        Assert.Equal("FAIL content compiler", lines[^1]);
    }

    [Fact]
    public void UnexpectedErrorExitsWithTwoAndADiagnostic()
    {
        var (code, lines) = Run(Repository.SchemaFolder, Repository.Fixture, null!);

        Assert.Equal(2, code);
        Assert.StartsWith("  unexpected error: ", lines[0], StringComparison.Ordinal);
        Assert.Equal("FAIL content compiler", lines[^1]);
    }

    [Fact]
    public void WrongArgumentCountExitsWithTwo() =>
        Assert.Equal(2, Run(Repository.SchemaFolder).Code);

    private static TempFolder CopyOfFixture()
    {
        var folder = new TempFolder();
        Repository.CopyTree(Repository.Fixture, folder.Path, "\n");
        return folder;
    }

    private static (int Code, string[] Lines) Run(params string[] args)
    {
        using var output = new StringWriter { NewLine = "\n" };
        var code = Cli.Run(args, output);
        return (code, output.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries));
    }
}
