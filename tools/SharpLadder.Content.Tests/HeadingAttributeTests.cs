using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class HeadingAttributeTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string PartHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n";

    [Theory]
    [InlineData("speech=skip spoken=\"A summary.\"")]
    [InlineData("spoken=\"A summary.\" speech=skip")]
    [InlineData("speech=\"skip\" spoken='A summary.'")]
    [InlineData("speech=skip spoken=\"It's a \\ back-slash and a 'quote'.\"")]
    [InlineData("speech=skip spoken=\"Ünïcode and 日本語.\"")]
    public void SkipWithSummaryPasses(string attributes) =>
        Assert.Empty(Diagnostics(Part($"## Title {{#syn-a {attributes}}}\n\nText.\n")));

    [Fact]
    public void SkipWithoutSummaryFails() =>
        Assert.Equal(
            ["chapters/c/part.md:7: speech=skip needs a spoken summary (spoken=\"...\")"],
            Diagnostics(Part("## Title {#syn-a speech=skip}\n")),
            StringComparer.Ordinal);

    [Fact]
    public void SummaryWithoutSkipFails() =>
        Assert.Equal(
            ["chapters/c/part.md:7: spoken is allowed on a heading only with speech=skip"],
            Diagnostics(Part("## Title {#syn-a spoken=\"A summary.\"}\n")),
            StringComparer.Ordinal);

    [Theory]
    [InlineData("speech=skip speech=skip spoken=\"x\"", "speech")]
    [InlineData("speech=skip spoken=\"x\" spoken=\"y\"", "spoken")]
    [InlineData("spoken=\"x\" speech=skip spoken=\"x\"", "spoken")]
    public void RepeatedAttributeFails(string attributes, string name) =>
        Assert.Equal(
            [$"chapters/c/part.md:7: heading attribute \"{name}\" is given twice"],
            Diagnostics(Part($"## Title {{#syn-a {attributes}}}\n")),
            StringComparer.Ordinal);

    // The parser splits where a quote ends even without a space, so the raw names alone miss these.
    [Theory]
    [InlineData("speech=skip spoken=\"x\"spoken=\"y\"")]
    [InlineData("speech=skip spoken='x'spoken")]
    [InlineData("spoken=\"x\"spoken=\"x\"")]
    [InlineData("spoken='x'speech=skip")]
    [InlineData("spoken=\"x\"speech=skip speech=skip")]
    public void AttributesRunTogetherFailAsContentErrors(string attributes)
    {
        var diagnostics = Diagnostics(Part($"## Title {{#syn-a {attributes}}}\n"));

        Assert.NotEmpty(diagnostics);
        Assert.All(diagnostics, d => Assert.StartsWith("chapters/c/part.md:7: ", d, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("Speech=skip spoken=\"x\"", "Speech")]
    [InlineData("speech=skip SPOKEN=\"x\"", "SPOKEN")]
    [InlineData("speech=skip spoken=\"x\" colour=red", "colour")]
    [InlineData("colour=red", "colour")]
    public void UnknownOrWrongCaseAttributeFails(string attributes, string name) =>
        Assert.Contains(
            $"chapters/c/part.md:7: unknown heading attribute \"{name}\"; only speech=skip and spoken=\"...\" are supported",
            Diagnostics(Part($"## Title {{#syn-a {attributes}}}\n")),
            StringComparer.Ordinal);

    [Theory]
    [InlineData("speech=Skip spoken=\"x\"")]
    [InlineData("speech=SKIP spoken=\"x\"")]
    [InlineData("speech=no spoken=\"x\"")]
    [InlineData("speech=\"\" spoken=\"x\"")]
    public void SpeechValueOtherThanSkipFails(string attributes) =>
        Assert.Contains("chapters/c/part.md:7: heading attribute speech must be skip", Diagnostics(Part($"## Title {{#syn-a {attributes}}}\n")), StringComparer.Ordinal);

    [Theory]
    [InlineData("speech spoken=\"x\"", "speech")]
    [InlineData("speech=skip spoken", "spoken")]
    public void AttributeWithoutValueFails(string attributes, string name) =>
        Assert.Contains($"chapters/c/part.md:7: heading attribute \"{name}\" needs a value", Diagnostics(Part($"## Title {{#syn-a {attributes}}}\n")), StringComparer.Ordinal);

    [Theory]
    [InlineData("spoken=\"\"")]
    [InlineData("spoken=\"   \"")]
    public void EmptySummaryFails(string spoken) =>
        Assert.Equal(
            ["chapters/c/part.md:7: heading spoken summary must not be empty"],
            Diagnostics(Part($"## Title {{#syn-a speech=skip {spoken}}}\n")),
            StringComparer.Ordinal);

    [Fact]
    public void SummaryOfTwoHundredCharactersPasses() =>
        Assert.Empty(Diagnostics(Part($"## Title {{#syn-a speech=skip spoken=\"{new string('a', 200)}\"}}\n")));

    [Fact]
    public void SummaryOfTwoHundredAndOneCharactersFails() =>
        Assert.Equal(
            ["chapters/c/part.md:7: spoken summary is 201 characters; at most 200 are allowed"],
            Diagnostics(Part($"## Title {{#syn-a speech=skip spoken=\"{new string('a', 201)}\"}}\n")),
            StringComparer.Ordinal);

    // Length is counted in code points, as the schema counts it, so an astral character is one.
    [Fact]
    public void AstralCharacterCountsAsOne()
    {
        var atLimit = new string('a', 199) + "\U0001F600";
        var over = new string('a', 200) + "\U0001F600";

        Assert.Empty(Diagnostics(Part($"## Title {{#syn-a speech=skip spoken=\"{atLimit}\"}}\n")));
        Assert.Equal(
            ["chapters/c/part.md:7: spoken summary is 201 characters; at most 200 are allowed"],
            Diagnostics(Part($"## Title {{#syn-a speech=skip spoken=\"{over}\"}}\n")),
            StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("## Title {#syn-a .big}\n")]
    [InlineData("## Title {#syn-a} {speech=skip spoken=\"x\"}\n")]
    [InlineData("## Title {speech=skip spoken=\"x\"}\n")]
    public void OtherHeadingAttributeShapesStayRefused(string heading) =>
        Assert.NotEmpty(Diagnostics(Part(heading)));

    [Fact]
    public void AttributesOnANonSectionHeadingFail() =>
        Assert.Contains(
            "chapters/c/part.md:7: only ## headings are supported",
            Diagnostics(Part("### Title {#syn-a speech=skip spoken=\"x\"}\n")),
            StringComparer.Ordinal);

    [Fact]
    public void SpeechAttributesOnAParagraphFail() =>
        Assert.Contains(
            "chapters/c/part.md:9: attributes are allowed only as a heading's {#id} and on code fences",
            Diagnostics(Part("## Title {#syn-a}\n\nText {speech=skip spoken=\"x\"}\n")),
            StringComparer.Ordinal);

    [Fact]
    public void SkippedSectionStillCompilesItsBody() =>
        Assert.Equal(["syn-a/b1", "syn-a/b2"], BlockIds(Part("## Title {#syn-a speech=skip spoken=\"x\"}\n\nOne.\n\nTwo.\n"), "chapters/c/part.md"), StringComparer.Ordinal);

    [Fact]
    public void CounterRunsThroughEveryKindOfBlock()
    {
        var body = "## Title {#syn-a}\n\nOne.\n\n- a\n- b\n\n"
            + "```csharp {#syn-a1 group=g spoken=\"Runs\"}\nint x = 1;\n```\n\n"
            + "[ref]: #syn-a\n\n"
            + "```text {spoken=\"Plain\"}\nplain\n```\n\nLast.\n";

        Assert.Equal(["syn-a/b1", "syn-a/b2", "syn-a/b3", "syn-a/b4", "syn-a/b5"], BlockIds(Part(body), "chapters/c/part.md"), StringComparer.Ordinal);
    }

    [Fact]
    public void CounterRestartsAtEachSectionAndTheIntroHasItsOwn()
    {
        var files = Part("## One {#syn-a}\n\nA.\n\nB.\n\n## Two {#syn-b speech=skip spoken=\"x\"}\n\nC.\n\n## Three {#syn-c}\n\nD.\n\nE.\n\nF.\n");

        Assert.Equal(["syn-a/b1", "syn-a/b2", "syn-b/b1", "syn-c/b1", "syn-c/b2", "syn-c/b3"], BlockIds(files, "chapters/c/part.md"), StringComparer.Ordinal);
        Assert.Equal(["intro/b1"], BlockIds(files, "chapters/c/chapter.md"), StringComparer.Ordinal);
    }

    [Fact]
    public void ListItemIdsStayUnderTheirListNumber()
    {
        var ids = ItemIds(Part("## Title {#syn-a}\n\nOne.\n\n- a\n- b\n\nTwo.\n\n1. c\n"), "chapters/c/part.md");

        Assert.Equal(["syn-a/b2.i1", "syn-a/b2.i2", "syn-a/b4.i1"], ids);
    }

    private static (string Path, string Text)[] Part(string body) => [("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead + body)];

    private static List<string> BlockIds((string Path, string Text)[] files, string source) => Ids(files, source, topLevel: true);

    private static List<string> ItemIds((string Path, string Text)[] files, string source) => Ids(files, source, topLevel: false);

    // Intro blocks are told apart from section blocks by their intro prefix.
    private static List<string> Ids((string Path, string Text)[] files, string source, bool topLevel)
    {
        using var folder = new TempFolder();
        foreach (var (path, text) in files)
        {
            folder.Write(path, text);
        }

        var result = Repository.Compile(folder.Path);
        Assert.Empty(result.Diagnostics);
        var wantIntro = source.EndsWith("chapter.md", StringComparison.Ordinal);
        var ids = new List<string>();
        foreach (var file in result.Files)
        {
            // Body blocks only: a segment target repeats a block id and is not a block.
            var root = JsonNode.Parse(file.Bytes)!;
            var bodies = (root["sections"]?.AsArray() ?? []).Select(s => s!["body"]!.AsArray()).Prepend(root["intro"]?.AsArray() ?? []);
            var blocks = bodies.SelectMany(b => b).ToList();
            var items = blocks.SelectMany(b => b!["items"]?.AsArray().ToList() ?? []);
            foreach (var id in blocks.Concat(items).Select(b => (string)b!["blockId"]!))
            {
                var isIntro = id.StartsWith("intro/", StringComparison.Ordinal);
                if (isIntro == wantIntro && id.Contains(".i", StringComparison.Ordinal) != topLevel)
                {
                    ids.Add(id);
                }
            }
        }

        return ids;
    }

    private static List<string> Diagnostics((string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        foreach (var (path, text) in files)
        {
            folder.Write(path, text);
        }

        return [.. Repository.Compile(folder.Path).Diagnostics.Select(d => d.ToString())];
    }
}
