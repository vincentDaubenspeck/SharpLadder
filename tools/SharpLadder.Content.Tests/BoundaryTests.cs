using System.Diagnostics;
using System.Net.Sockets;
using Xunit;

namespace SharpLadder.Content.Tests;

// The filesystem boundary of the compiler, driven through the command line as the scripts and CI
// drive it.
public sealed class BoundaryTests
{
    private const string Outside = "the output folder must lie outside the";
    private const string LinkRefused = "links and reparse points are not accepted at or below a root folder";

    private static readonly string Separator = Path.DirectorySeparatorChar.ToString();

    public static TheoryData<string, int> RefusedForms()
    {
        var data = new TheoryData<string, int>();
        var forms = OperatingSystem.IsWindows()
            ? new[]
            {
                @"content", @"C:content", @"\content", @"\\server\share\content", @"\\?\C:\content", @"\\.\C:\content",
                @"\??\C:\content", @"\\?\Volume{00000000-0000-0000-0000-000000000000}\content", @"\\?\UNC\server\share\content",
                @"C:\a\..\content", @"C:\a\.\content", @"C:\a\link\..\x", @"C:\a\\content", @"C:/a/content", @"C:\a\content.",
                @"C:\a\content ", @"C:\a\content:stream", "C:\\a\0b",
            }
            : new[] { "content", "./content", "/a/../content", "/a/./content", "/a/link/../x", "/a//content", "/a/\0b" };
        foreach (var form in forms)
        {
            for (var position = 0; position < 3; position++)
            {
                data.Add(form, position);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(RefusedForms))]
    public void ArgumentOutsideTheAcceptedFormsIsRefusedBeforeAnythingIsOpened(string form, int position)
    {
        using var work = new TempFolder();
        string[] args = [Repository.SchemaFolder, Repository.Fixture, Path.Combine(work.Path, "out")];
        args[position] = form;

        var (code, text) = Run(args);

        Assert.Equal(2, code);
        Assert.Contains($"  {form}: ", text, StringComparison.Ordinal);
        Assert.Contains(OperatingSystem.IsWindows() ? KernelPath.WindowsForm : KernelPath.LinuxForm, text, StringComparison.Ordinal);
        Assert.Empty(Directory.EnumerateFileSystemEntries(work.Path));
    }

    [Fact]
    public void TrailingSeparatorsOnEveryArgumentGiveTheGoldenDigest()
    {
        using var work = new TempFolder();
        var output = Path.Combine(work.Path, "out") + Separator;

        var (code, text) = Run(Repository.SchemaFolder + Separator, Repository.Fixture + Separator, output);

        Assert.Equal(0, code);
        Assert.Contains(GoldenLine(), text, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("content root")]
    [InlineData("schema folder")]
    public void OutputThatIsAnInputRootIsRefused(string role)
    {
        using var work = new TempFolder();
        var empty = Directory.CreateDirectory(Path.Combine(work.Path, "empty")).FullName;
        string[] args = role is "content root"
            ? [Repository.SchemaFolder, empty, empty]
            : [empty, Repository.Fixture, empty];

        var (code, text) = Run(args);

        Assert.Equal(2, code);
        Assert.Contains($"  {empty}: {Outside} {role}", text, StringComparison.Ordinal);
        Assert.Empty(Directory.EnumerateFileSystemEntries(empty));
    }

    [Theory]
    [InlineData("content root", true)]
    [InlineData("content root", false)]
    [InlineData("schema folder", true)]
    [InlineData("schema folder", false)]
    public void OutputInsideAnInputRootIsRefused(string role, bool deep)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var schema = Copy(Repository.SchemaFolder, Path.Combine(work.Path, "schema"));
        var inside = role is "content root" ? content : schema;
        var output = deep ? Path.Combine(inside, "a", "b", "out") : Path.Combine(inside, "out");

        var (code, text) = Run(schema, content, output);

        Assert.Equal(2, code);
        Assert.Contains($"  {output}: {Outside} {role}", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(inside, deep ? "a" : "out")));
    }

    [Theory]
    [InlineData("content")]
    [InlineData("schema")]
    public void OutputThatHoldsAnInputRootIsRefused(string name)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var schema = Copy(Repository.SchemaFolder, Path.Combine(work.Path, "schema"));

        var (code, text) = Run(schema, content, work.Path);

        Assert.Equal(2, code);
        Assert.Contains($"  {work.Path}: output folder must be empty or absent", text, StringComparison.Ordinal);
        Assert.True(Directory.Exists(Path.Combine(work.Path, name)));
        Assert.Equal(["content", "schema"], Directory.EnumerateFileSystemEntries(work.Path).Select(Path.GetFileName).Order(StringComparer.Ordinal), StringComparer.Ordinal);
    }

    [Fact]
    public void OutputNamedLikeTheContentRootWithASuffixIsAccepted()
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));

        var (code, text) = Run(Repository.SchemaFolder, content, content + "-out");

        Assert.Equal(0, code);
        Assert.Contains(GoldenLine(), text, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("empty")]
    [InlineData("non-empty")]
    [InlineData("file")]
    public void OutputMustBeMissingOrEmpty(string state)
    {
        using var work = new TempFolder();
        var output = Path.Combine(work.Path, "out");
        if (state is "empty" or "non-empty")
        {
            Directory.CreateDirectory(output);
        }

        if (state is "non-empty")
        {
            work.Write(Path.Combine("out", "kept.txt"), "kept\n");
        }

        if (state is "file")
        {
            work.Write("out", "a file\n");
        }

        var (code, text) = Run(Repository.SchemaFolder, Repository.Fixture, output);

        if (state is "missing" or "empty")
        {
            Assert.Equal(0, code);
            Assert.Equal(9, Directory.EnumerateFiles(output, "*", SearchOption.AllDirectories).Count());
            return;
        }

        Assert.Equal(2, code);
        Assert.Contains(state is "file" ? "a file is there" : "output folder must be empty or absent", text, StringComparison.Ordinal);
        Assert.Equal(state is "file" ? "a file\n" : "kept\n", File.ReadAllText(state is "file" ? output : Path.Combine(output, "kept.txt")));
    }

    // A link above every root, so each argument passes through it; the kernel follows it and the
    // output is the same as through the real folder.
    [Fact]
    public void LinkAboveTheRootsGivesTheGoldenDigest()
    {
        using var work = new TempFolder();
        var real = Directory.CreateDirectory(Path.Combine(work.Path, "real")).FullName;
        Copy(Repository.Fixture, Path.Combine(real, "content"));
        Copy(Repository.SchemaFolder, Path.Combine(real, "schema"));
        var alias = Path.Combine(work.Path, "alias");
        using var linked = Links.Folder(alias, real);

        var (code, text) = Run(Path.Combine(alias, "schema"), Path.Combine(alias, "content"), Path.Combine(alias, "out"));

        Assert.Equal(0, code);
        Assert.Contains(GoldenLine(), text, StringComparison.Ordinal);
        Assert.Equal(9, Directory.EnumerateFiles(Path.Combine(real, "out"), "*", SearchOption.AllDirectories).Count());
    }

    // The link is the last component of each argument, which is still above the root it reaches.
    [Fact]
    public void LinkAsTheRootArgumentGivesTheGoldenDigest()
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var schema = Copy(Repository.SchemaFolder, Path.Combine(work.Path, "schema"));
        var output = Directory.CreateDirectory(Path.Combine(work.Path, "out")).FullName;
        using var contentLink = Links.Folder(Path.Combine(work.Path, "content-link"), content);
        using var schemaLink = Links.Folder(Path.Combine(work.Path, "schema-link"), schema);
        using var outputLink = Links.Folder(Path.Combine(work.Path, "out-link"), output);

        var (code, text) = Run(Path.Combine(work.Path, "schema-link"), Path.Combine(work.Path, "content-link"), Path.Combine(work.Path, "out-link"));

        Assert.Equal(0, code);
        Assert.Contains(GoldenLine(), text, StringComparison.Ordinal);
        Assert.Equal(9, Directory.EnumerateFiles(output, "*", SearchOption.AllDirectories).Count());
    }

    [Fact]
    public void OutputReachedThroughALinkIntoTheContentRootIsRefused()
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var inner = Directory.CreateDirectory(Path.Combine(content, "inner")).FullName;
        using var linked = Links.Folder(Path.Combine(work.Path, "elsewhere"), inner);
        var output = Path.Combine(work.Path, "elsewhere", "out");

        var (code, text) = Run(Repository.SchemaFolder, content, output);

        Assert.Equal(2, code);
        Assert.Contains($"  {output}: {Outside} content root", text, StringComparison.Ordinal);
        Assert.Empty(Directory.EnumerateFileSystemEntries(inner));
    }

    // A link above the root whose target climbs out of another link: the kernel, not the text of
    // the target, decides which folder the root is. Linux climbs from the folder pivot reaches,
    // so the root is real/content/sub; Windows applies the .. to the target text, where no such
    // folder exists.
    [Fact]
    public void DotDotInsideALinkTargetAboveTheRootIsResolvedByTheKernel()
    {
        using var work = new TempFolder();
        var deeper = Directory.CreateDirectory(Path.Combine(work.Path, "real", "deeper")).FullName;
        var sub = Copy(Repository.Fixture, Path.Combine(work.Path, "real", "content", "sub"));
        using var pivot = Links.Folder(Path.Combine(work.Path, "pivot"), deeper);
        using var alias = Links.Symbolic(Path.Combine(work.Path, "alias"), Path.Combine("pivot", "..", "content"));
        var root = Path.Combine(work.Path, "alias", "sub");
        var output = Path.Combine(sub, "generated");

        var (code, text) = Run(Repository.SchemaFolder, root, output);

        Assert.Equal(2, code);
        var expected = OperatingSystem.IsWindows()
            ? $"  {ContentCompiler.DisplayPath(Environment.CurrentDirectory, root)}: folder not found"
            : $"  {output}: {Outside} content root";
        Assert.Contains(expected, text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(output));
    }

    [Theory]
    [InlineData("chapters")]
    [InlineData("chapter folder")]
    [InlineData("dangling")]
    public void FolderLinkBelowTheContentRootIsRefused(string where)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var elsewhere = Copy(Path.Combine(content, "chapters"), Path.Combine(work.Path, "elsewhere"));
        var (link, target) = where switch
        {
            "chapters" => (Path.Combine(content, "chapters"), elsewhere),
            "chapter folder" => (Path.Combine(content, "chapters", "linked"), Path.Combine(elsewhere, "fixture-basics")),
            _ => (Path.Combine(content, "chapters", "ghost"), Path.Combine(work.Path, "nowhere")),
        };
        if (where is "chapters")
        {
            Directory.Delete(link, recursive: true);
        }

        using var linked = Links.Folder(link, target);

        var (code, text) = Run(Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains(LinkRefused, text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
        Assert.False(Directory.Exists(Path.Combine(work.Path, "nowhere")));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void FileLinkBelowTheContentRootIsRefused(bool dangling)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var target = dangling ? Path.Combine(work.Path, "nowhere.md") : work.Write("part.md", File.ReadAllText(Path.Combine(content, "chapters", "fixture-basics", "syntax.md")));
        using var linked = Links.SymbolicFile(Path.Combine(content, "chapters", "fixture-basics", "linked.md"), target);

        var (code, text) = Run(Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains($"linked.md: {LinkRefused}", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Fact]
    public void HardLinkedInputFileIsRefused()
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        using var linked = Links.Hard(Path.Combine(work.Path, "second.md"), Path.Combine(content, "chapters", "fixture-basics", "syntax.md"));

        var (code, text) = Run(Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains("syntax.md: has 2 hard links; an input file must have exactly one", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Theory]
    [InlineData("fifo")]
    [InlineData("socket")]
    public void SpecialFileInputIsRefused(string kind)
    {
        Assert.SkipUnless(OperatingSystem.IsLinux(), "FIFOs and Unix sockets in a folder listing are a Linux case");
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var special = Path.Combine(content, "chapters", "fixture-basics", "special.md");
        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        if (kind is "fifo")
        {
            Links.Command("mkfifo", "cannot create a FIFO", special);
        }
        else
        {
            socket.Bind(new UnixDomainSocketEndPoint(special));
        }

        var (code, text) = Run(Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains("special.md: not a regular file; only regular files are read", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    // A link that leads nowhere as the output folder or its parent: nothing is created at the link,
    // at its target or anywhere else, whether the target is a missing folder or a missing volume.
    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public void LinkThatLeadsNowhereIsRefusedAndNothingIsCreated(bool toVolume, bool asParent)
    {
        Assert.SkipUnless(!toVolume || OperatingSystem.IsWindows(), "volume GUID paths exist only on Windows");
        using var work = new TempFolder();
        var target = toVolume ? @"\\?\Volume{00000000-0000-0000-0000-000000000000}\" : Path.Combine(work.Path, "nowhere");
        var link = Path.Combine(work.Path, "alias");

        // mklink /J refuses a volume that does not exist, so that case gets a symbolic link.
        using var linked = toVolume ? Links.Symbolic(link, target) : Links.Folder(link, target);
        var output = asParent ? Path.Combine(link, "out") : link;
        var before = Snapshot();

        var (code, text) = Run(Repository.SchemaFolder, Repository.Fixture, output);

        Assert.Equal(2, code);
        Assert.Contains($"  {output}: ", text, StringComparison.Ordinal);
        Assert.Equal(["alias"], Directory.EnumerateFileSystemEntries(work.Path).Select(Path.GetFileName), StringComparer.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "nowhere")));
        Assert.Equal(before, Snapshot());
    }

    // A junction to the real volume GUID path of the drive is a second spelling of the same
    // folders; identities, not spellings, decide containment.
    [Fact]
    public void JunctionToTheVolumeGuidPathIsFollowedAndComparedByIdentity()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "volume GUID paths exist only on Windows");
        using var work = new TempFolder();
        var real = Directory.CreateDirectory(Path.Combine(work.Path, "real")).FullName;
        var content = Copy(Repository.Fixture, Path.Combine(real, "content"));
        var alias = Path.Combine(work.Path, "alias");
        using var linked = Links.Folder(alias, OnVolume(real));
        var inside = Path.Combine(content, "out");

        var (compiled, text) = Run(Repository.SchemaFolder, Path.Combine(alias, "content"), Path.Combine(work.Path, "out"));
        var (refused, refusal) = Run(Repository.SchemaFolder, Path.Combine(alias, "content"), inside);

        Assert.Equal(0, compiled);
        Assert.Contains(GoldenLine(), text, StringComparison.Ordinal);
        Assert.Equal(2, refused);
        Assert.Contains($"  {inside}: {Outside} content root", refusal, StringComparison.Ordinal);
        Assert.False(Directory.Exists(inside));
    }

    [Fact]
    public void ExistingDestinationFileIsNeverOpened()
    {
        using var work = new TempFolder();
        var output = Directory.CreateDirectory(Path.Combine(work.Path, "out")).FullName;
        using var content = Folder.OpenRoot(Repository.Fixture, Repository.Fixture);
        var target = OutputTarget.Prepare(output, [(InputTree.Read(content), "content root")]);
        var planted = work.Write(Path.Combine("out", "b.json"), "planted\n");

        var problem = OutputWriter.Write(target, [new OutputFile("a.json", [1]), new OutputFile("b.json", [2])]);

        Assert.NotNull(problem);
        Assert.Equal("planted\n", File.ReadAllText(planted));
        Assert.Equal(["b.json"], Directory.EnumerateFileSystemEntries(output).Select(Path.GetFileName), StringComparer.Ordinal);
    }

    [Fact]
    public void ShortNameResolvesToTheSameFolder()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "8.3 short names exist only on Windows");
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content with a long name"));
        var shortName = ShortPath(content);
        Assert.SkipUnless(!string.Equals(shortName, content, StringComparison.OrdinalIgnoreCase), "short names are disabled on this volume");

        var (compiled, text) = Run(Repository.SchemaFolder, shortName, Path.Combine(work.Path, "out"));
        var output = Path.Combine(content, "out");
        var (refused, refusal) = Run(Repository.SchemaFolder, shortName, output);

        Assert.Equal(0, compiled);
        Assert.Contains(GoldenLine(), text, StringComparison.Ordinal);
        Assert.Equal(2, refused);
        Assert.Contains($"  {output}: {Outside} content root", refusal, StringComparison.Ordinal);
    }

    // Folders no compile step reads are walked all the same.
    [Theory]
    [InlineData("unused-link")]
    [InlineData("unused/link")]
    public void LinkAnywhereBelowTheContentRootIsRefused(string relative)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var link = Path.Combine(content, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(link)!);
        using var linked = Links.Folder(link, Path.Combine(work.Path, "nowhere"));

        var (code, text) = Run(Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains($"{relative}: {LinkRefused}", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Theory]
    [InlineData("link")]
    [InlineData("sub/link")]
    [InlineData("sub/deeper/link.schema.json")]
    public void LinkAnywhereBelowTheSchemaFolderIsRefused(string relative)
    {
        using var work = new TempFolder();
        var schema = Copy(Repository.SchemaFolder, Path.Combine(work.Path, "schema"));
        var link = Path.Combine(schema, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(link)!);
        using var linked = Links.Folder(link, Path.Combine(work.Path, "nowhere"));

        var (code, text) = Run(schema, Repository.Fixture, Path.Combine(work.Path, "out"));

        // The schema folder is shown as given, so in the platform's separator style.
        Assert.Equal(2, code);
        Assert.Contains($"{relative.Replace('/', Path.DirectorySeparatorChar)}: {LinkRefused}", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Theory]
    [InlineData("notes.txt")]
    [InlineData("unused/deeper/notes.txt")]
    public void HardLinkedFileAnywhereBelowTheContentRootIsRefused(string relative)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var file = Path.Combine(content, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, "notes\n");
        using var linked = Links.Hard(Path.Combine(work.Path, "second.txt"), file);

        var (code, text) = Run(Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains($"{relative}: has 2 hard links; an input file must have exactly one", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    // A folder mounted onto the volume itself carries IO_REPARSE_TAG_MOUNT_POINT, as mountvol
    // would leave it. A volume change with no reparse point cannot occur below a folder on
    // Windows, so the volume serial check has no case of its own here.
    [Fact]
    public void VolumeMountPointBelowTheContentRootIsRefused()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "volume mount points are a Windows case");
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        using var linked = Links.Folder(Path.Combine(content, "chapters", "volume"), OnVolume(Path.GetPathRoot(work.Path)!));

        var (code, text) = Run(Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains($"chapters/volume: {LinkRefused}", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Theory]
    [InlineData("external onto chapters")]
    [InlineData("chapter onto itself")]
    [InlineData("file onto itself")]
    public void BindMountBelowTheContentRootIsRefused(string mount)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var external = Copy(Path.Combine(content, "chapters"), Path.Combine(work.Path, "external"));
        var chapter = Path.Combine(content, "chapters", "fixture-basics");
        var bind = mount switch
        {
            "external onto chapters" => (external, Path.Combine(content, "chapters")),
            "chapter onto itself" => (chapter, chapter),
            _ => (Path.Combine(chapter, "syntax.md"), Path.Combine(chapter, "syntax.md")),
        };

        var (code, text) = MountNamespace.Compile([bind], Repository.SchemaFolder, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains($": {KernelPath.MountRefusal}", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Theory]
    [InlineData("content root")]
    [InlineData("schema folder")]
    public void InputRootThatIsAMountPointIsRefused(string role)
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var schema = Copy(Repository.SchemaFolder, Path.Combine(work.Path, "schema"));
        var root = role is "content root" ? content : schema;

        var (code, text) = MountNamespace.Compile([(root, root)], schema, content, Path.Combine(work.Path, "out"));

        Assert.Equal(2, code);
        Assert.Contains("a root folder must not be a mount point", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    // The alias shares the kernel identity of a folder inside the content tree, though no mount
    // lies below any root.
    [Fact]
    public void OutputOnABindMountedAliasOfAContentFolderIsRefused()
    {
        using var work = new TempFolder();
        var content = Copy(Repository.Fixture, Path.Combine(work.Path, "content"));
        var alias = Directory.CreateDirectory(Path.Combine(work.Path, "alias")).FullName;
        var output = Path.Combine(alias, "fixture-basics", "out");

        var (code, text) = MountNamespace.Compile([(Path.Combine(content, "chapters"), alias)], Repository.SchemaFolder, content, output);

        Assert.Equal(2, code);
        Assert.Contains($"  {output}: {Outside} content root", text, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(content, "chapters", "fixture-basics", "out")));
    }

    // Mount points are accepted strictly above a root, as links are, and refused at it.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void BindMountAboveTheOutputRootIsAcceptedAndAtItRefused(bool above)
    {
        using var work = new TempFolder();
        var real = Directory.CreateDirectory(Path.Combine(work.Path, "real")).FullName;
        var alias = Directory.CreateDirectory(Path.Combine(work.Path, "alias")).FullName;
        var output = above ? Path.Combine(alias, "out") : alias;

        var (code, text) = MountNamespace.Compile([(real, alias)], Repository.SchemaFolder, Repository.Fixture, output);

        if (above)
        {
            Assert.Equal(0, code);
            Assert.Contains(GoldenLine(), text, StringComparison.Ordinal);
            Assert.Equal(9, Directory.EnumerateFiles(Path.Combine(real, "out"), "*", SearchOption.AllDirectories).Count());
            return;
        }

        Assert.Equal(2, code);
        Assert.Contains($"  {output}: a root folder must not be a mount point", text, StringComparison.Ordinal);
        Assert.Empty(Directory.EnumerateFileSystemEntries(real));
    }

    // Seccomp filters and kernels before 5.6 answer openat2 with ENOSYS.
    [Fact]
    public void MissingOpenat2FailsClosedWithASetupDiagnostic()
    {
        var error = KernelPath.LinuxOpenFailure("content/chapters", 38);

        Assert.Equal("content/chapters: openat2 is not available (ENOSYS); the content compiler needs Linux 5.8 or later", error.Message);
        Assert.Equal($"content/chapters: {KernelPath.MountRefusal}", KernelPath.LinuxOpenFailure("content/chapters", 18).Message);
    }

    private static string Copy(string from, string to)
    {
        Repository.CopyTree(from, to, "\n");
        return to;
    }

    private static string GoldenLine() => $"9 files, output digest sha256:{File.ReadAllText(Repository.GoldenFile).Trim()}\n";

    // The entries a stray folder could appear among: the temporary folder, the working folder and
    // the root of their drives.
    private static string Snapshot()
    {
        var places = new[] { Path.GetTempPath(), Environment.CurrentDirectory };
        var roots = places.Select(p => Path.GetPathRoot(p)!).Distinct(StringComparer.Ordinal);
        var names = places.Concat(roots)
            .SelectMany(p => Directory.EnumerateFileSystemEntries(p, "Volume{*"))
            .Order(StringComparer.Ordinal);
        return string.Join("\n", names);
    }

    private static string OnVolume(string path)
    {
        var drive = Path.GetPathRoot(path)!;
        Assert.SkipUnless(drive.Length == 3 && drive[1] == ':', "the temporary folder is not on a drive letter");
        var start = new ProcessStartInfo("mountvol.exe") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(drive[..2]);
        start.ArgumentList.Add("/L");
        using var process = Process.Start(start)!;
        var volume = process.StandardOutput.ReadToEnd().Trim();
        process.StandardError.ReadToEnd();
        process.WaitForExit();
        Assert.SkipUnless(process.ExitCode == 0 && volume.StartsWith(@"\\?\Volume{", StringComparison.Ordinal), "cannot read the volume name of " + drive);
        return Path.Combine(volume, path[drive.Length..]);
    }

    // cmd prints the 8.3 form of each component that has one.
    private static string ShortPath(string path)
    {
        var start = new ProcessStartInfo("cmd.exe")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Arguments = $"/d /c for %I in (\"{path}\") do @echo %~sI",
        };
        using var process = Process.Start(start)!;
        var shortName = process.StandardOutput.ReadToEnd().Trim();
        process.StandardError.ReadToEnd();
        process.WaitForExit();
        Assert.SkipUnless(process.ExitCode == 0 && shortName.Length > 0, "cannot read the short name of " + path);
        return shortName;
    }

    private static (int Code, string Text) Run(params string[] args)
    {
        using var output = new StringWriter { NewLine = "\n" };
        var code = Cli.Run(args, output);
        return (code, output.ToString());
    }
}
