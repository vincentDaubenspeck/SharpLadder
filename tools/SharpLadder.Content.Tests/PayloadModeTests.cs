using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class PayloadModeTests
{
    private static readonly string[] PayloadFiles =
    [
        "compiled/chapters/fixture-basics/build.json",
        "compiled/chapters/fixture-basics/chapter.json",
        "compiled/chapters/fixture-basics/gotchas.json",
        "compiled/chapters/fixture-basics/idioms.json",
        "compiled/chapters/fixture-basics/library.json",
        "compiled/chapters/fixture-basics/syntax.json",
        "compiled/chapters/fixture-empty-intro/chapter.json",
        "compiled/chapters/fixture-no-sections/chapter.json",
        "compiled/chapters/fixture-second/chapter.json",
        "compiled/manifest.json",
        "src/generated/body.ts",
        "src/generated/content.ts",
        "src/generated/witness/chapters/fixture-basics/build.ts",
        "src/generated/witness/chapters/fixture-basics/chapter.ts",
        "src/generated/witness/chapters/fixture-basics/gotchas.ts",
        "src/generated/witness/chapters/fixture-basics/idioms.ts",
        "src/generated/witness/chapters/fixture-basics/library.ts",
        "src/generated/witness/chapters/fixture-basics/syntax.ts",
        "src/generated/witness/chapters/fixture-empty-intro/chapter.ts",
        "src/generated/witness/chapters/fixture-no-sections/chapter.ts",
        "src/generated/witness/chapters/fixture-second/chapter.ts",
    ];

    [Fact]
    public void GenerateWritesTheWholePayloadIntoStagingOnly()
    {
        using var work = new PayloadWorkspace();
        var before = PayloadWorkspace.Snapshot(work.Web);
        var stage = work.NewStage();

        var result = work.Run("generate", stage);

        Assert.Equal(0, result.Code);
        Assert.EndsWith("PASS content generate\n", result.Output, StringComparison.Ordinal);
        Assert.Equal(PayloadFiles, Files(stage), StringComparer.Ordinal);
        Assert.Equal(File.ReadAllBytes(Path.Combine(Repository.Root, "tools", "SharpLadder.Content.Tests", "fixtures", "emitter", "body.ts.expected")), File.ReadAllBytes(Path.Combine(stage, "src", "generated", "body.ts")));
        PayloadWorkspace.AssertSame(before, PayloadWorkspace.Snapshot(work.Web));
    }

    [Fact]
    public void GenerateAcceptsAbsentCommittedFolders()
    {
        using var work = new PayloadWorkspace(seed: false);

        var result = work.Run("generate");

        Assert.Equal(0, result.Code);
        Assert.False(Directory.Exists(work.Web));
    }

    [Fact]
    public void GenerationIsTheSameFromLfAndCrlfSources()
    {
        using var lf = new PayloadWorkspace(seed: false);
        using var crlf = new PayloadWorkspace(seed: false, newline: "\r\n");
        var (first, second) = (lf.NewStage(), crlf.NewStage());

        Assert.Equal(0, lf.Run("generate", first).Code);
        Assert.Equal(0, crlf.Run("generate", second).Code);

        Assert.Equal(PayloadFiles, Files(second), StringComparer.Ordinal);
        Assert.All(PayloadFiles, f => Assert.Equal(File.ReadAllBytes(Path.Combine(first, f)), File.ReadAllBytes(Path.Combine(second, f))));
    }

    [Fact]
    public void UpdatePublishesBothDestinationsAndCompareAccepts()
    {
        using var work = new PayloadWorkspace();

        var result = work.Run("compare");

        Assert.Equal(0, result.Code);
        Assert.Equal("21 committed files equal fresh output\nPASS content compare\n", result.Output);
        Assert.Equal(PayloadFiles, Files(work.Web), StringComparer.Ordinal);
    }

    [Fact]
    public void CompareLeavesReadOnlyCommittedTreesUnchanged()
    {
        using var work = new PayloadWorkspace();
        var files = Directory.EnumerateFiles(work.Web, "*", SearchOption.AllDirectories).ToList();
        files.ForEach(f => File.SetAttributes(f, FileAttributes.ReadOnly));
        try
        {
            var before = PayloadWorkspace.Snapshot(work.Web);

            var result = work.Run("compare");

            Assert.Equal(0, result.Code);
            PayloadWorkspace.AssertSame(before, PayloadWorkspace.Snapshot(work.Web));
            Assert.All(files, f => Assert.True(File.GetAttributes(f).HasFlag(FileAttributes.ReadOnly)));
        }
        finally
        {
            files.ForEach(f => File.SetAttributes(f, FileAttributes.Normal));
        }
    }

    [Theory]
    [InlineData("schema", "folder")]
    [InlineData("content", "folder")]
    [InlineData("compiled", "folder")]
    [InlineData("generated", "folder")]
    [InlineData("schema", "symbolic")]
    [InlineData("content", "symbolic")]
    [InlineData("compiled", "symbolic")]
    [InlineData("generated", "symbolic")]
    [InlineData("schema", "file")]
    [InlineData("content", "file")]
    [InlineData("compiled", "file")]
    [InlineData("generated", "file")]
    public void LinkInsideAnyRootIsRefused(string root, string kind)
    {
        using var work = new PayloadWorkspace();
        using var outside = new TempFolder();
        var target = outside.Write("elsewhere.json", "{}\n");
        var link = Path.Combine(work.RootOf(root), "linked");
        var before = PayloadWorkspace.Snapshot(work.Web);
        var stage = work.NewStage();
        CliResult result;
        using (kind switch { "folder" => Links.Folder(link, outside.Path), "symbolic" => Links.Symbolic(link, outside.Path), _ => Links.SymbolicFile(link, target) })
        {
            result = work.Run("compare", stage);
        }

        AssertRefused(result, "compare", stage);
        Assert.Contains("linked", result.Output, StringComparison.Ordinal);
        PayloadWorkspace.AssertSame(before, PayloadWorkspace.Snapshot(work.Web));
    }

    [Theory]
    [InlineData("schema")]
    [InlineData("content")]
    [InlineData("compiled")]
    [InlineData("generated")]
    public void HardLinkedFileInAnyRootIsRefused(string root)
    {
        using var work = new PayloadWorkspace();
        using var outside = new TempFolder();
        var target = outside.Write("shared.txt", "x\n");
        var stage = work.NewStage();
        using var linked = Links.Hard(Path.Combine(work.RootOf(root), "shared.txt"), target);

        var result = work.Run("compare", stage);

        AssertRefused(result, "compare", stage);
        Assert.Contains("shared.txt", result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("compare", "compiled")]
    [InlineData("compare", "generated")]
    [InlineData("test-records", "compiled")]
    [InlineData("test-records", "generated")]
    public void MissingCommittedRootIsRefused(string mode, string root)
    {
        using var work = new PayloadWorkspace();
        Directory.Delete(work.RootOf(root), recursive: true);
        var stage = work.NewStage();

        var result = work.Run(mode, stage);

        Assert.Equal(2, result.Code);
        Assert.Contains($"{work.RootOf(root)}: folder not found", string.Equals(mode, "compare", StringComparison.Ordinal) ? result.Output : result.Error, StringComparison.Ordinal);
        Assert.False(Directory.Exists(stage));
        Assert.Empty(result.Stdout);
    }

    [Theory]
    [InlineData("content", "chapters/fixture-basics/gotchas.md")]
    [InlineData("compiled", "chapters/fixture-basics/gotchas.json")]
    public void UnreadableEntryIsRefused(string root, string relative)
    {
        using var work = new PayloadWorkspace();
        var file = Path.Combine(work.RootOf(root), relative);
        var stage = work.NewStage();
        using var locked = Unreadable.Make(file);

        var result = work.Run("compare", stage);

        AssertRefused(result, "compare", stage);
    }

    [Theory]
    [InlineData("schema")]
    [InlineData("content")]
    [InlineData("compiled")]
    [InlineData("generated")]
    public void StagingInsideAnyRootIsRefused(string root)
    {
        using var work = new PayloadWorkspace();
        var stage = Path.Combine(work.RootOf(root), "stage");
        var before = PayloadWorkspace.Snapshot(work.Web);

        var result = work.Run("compare", stage);

        AssertRefused(result, "compare", stage);
        Assert.Contains("must lie outside the", result.Output, StringComparison.Ordinal);
        PayloadWorkspace.AssertSame(before, PayloadWorkspace.Snapshot(work.Web));
    }

    [Fact]
    public void StagingInsideAnAbsentCommittedFolderIsRefused()
    {
        using var work = new PayloadWorkspace(seed: false);

        var result = work.Run("generate", Path.Combine(work.Compiled, "stage"));

        Assert.Equal(2, result.Code);
        Assert.Contains("must lie outside the committed compiled folder", result.Output, StringComparison.Ordinal);
        Assert.False(Directory.Exists(work.Web));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void CommittedFoldersMustBeApart(bool same)
    {
        using var work = new PayloadWorkspace();
        var stage = work.NewStage();

        var result = work.Run("compare", stage, generated: same ? work.Compiled : Path.Combine(work.Compiled, "chapters"));

        AssertRefused(result, "compare", stage);
        Assert.Contains("the committed generated folder must lie outside the committed compiled folder", result.Output, StringComparison.Ordinal);
    }

    [Fact]
    public void ShortNameAliasOfACommittedRootIsTheSameFolder()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "8.3 short names exist only on Windows");
        using var work = new PayloadWorkspace();
        var alias = PayloadWorkspace.ShortPath(work.Compiled);
        var stage = Path.Combine(alias, "stage");

        var accepted = work.Run("compare", compiled: alias);
        var refused = work.Run("compare", stage);

        Assert.Equal(0, accepted.Code);
        AssertRefused(refused, "compare", stage);
        Assert.Contains("must lie outside the committed compiled folder", refused.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("generate")]
    [InlineData("compare")]
    public void FailureAfterTheFirstOutputFileComparesNothing(string mode)
    {
        using var work = new PayloadWorkspace();

        // The 254-character source name is legal; its 256-character .json name passes the 255 limit of NTFS and ext4.
        PayloadWorkspace.Write(
            Path.Combine(work.Content, "chapters", "fixture-basics", new string('z', 251) + ".md"),
            "---\nkind: syntax\nchapter: ch-fixture\norder: 3\n---\n\n## Extra {#syn-fix-extra}\n\nText.\n");
        var before = PayloadWorkspace.Snapshot(work.Web);
        var stage = work.NewStage();

        var result = work.Run(mode, stage);

        AssertRefused(result, mode, stage);
        Assert.Contains($"{stage}: staging not written: ", result.Output, StringComparison.Ordinal);
        Assert.DoesNotContain("fresh output", result.Output, StringComparison.Ordinal);
        PayloadWorkspace.AssertSame(before, PayloadWorkspace.Snapshot(work.Web));
    }

    private static List<string> Files(string folder) =>
        [.. Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories).Select(f => Path.GetRelativePath(folder, f).Replace('\\', '/')).Order(StringComparer.Ordinal)];

    private static void AssertRefused(CliResult result, string mode, string stage)
    {
        Assert.Equal(2, result.Code);
        Assert.EndsWith($"FAIL content {mode}\n", result.Output, StringComparison.Ordinal);
        Assert.False(Directory.Exists(stage) && Directory.EnumerateFileSystemEntries(stage).Any());
    }

    // Read access withdrawn from one file for the length of a test.
    private sealed class Unreadable : IDisposable
    {
        private readonly string _file;

        private Unreadable(string file) => _file = file;

        public static Unreadable Make(string file)
        {
            if (OperatingSystem.IsWindows())
            {
                Links.Command("icacls", "cannot deny read access", file, "/deny", "*S-1-1-0:(R)");
            }
            else
            {
                File.SetUnixFileMode(file, UnixFileMode.None);
            }

            if (Readable(file))
            {
                Restore(file);
                Assert.Skip("this account reads the file all the same");
            }

            return new Unreadable(file);
        }

        public void Dispose() => Restore(_file);

        private static bool Readable(string file)
        {
            try
            {
                _ = File.ReadAllBytes(file);
                return true;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        private static void Restore(string file)
        {
            if (OperatingSystem.IsWindows())
            {
                Links.Command("icacls", "cannot restore read access", file, "/remove:d", "*S-1-1-0");
            }
            else
            {
                File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
        }
    }
}
