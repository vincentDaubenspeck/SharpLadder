using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Spoken segments and the audio slot, read back from the compiled output of real source files.
public sealed class SpeechTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string PartHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n";
    private const string EmptySlot = "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

    [Fact]
    public void SegmentsFollowTheBodyInReadingOrder()
    {
        var body = "## Title {#syn-a}\n\nOne.\n\n- first\n- second\n\n"
            + "```csharp {#syn-a1 group=g spoken=\"Runs it\"}\nint x = 1;\n```\n\n"
            + "```text {spoken=\"Shows it\"}\nplain\n```\n\nLast.\n";

        var speech = Speech(body, "syn-a");

        Assert.Equal(["block syn-a/b1", "block syn-a/b2.i1", "block syn-a/b2.i2", "block syn-a/b3", "block syn-a/b4", "block syn-a/b5"], Targets(speech), StringComparer.Ordinal);
        Assert.Equal(["One.", "first", "second", "Runs it", "Shows it", "Last."], Texts(speech), StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("Plain *em **strong `code`** [link text](#syn-a)* tail.", "Plain em strong code link text tail.")]
    [InlineData("one\ntwo", "one two")]
    [InlineData("a*b*c", "abc")]
    [InlineData("two  spaces and a `  code  ` span", "two  spaces and a  code  span")]
    [InlineData("a&amp;b &lt;c&gt;", "a&b <c>")]
    public void InlineTextIsFlattenedWithNothingAdded(string markdown, string expected) =>
        Assert.Equal([expected], Texts(Speech($"## Title {{#syn-a}}\n\n{markdown}\n", "syn-a")), StringComparer.Ordinal);

    [Fact]
    public void TheHeadingAndTheIntroAreNeverSpoken()
    {
        var files = Files(Chapter + "\n## Heading words {#ch-sec}\n\nBody words.\n", "## Part heading {#syn-a}\n\nPart words.\n");

        var chapter = Compiled(files, "chapters/c/chapter.json");
        var all = string.Concat(Texts(chapter["sections"]![0]!["spoken"]!));

        Assert.Equal("Body words.", all);
        Assert.Null(chapter["spoken"]);
        Assert.DoesNotContain("spoken", chapter["intro"]!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public void SkippedSectionSpeaksItsSummaryAloneAndTargetsTheSection()
    {
        var part = Compiled(Part("## Title {#syn-a speech=skip spoken=\"The summary.\"}\n\nShown, not spoken.\n\n- item\n"), "chapters/c/part.json");
        var section = part["sections"]![0]!;

        Assert.Equal("""[{"target":{"type":"section","sectionId":"syn-a"},"text":"The summary."}]""", section["spoken"]!["segments"]!.ToJsonString());
        Assert.Equal(2, section["body"]!.AsArray().Count);
        Assert.Equal(AudioSlot.Of(["The summary."]), (string?)section["spoken"]!["audio"]);
    }

    [Fact]
    public void SectionWithNoBodyHasNoSegmentsAndTheEmptySlot()
    {
        var speech = Speech("## Title {#syn-a}\n", "syn-a");

        Assert.Empty(speech["segments"]!.AsArray());
        Assert.Equal(EmptySlot, (string?)speech["audio"]);
    }

    [Fact]
    public void SlotCoversExactlyTheStoredTextsInOrder()
    {
        var one = Speech("## Title {#syn-a}\n\nFirst.\n\nSecond.\n", "syn-a");
        var swapped = Speech("## Title {#syn-a}\n\nSecond.\n\nFirst.\n", "syn-a");
        var renamed = Speech("## Other title {#syn-z}\n\nFirst.\n\nSecond.\n", "syn-z");

        Assert.Equal(AudioSlot.Of(["First.", "Second."]), (string?)one["audio"]);
        Assert.Matches("^sha256:[0-9a-f]{64}$", (string?)one["audio"]);
        Assert.NotEqual((string?)one["audio"], (string?)swapped["audio"], StringComparer.Ordinal);
        Assert.Equal((string?)one["audio"], (string?)renamed["audio"]);
    }

    [Fact]
    public void ChangeInAnotherSectionLeavesASlotAlone()
    {
        var before = Compiled(Part("## A {#syn-a}\n\nSame.\n\n## B {#syn-b}\n\nOne.\n"), "chapters/c/part.json");
        var after = Compiled(Part("## A {#syn-a}\n\nSame.\n\n## B {#syn-b}\n\nOne.\n\nTwo.\n"), "chapters/c/part.json");

        Assert.Equal((string?)before["sections"]![0]!["spoken"]!["audio"], (string?)after["sections"]![0]!["spoken"]!["audio"]);
        Assert.NotEqual((string?)before["sections"]![1]!["spoken"]!["audio"], (string?)after["sections"]![1]!["spoken"]!["audio"], StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("café")]
    [InlineData("caf*e*́")]
    [InlineData("caf`e`́")]
    [InlineData("caf[e](#syn-a)́")]
    public void DecomposedTextIsStoredAndHashedComposed(string markdown)
    {
        var composed = Speech("## Title {#syn-a}\n\ncafé\n", "syn-a");

        var speech = Speech($"## Title {{#syn-a}}\n\n{markdown}\n", "syn-a");

        Assert.Equal(["café"], Texts(speech), StringComparer.Ordinal);
        Assert.Equal((string?)composed["audio"], (string?)speech["audio"]);
    }

    [Fact]
    public void GlossIsSpokenComposedWhileTheBlockKeepsTheAuthorsText()
    {
        var part = Compiled(Part("## Title {#syn-a}\n\n```text {spoken=\"café\"}\nplain\n```\n"), "chapters/c/part.json");
        var section = part["sections"]![0]!;

        Assert.Equal("café", (string?)section["body"]![0]!["spoken"]);
        Assert.Equal(["café"], Texts(section["spoken"]!), StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("a&#13;b", "a\nb")]
    [InlineData("a&#13;&#10;b", "a\nb")]
    [InlineData("a&#xD;&#xD;b", "a\n\nb")]
    public void CarriageReturnFromACharacterReferenceIsStoredAsALineFeed(string markdown, string expected) =>
        Assert.Equal([expected], Texts(Speech($"## Title {{#syn-a}}\n\n{markdown}\n", "syn-a")), StringComparer.Ordinal);

    [Theory]
    [InlineData("a￾b")]
    [InlineData("a﷐b")]
    [InlineData("a\U0001FFFFb")]
    [InlineData("- fine\n- a￿b")]
    [InlineData("```text {spoken=\"a￾b\"}\nplain\n```")]
    public void NoncharacterInSpokenTextIsAContentError(string markdown) =>
        Assert.Equal(
            ["chapters/c/part.md:9: spoken text holds a character that cannot be stored (a lone surrogate or a noncharacter)"],
            Diagnostics(Part($"## Title {{#syn-a}}\n\n{markdown}\n")),
            StringComparer.Ordinal);

    [Fact]
    public void NoncharacterInASummaryIsAContentError() =>
        Assert.Equal(
            ["chapters/c/part.md:7: spoken text holds a character that cannot be stored (a lone surrogate or a noncharacter)"],
            Diagnostics(Part("## Title {#syn-a speech=skip spoken=\"a￾b\"}\n\nText.\n")),
            StringComparer.Ordinal);

    [Fact]
    public void NoncharacterInASkippedBodyIsNotSpokenSoItIsAdmitted() =>
        Assert.Empty(Diagnostics(Part("## Title {#syn-a speech=skip spoken=\"Fine.\"}\n\na￾b\n")));

    [Theory]
    [InlineData("&#32;")]
    [InlineData("&nbsp;")]
    [InlineData("&#x2003;&#9;")]
    public void ParagraphWithNothingToSayIsAContentError(string markdown) =>
        Assert.Equal(
            ["chapters/c/part.md:9: spoken text is empty"],
            Diagnostics(Part($"## Title {{#syn-a}}\n\n{markdown}\n")),
            StringComparer.Ordinal);

    [Theory]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1"},"text":"One."}""", true)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1.i2"},"text":"One."}""", true)]
    [InlineData("""{"target":{"type":"section","sectionId":"syn-a"},"text":"One."}""", true)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b0"},"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1.i0"},"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1\n"},"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"block","sectionId":"syn-a"},"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"section","blockId":"syn-a/b1"},"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"section","sectionId":"syn-a","blockId":"syn-a/b1"},"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"section","sectionId":"intro"},"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"heading","sectionId":"syn-a"},"text":"One."}""", false)]
    [InlineData("""{"target":{"blockId":"syn-a/b1"},"text":"One."}""", false)]
    [InlineData("""{"target":"syn-a/b1","text":"One."}""", false)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1"},"text":""}""", false)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1"},"text":7}""", false)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1"}}""", false)]
    [InlineData("""{"text":"One."}""", false)]
    [InlineData("""{"target":{"type":"block","blockId":"syn-a/b1"},"text":"One.","id":"x"}""", false)]
    public void SchemaAdmitsOnlyTheTwoTargetShapes(string segment, bool admitted)
    {
        var part = Compiled(Part("## Title {#syn-a}\n\nOne.\n"), "chapters/c/part.json");
        part["sections"]![0]!["spoken"]!["segments"] = new JsonArray(JsonNode.Parse(segment));

        Assert.Equal(admitted, Repository.Schema.Validate(part.ToJsonString()) is null);
    }

    [Theory]
    [InlineData("sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", true)]
    [InlineData("sha256:4F53CDA18C2BAA0C0354BB5F9A3ECBE5ED12AB4D8E11BA873C2F11161202B945", false)]
    [InlineData("sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b94", false)]
    [InlineData("sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b9450", false)]
    [InlineData("sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945\n", false)]
    [InlineData("sha512:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", false)]
    [InlineData("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", false)]
    [InlineData("", false)]
    public void SchemaAdmitsOnlyTheSlotForm(string audio, bool admitted)
    {
        var part = Compiled(Part("## Title {#syn-a}\n"), "chapters/c/part.json");
        part["sections"]![0]!["spoken"]!["audio"] = audio;

        Assert.Equal(admitted, Repository.Schema.Validate(part.ToJsonString()) is null);
    }

    [Theory]
    [InlineData("spoken")]
    [InlineData("spoken/segments")]
    [InlineData("spoken/audio")]
    public void SchemaRefusesASectionWithoutItsSpeech(string missing)
    {
        foreach (var files in new[] { Part("## Title {#syn-a}\n\nOne.\n"), Files(Chapter + "\n## Title {#ch-sec}\n\nOne.\n", "## Title {#syn-a}\n\nOne.\n") })
        {
            var document = Compiled(files, files.Length == 2 && files[0].Text.Contains("ch-sec", StringComparison.Ordinal) ? "chapters/c/chapter.json" : "chapters/c/part.json");
            var names = missing.Split('/');
            var holder = names.Length == 1 ? document["sections"]![0]! : document["sections"]![0]!["spoken"]!;
            Assert.True(holder.AsObject().Remove(names[^1]));

            Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
        }
    }

    [Fact]
    public void SchemaRefusesAnExtraSpeechProperty()
    {
        var part = Compiled(Part("## Title {#syn-a}\n\nOne.\n"), "chapters/c/part.json");
        part["sections"]![0]!["spoken"]!["voice"] = "x";

        Assert.NotNull(Repository.Schema.Validate(part.ToJsonString()));
    }

    private static JsonNode Speech(string partBody, string sectionId)
    {
        var part = Compiled(Part(partBody), "chapters/c/part.json");
        return part["sections"]!.AsArray().Single(s => string.Equals((string?)s!["id"], sectionId, StringComparison.Ordinal))!["spoken"]!;
    }

    private static List<string> Texts(JsonNode speech) => [.. speech["segments"]!.AsArray().Select(s => (string)s!["text"]!)];

    private static List<string> Targets(JsonNode speech) =>
        [.. speech["segments"]!.AsArray().Select(s => $"{(string)s!["target"]!["type"]!} {(string?)s["target"]!["blockId"] ?? (string?)s["target"]!["sectionId"]}")];

    private static (string Path, string Text)[] Part(string body) => Files(Chapter, body);

    private static (string Path, string Text)[] Files(string chapter, string partBody) =>
        [("chapters/c/chapter.md", chapter), ("chapters/c/part.md", PartHead + partBody)];

    private static JsonNode Compiled((string Path, string Text)[] files, string output)
    {
        var result = Run(files);
        Assert.Empty(result.Diagnostics);
        return JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, output, StringComparison.Ordinal)).Bytes)!;
    }

    private static List<string> Diagnostics((string Path, string Text)[] files) => [.. Run(files).Diagnostics.Select(d => d.ToString())];

    private static CompileResult Run((string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        foreach (var (path, text) in files)
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return Repository.Compile(folder.Path);
    }
}
