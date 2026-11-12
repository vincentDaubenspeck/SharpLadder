using System.Text;
using Xunit;

namespace SharpLadder.Content.Tests;

// Root allowlist and raw-byte text admission; every case runs through the real filesystem reader.
public sealed class AdmissionTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string LinkRefused = "links and reparse points are not accepted at or below a root folder";
    private const string RootRefusal = "the content root holds only chapters/, errors/, glossary/, schema/, aliases.yml and patterns.yml";

    private static readonly UTF8Encoding Utf8 = new(false);

    public static TheoryData<string> TextFiles() =>
        ["chapters/c/chapter.md", "chapters/c/part.md", "aliases.yml", "patterns.yml", "schema/extra.json"];

    [Fact]
    public void AdmittedRootEntriesPass()
    {
        using var folder = Base();
        Put(folder, "aliases.yml", "slugs: {}\nids: {}\n");
        Put(folder, "patterns.yml", "patterns: []\n");
        Put(folder, "schema/body.schema.json", "{}\n");

        Assert.Empty(Run(folder));
    }

    [Theory]
    [InlineData("notes.md", false)]
    [InlineData("docs", true)]
    [InlineData("Glossary", true)]
    [InlineData("Errors", true)]
    [InlineData("Schema", true)]
    [InlineData("ALIASES.YML", false)]
    [InlineData("aliases.yaml", false)]
    [InlineData("patterns.yml.bak", false)]
    public void UnknownRootEntryIsRefused(string name, bool isFolder)
    {
        using var folder = Base();
        if (isFolder)
        {
            Directory.CreateDirectory(Path.Combine(folder.Path, name, "x"));
        }
        else
        {
            Put(folder, name, "x\n");
        }

        Assert.Contains(Run(folder), d => d.EndsWith(RootRefusal, StringComparison.Ordinal));
    }

    // The only chapters entry is a case variant, so nothing named exactly chapters exists to hide behind.
    [Fact]
    public void CaseVariantOfChaptersIsRefusedNotCollected()
    {
        using var folder = new TempFolder();
        folder.Write("Chapters/c/chapter.md", Chapter);

        var diagnostics = Run(folder);

        Assert.Contains(diagnostics, d => d.EndsWith(RootRefusal, StringComparison.Ordinal));
    }

    [Fact]
    public void RootEntryOfTheWrongTypeIsRefused()
    {
        using var folder = Base();
        Directory.CreateDirectory(Path.Combine(folder.Path, "aliases.yml"));
        Put(folder, "schema", "x\n");

        var diagnostics = Run(folder);

        Assert.Contains("aliases.yml: not a file", diagnostics, StringComparer.Ordinal);
        Assert.Contains("schema: not a folder", diagnostics, StringComparer.Ordinal);
    }

    [Fact]
    public void SchemaFolderHoldsFilesOnly()
    {
        using var folder = Base();
        Directory.CreateDirectory(Path.Combine(folder.Path, "schema", "nested"));

        Assert.Contains("schema/nested: schema/ holds only files", Run(folder), StringComparer.Ordinal);
    }

    [Theory]
    [MemberData(nameof(TextFiles))]
    public void CarriageReturnIsRefusedBeforeNormalisation(string file)
    {
        foreach (var body in new[] { "a\r\nb\n", "a\rb\n", "a\n\r", "\r" })
        {
            using var folder = Base();
            Put(folder, file, Chapter, body);

            Assert.Contains(Run(folder), d => d.StartsWith(file + ":", StringComparison.Ordinal) && d.Contains("carriage return", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void CarriageReturnReportsItsLine()
    {
        using var folder = Base();
        Put(folder, "chapters/c/chapter.md", Chapter.Replace("\n", "\r\n", StringComparison.Ordinal));

        Assert.Contains("chapters/c/chapter.md:1: file holds a carriage return (CR); save it with LF line endings", Run(folder), StringComparer.Ordinal);
    }

    [Fact]
    public void CarriageReturnInsideAFenceOrHeadingAttributeIsRefused()
    {
        using var folder = Base();
        Put(folder, "chapters/c/part.md", "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## T {#syn-t}\n\n```csharp {#syn-a group=g spoken=\"x\"}\r\nint x = 1;\n```\n");

        Assert.Contains(Run(folder), d => d.StartsWith("chapters/c/part.md:9: ", StringComparison.Ordinal) && d.Contains("carriage return", StringComparison.Ordinal));
    }

    [Theory]
    [MemberData(nameof(TextFiles))]
    public void ByteOrderMarkAndBadUtf8AreRefused(string file)
    {
        using var bom = Base();
        PutBytes(bom, file, [0xEF, 0xBB, 0xBF, (byte)'a', (byte)'\n']);
        Assert.Contains(Run(bom), d => d.StartsWith(file + ":1: file starts with a byte order mark", StringComparison.Ordinal));

        foreach (byte[] bad in new byte[][] { [0xC3], [0xC0, 0xAF], [0xED, 0xA0, 0x80], [0xFF] })
        {
            using var folder = Base();
            PutBytes(folder, file, bad);
            Assert.Contains($"{file}: file is not valid UTF-8", Run(folder), StringComparer.Ordinal);
        }
    }

    [Fact]
    public void MultiByteTextNextToLineFeedsIsAdmitted()
    {
        using var folder = Base();
        Put(folder, "chapters/c/chapter.md", Chapter + "\nCafé 日本語 😀.\n");

        Assert.Empty(Run(folder));
    }

    // An admitted name does not admit a link: the tree walk refuses it before the allowlist runs.
    [Theory]
    [InlineData("aliases.yml")]
    [InlineData("patterns.yml")]
    [InlineData("schema/body.schema.json")]
    public void SymbolicLinkInPlaceOfAnAdmittedFileIsRefused(string relative)
    {
        using var outside = new TempFolder();
        using var folder = Base();
        Directory.CreateDirectory(Path.Combine(folder.Path, "schema"));
        using var linked = Links.SymbolicFile(Native(folder, relative), outside.Write("target.txt", "x\n"));

        var refusal = Assert.Throws<BoundaryException>(() => Repository.Compile(folder.Path));

        Assert.Contains(LinkRefused, refusal.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("aliases.yml")]
    [InlineData("patterns.yml")]
    [InlineData("schema/body.schema.json")]
    public void HardLinkedAdmittedFileIsRefused(string relative)
    {
        using var outside = new TempFolder();
        using var folder = Base();
        Put(folder, relative, "x\n");
        using var linked = Links.Hard(Path.Combine(outside.Path, "second.txt"), Native(folder, relative));

        var refusal = Assert.Throws<BoundaryException>(() => Repository.Compile(folder.Path));

        Assert.Contains("has 2 hard links; an input file must have exactly one", refusal.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void LinkInPlaceOfTheSchemaFolderIsRefused(bool dangling)
    {
        using var outside = new TempFolder();
        using var folder = Base();
        var target = Path.Combine(outside.Path, "real");
        if (!dangling)
        {
            outside.Write("real/body.schema.json", "{}\n");
        }

        using var linked = Links.Folder(Path.Combine(folder.Path, "schema"), target);

        var refusal = Assert.Throws<BoundaryException>(() => Repository.Compile(folder.Path));

        Assert.Contains(LinkRefused, refusal.Message, StringComparison.Ordinal);
    }

    private static string Native(TempFolder folder, string relative) =>
        Path.Combine(folder.Path, relative.Replace('/', Path.DirectorySeparatorChar));

    private static TempFolder Base()
    {
        var folder = new TempFolder();
        folder.Write("chapters/c/chapter.md", Chapter);
        return folder;
    }

    private static void Put(TempFolder folder, string relative, string text) => PutBytes(folder, relative, Utf8.GetBytes(text));

    // A text file that is a chapter or part gets a valid head so only the byte under test can fail.
    private static void Put(TempFolder folder, string relative, string head, string tail)
    {
        var text = relative.EndsWith("part.md", StringComparison.Ordinal)
            ? "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n" + tail
            : relative.EndsWith("chapter.md", StringComparison.Ordinal) ? head + tail : tail;
        Put(folder, relative, text);
    }

    private static void PutBytes(TempFolder folder, string relative, byte[] bytes)
    {
        var full = Path.Combine(folder.Path, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllBytes(full, bytes);
    }

    private static List<string> Run(TempFolder folder) => [.. Repository.Compile(folder.Path).Diagnostics.Select(d => d.ToString())];
}
