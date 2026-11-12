using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class NegativeTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string PartHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n";

    [Fact]
    public void WellFormedInputPasses() =>
        Assert.Empty(Diagnostics(Part("## Good {#syn-good}\n\nText.\n")));

    [Fact]
    public void HeadingWithoutIdFails() =>
        Assert.Contains("chapters/c/part.md:7: heading has no {#id}; write exactly one at the end of the heading", Diagnostics(Part("## No id here\n")), StringComparer.Ordinal);

    [Theory]
    [InlineData("## Two {#syn-one} {#syn-two}\n")]
    [InlineData("## Two {#syn-one #syn-two}\n")]
    public void HeadingWithTwoIdsFails(string body) =>
        Assert.Contains("chapters/c/part.md:7: heading has more than one {#id}; write exactly one at the end of the heading", Diagnostics(Part(body)), StringComparer.Ordinal);

    [Fact]
    public void DuplicateIdsAcrossFilesFail()
    {
        var diagnostics = Diagnostics(
            ("chapters/c/chapter.md", Chapter + "\n## Shared {#syn-shared}\n"),
            ("chapters/c/part.md", PartHead + "## Again {#syn-shared}\n"));

        Assert.Contains("chapters/c/part.md:7: duplicate id \"syn-shared\" (first used at chapters/c/chapter.md:11)", diagnostics, StringComparer.Ordinal);
    }

    [Fact]
    public void IntroAsHeadingIdFails() =>
        Assert.Contains("chapters/c/part.md:7: \"intro\" is reserved for the chapter intro and cannot be a heading id", Diagnostics(Part("## Start {#intro}\n")), StringComparer.Ordinal);

    [Fact]
    public void UnknownFenceAttributeFails() =>
        Assert.Contains("chapters/c/part.md:9: unknown code fence attribute \"colour\"", Diagnostics(Part(Fence("csharp {#syn-a1 group=g spoken=\"Runs\" colour=red}"))), StringComparer.Ordinal);

    [Theory]
    [InlineData("check=\"x == 1\" throws=Exception")]
    [InlineData("check=\"x == 1\" fail=CS0103")]
    [InlineData("throws=Exception fail=CS0103")]
    public void TwoOutcomesFail(string outcomes) =>
        Assert.Contains("chapters/c/part.md:9: check, throws and fail are mutually exclusive", Diagnostics(Part(Fence($"csharp {{#syn-a1 group=g spoken=\"Runs\" {outcomes}}}"))), StringComparer.Ordinal);

    [Fact]
    public void SpokenOverTwoHundredCharactersFails() =>
        Assert.Contains(
            "chapters/c/part.md:9: spoken gloss is 201 characters; at most 200 are allowed",
            Diagnostics(Part(Fence($"text {{spoken=\"{new string('a', 201)}\"}}"))),
            StringComparer.Ordinal);

    [Fact]
    public void SpokenOfTwoHundredCharactersPasses() =>
        Assert.Empty(Diagnostics(Part(Fence($"text {{spoken=\"{new string('a', 200)}\"}}"))));

    [Fact]
    public void EmptyInputDirectoryFails()
    {
        using var folder = new TempFolder();

        var result = Repository.Compile(folder.Path);

        Assert.Equal(["no content files found under chapters/"], result.Diagnostics.Select(d => d.Message), StringComparer.Ordinal);
        Assert.Empty(result.Files);
    }

    [Fact]
    public void EmptyChaptersFolderFails()
    {
        using var folder = new TempFolder();
        Directory.CreateDirectory(Path.Combine(folder.Path, "chapters"));

        Assert.Equal(["no content files found under chapters/"], Repository.Compile(folder.Path).Diagnostics.Select(d => d.Message), StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("---\nkind: syntax\nchapter: ch-test\norder: 1\ncolour: red\n---\n", 5, "colour")]
    [InlineData("---\nkind: syntax\nchapter: [unclosed\n---\n", 0, "front matter: ")]
    [InlineData("---\nkind: syntax\norder: first\n---\n", 3, "front matter: ")]
    [InlineData("---\nkind: syntax\nkind: build\n---\n", 3, "front matter: ")]
    [InlineData("No front matter.\n", 1, "file must start with YAML front matter")]
    public void InvalidFrontMatterFails(string part, int line, string message)
    {
        var diagnostics = Diagnostics(("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", part + "\n## Good {#syn-good}\n"));

        var prefix = line > 0 ? $"chapters/c/part.md:{line}: " : "chapters/c/part.md:";
        Assert.Contains(diagnostics, d => d.StartsWith(prefix, StringComparison.Ordinal) && d.Contains(message, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("order: 1", "order: 0")]
    [InlineData("id: ch-test", "id: test")]
    [InlineData("slug: test\n", "")]
    [InlineData("csharp: 12", "csharp: 13")]
    public void SchemaViolationFails(string from, string to)
    {
        var chapter = Chapter.Replace(from, to, StringComparison.Ordinal);

        var diagnostics = Diagnostics(("chapters/c/chapter.md", chapter));

        Assert.Contains(diagnostics, d => d.StartsWith("chapters/c/chapter.md:1: schema: ", StringComparison.Ordinal));
    }

    [Fact]
    public void UnsupportedPartKindIsRefusedByTheCompiler() =>
        Assert.Equal(
            ["chapters/c/part.md:2: part kind \"approach\" is not admitted; write kind as one of syntax, build, idioms, gotchas, library, cards, drill, hints"],
            Diagnostics(("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead.Replace("syntax", "approach", StringComparison.Ordinal) + "## Good {#syn-good}\n")));

    [Theory]
    [InlineData("kind: syntax\n", "", "chapters/c/part.md:2: front matter states no part kind; write kind as one of syntax, build, idioms, gotchas, library, cards, drill, hints")]
    [InlineData("kind: syntax", "kind: Syntax", "chapters/c/part.md:2: part kind \"Syntax\" is not admitted; write kind as one of syntax, build, idioms, gotchas, library, cards, drill, hints")]
    [InlineData("kind: syntax", "kind: walk-it", "chapters/c/part.md:2: part kind \"walk-it\" is not admitted; write kind as one of syntax, build, idioms, gotchas, library, cards, drill, hints")]
    [InlineData("kind: syntax", "kind: quiz", "chapters/c/part.md:2: part kind \"quiz\" is not admitted; write kind as one of syntax, build, idioms, gotchas, library, cards, drill, hints")]
    [InlineData("kind: syntax\nchapter: ch-test", "chapter: ch-test\nkind: steps", "chapters/c/part.md:3: part kind \"steps\" is not admitted; write kind as one of syntax, build, idioms, gotchas, library, cards, drill, hints")]
    public void APartKindTheCompilerDoesNotReadIsRefused(string from, string to, string expected) =>
        Assert.Equal(
            [expected],
            Diagnostics(("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead.Replace(from, to, StringComparison.Ordinal) + "## Good {#syn-good}\n")));

    [Theory]
    [InlineData("<div>raw</div>\n", "raw HTML is not allowed")]
    [InlineData("Some <b>bold</b> text.\n", "raw HTML is not allowed")]
    [InlineData("> quoted\n", "unsupported Markdown: block quote")]
    [InlineData("***\n", "unsupported Markdown: thematic break")]
    [InlineData("    indented code\n", "unsupported Markdown: indented code block")]
    [InlineData("A [link](https://example.com) here.\n", "link target \"https://example.com\" is not an internal target; write [text](#id) or [text](ch-chapter#id)")]
    [InlineData("An ![image](a.png) here.\n", "unsupported Markdown: image")]
    [InlineData("A <https://example.com> link.\n", "unsupported Markdown: autolink")]
    [InlineData("Hard  \nbreak.\n", "unsupported Markdown: hard line break")]
    [InlineData("### Deeper {#syn-deep}\n", "only ## headings are supported")]
    [InlineData("Text {#syn-para}\n", "attributes are allowed only as a heading's {#id} and on code fences")]
    [InlineData("- one\n\n  more\n", "a list item holds one paragraph only")]
    public void UnsupportedMarkdownFails(string body, string message) =>
        Assert.Contains($"chapters/c/part.md:9: {message}", Diagnostics(Part("## Good {#syn-good}\n\n" + body)), StringComparer.Ordinal);

    [Fact]
    public void PartTextBeforeTheFirstHeadingFails() =>
        Assert.Contains("chapters/c/part.md:7: a part file holds nothing before its first ## heading", Diagnostics(Part("Stray text.\n\n## Good {#syn-good}\n")), StringComparer.Ordinal);

    [Theory]
    [InlineData("csharp {group=g spoken=\"Runs\"}", "csharp fence needs an {#id}")]
    [InlineData("csharp {#syn-a1 spoken=\"Runs\"}", "csharp fence needs a group")]
    [InlineData("csharp {#syn-a1 group=g}", "code fence needs a spoken gloss (spoken=\"...\")")]
    [InlineData("csharp {#syn-a1 #syn-a2 group=g spoken=\"Runs\"}", "code fence has more than one #id")]
    [InlineData("csharp {#syn-a1 group=g group=h spoken=\"Runs\"}", "code fence attribute \"group\" is given twice")]
    [InlineData("text {group=g spoken=\"Runs\"}", "text fence does not take \"group\"")]
    [InlineData("python {spoken=\"Runs\"}", "code fence language must be csharp or text, not \"python\"")]
    [InlineData("csharp {#Bad_Id group=g spoken=\"Runs\"}", "code fence id \"Bad_Id\" is not lowercase letters, digits and hyphens starting with a letter, at most 48 characters")]
    public void FenceRuleBreachesFail(string info, string message) =>
        Assert.Contains($"chapters/c/part.md:9: {message}", Diagnostics(Part(Fence(info))), StringComparer.Ordinal);

    [Fact]
    public void PartNamingAnotherChapterFails() =>
        Assert.Contains(
            "chapters/c/part.md:1: chapter \"ch-other\" does not match \"ch-test\" in chapter.md",
            Diagnostics(("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead.Replace("ch-test", "ch-other", StringComparison.Ordinal) + "## Good {#syn-good}\n")),
            StringComparer.Ordinal);

    [Theory]
    [InlineData("chapter.md", "id: ch-test", "id: \"ch-test\\n\"", "chapters/c/chapter.md:2: chapter id \"ch-test\\u000a\"")]
    [InlineData("chapter.md", "id: ch-test", "id: Ch-Test", "chapters/c/chapter.md:2: chapter id \"Ch-Test\"")]
    [InlineData("part.md", "chapter: ch-test", "chapter: \"ch-test\\n\"", "chapters/c/part.md:3: chapter reference \"ch-test\\u000a\"")]
    [InlineData("part.md", "chapter: ch-test", "chapter: \"ch test\"", "chapters/c/part.md:3: chapter reference \"ch test\"")]
    public void FrontMatterIdOutsideTheIdGrammarFails(string file, string from, string to, string message)
    {
        var chapter = string.Equals(file, "chapter.md", StringComparison.Ordinal) ? Chapter.Replace(from, to, StringComparison.Ordinal) : Chapter;
        var part = string.Equals(file, "part.md", StringComparison.Ordinal) ? PartHead.Replace(from, to, StringComparison.Ordinal) : PartHead;

        var diagnostics = Diagnostics(("chapters/c/chapter.md", chapter), ("chapters/c/part.md", part + "## Good {#syn-good}\n"));

        Assert.Contains($"{message} {ContentIds.FormatRule}", diagnostics, StringComparer.Ordinal);
    }

    [Fact]
    public void ChaptersFolderThatIsALinkFails()
    {
        using var root = new TempFolder();
        using var outside = new TempFolder();
        outside.Write("chapters/c/chapter.md", Chapter);
        using var linked = Links.Folder(Path.Combine(root.Path, "chapters"), Path.Combine(outside.Path, "chapters"));

        var error = Assert.Throws<BoundaryException>(() => Repository.Compile(root.Path));

        Assert.Equal("chapters: links and reparse points are not accepted at or below a root folder", error.Message);
    }

    // The link is the root argument itself, so it lies above the root the kernel opens.
    [Fact]
    public void ContentRootGivenThroughALinkCompiles()
    {
        using var parent = new TempFolder();
        using var outside = new TempFolder();
        outside.Write("chapters/c/chapter.md", Chapter);
        outside.Write("aliases.yml", "slugs: {}\nids: {}\n");
        outside.Write("patterns.yml", "patterns: []\n");
        var link = Path.Combine(parent.Path, "content");
        using var linked = Links.Folder(link, outside.Path);

        var result = ContentCompiler.Compile(link, Repository.Schema, parent.Path);

        Assert.Empty(result.Diagnostics);
        Assert.Equal(["chapters/c/chapter.json", "aliases.json", "patterns.json"], result.Files.Select(f => f.RelativePath), StringComparer.Ordinal);
    }

    [Fact]
    public void ChapterFolderWithoutChapterFileFails() =>
        Assert.Contains("chapters/c: chapter folder has no chapter.md", Diagnostics(("chapters/c/part.md", PartHead + "## Good {#syn-good}\n")), StringComparer.Ordinal);

    private static (string Path, string Text)[] Part(string body) => [("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead + body)];

    // The heading sits at line 7 of a part and the fence opens at line 9.
    private static string Fence(string info) => $"## Good {{#syn-good}}\n\n```{info}\nint x = 1;\n```\n";

    private static List<string> Diagnostics(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        foreach (var (path, text) in files)
        {
            folder.Write(path, text);
        }

        return [.. Repository.Compile(folder.Path).Diagnostics.Select(d => d.ToString())];
    }
}
