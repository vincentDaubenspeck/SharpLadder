using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Build approaches: the written form, the shared lead, numbering and speech through every
// approach, code groups kept inside one approach, and what compiler and schema refuse.
public sealed class ApproachTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string Front = "---\nkind: build\nchapter: ch-test\norder: 1\n---\n\n";
    private const string Head = Front + "## Build {#build-a}\n\n";
    private const string One = "### First way {#build-one approach=\"one\"}\n\nOne text.\n\n";
    private const string Two = "### Second *way* {#build-two approach=\"two\"}\n\nTwo text.\n\n- a\n- b\n\n";
    private const string Form = "an approach heading is written ### Title {#id approach=\"label\"}, with one line of shown text as the label and nothing else";

    [Fact]
    public void ASharedLeadAndItsApproachesCompileInOrder()
    {
        var section = Sections(Head + "Lead.\n\n" + One + Two)[0]!.AsObject();
        var approaches = section["approaches"]!.AsArray();

        Assert.Equal(["id", "number", "title", "body", "approaches", "spoken"], section.Select(p => p.Key), StringComparer.Ordinal);
        Assert.Equal(["build-a/b1"], section["body"]!.AsArray().Select(b => (string)b!["blockId"]!), StringComparer.Ordinal);
        Assert.Equal(["id", "title", "label", "body"], approaches[0]!.AsObject().Select(p => p.Key), StringComparer.Ordinal);
        Assert.Equal(["build-one", "build-two"], approaches.Select(a => (string)a!["id"]!), StringComparer.Ordinal);
        Assert.Equal(["one", "two"], approaches.Select(a => (string)a!["label"]!), StringComparer.Ordinal);
        Assert.Equal("""[{"type":"text","text":"Second "},{"type":"em","content":[{"type":"text","text":"way"}]}]""", approaches[1]!["title"]!.ToJsonString());
        Assert.Equal(["build-a/b2"], approaches[0]!["body"]!.AsArray().Select(b => (string)b!["blockId"]!), StringComparer.Ordinal);
        Assert.Equal(["build-a/b3", "build-a/b4"], approaches[1]!["body"]!.AsArray().Select(b => (string)b!["blockId"]!), StringComparer.Ordinal);
    }

    [Fact]
    public void ASectionMayHoldApproachesWithNoLeadAndBesideAnOrdinarySection()
    {
        var sections = Sections(Head + One + Two + "## Plain {#build-b}\n\nText.\n");

        Assert.Empty(sections[0]!["body"]!.AsArray());
        Assert.Equal(2, sections[0]!["approaches"]!.AsArray().Count);
        Assert.Equal(["id", "number", "title", "body", "spoken"], sections[1]!.AsObject().Select(p => p.Key), StringComparer.Ordinal);
        Assert.Equal(["build-b/b1"], sections[1]!["body"]!.AsArray().Select(b => (string)b!["blockId"]!), StringComparer.Ordinal);
    }

    [Fact]
    public void EveryApproachIsSpokenInOrderWithItsLabelOnItsFirstSegment()
    {
        var speech = Sections(Head + "Lead.\n\n" + One + Two)[0]!["spoken"]!;
        string[] texts = ["Lead.", "Approach: one. One text.", "Approach: two. Two text.", "a", "b"];

        Assert.Equal(texts, speech["segments"]!.AsArray().Select(s => (string)s!["text"]!), StringComparer.Ordinal);
        Assert.Equal(
            ["build-a/b1", "build-a/b2", "build-a/b3", "build-a/b4.i1", "build-a/b4.i2"],
            speech["segments"]!.AsArray().Select(s => (string)s!["target"]!["blockId"]!),
            StringComparer.Ordinal);
        Assert.Equal(AudioSlot.Of(texts), (string?)speech["audio"]);
    }

    [Theory]
    [InlineData("why?", "Approach: why?. One text.")]
    [InlineData("done.", "Approach: done.. One text.")]
    [InlineData("  padded  ", "Approach: padded. One text.")]
    [InlineData("brute force, twice", "Approach: brute force, twice. One text.")]
    public void TheApproachPrefixIsTheTrimmedLabelAndAlwaysItsFullStop(string label, string expected) =>
        Assert.Equal(expected, (string?)Sections(Head + One.Replace("approach=\"one\"", "approach=\"" + label + "\"", StringComparison.Ordinal) + Two)[0]!["spoken"]!["segments"]![0]!["text"]);

    [Fact]
    public void ApproachOrderChangesTheSpokenOrderAndTheSlot()
    {
        var forward = Sections(Head + One + Two)[0]!["spoken"]!;
        var reversed = Sections(Head + Two + One)[0]!["spoken"]!;

        Assert.Equal("Approach: one. One text.", (string?)forward["segments"]![0]!["text"]);
        Assert.Equal("Approach: two. Two text.", (string?)reversed["segments"]![0]!["text"]);
        Assert.NotEqual((string?)forward["audio"], (string?)reversed["audio"], StringComparer.Ordinal);
    }

    [Fact]
    public void ASkippedSectionSpeaksItsSummaryAndKeepsItsApproaches()
    {
        var section = Sections(Front + "## Build {#build-a speech=skip spoken=\"Two ways.\"}\n\n" + One + Two)[0]!;

        Assert.Equal("""[{"target":{"type":"section","sectionId":"build-a"},"text":"Two ways."}]""", section["spoken"]!["segments"]!.ToJsonString());
        Assert.Equal(2, section["approaches"]!.AsArray().Count);
    }

    [Fact]
    public void ALabelIsUniqueWithinItsSectionOnly()
    {
        var other = One.Replace("build-one", "build-three", StringComparison.Ordinal) + Two.Replace("build-two", "build-four", StringComparison.Ordinal);
        var sections = Sections(Head + One + Two + "## More {#build-b}\n\n" + other);

        Assert.Equal(["one", "two"], sections[1]!["approaches"]!.AsArray().Select(a => (string)a!["label"]!), StringComparer.Ordinal);
    }

    [Fact]
    public void AnApproachAndACodeAnchorInsideOneAreLinkTargets()
    {
        const string Code = "```csharp {#build-one1 group=g-one spoken=\"S\"}\nx();\n```\n\n";
        var sections = Sections(Head + "See [one](#build-one) and [its code](#build-one1).\n\n" + One + Code + Two);

        var links = sections[0]!["body"]![0]!["content"]!.AsArray().Where(s => string.Equals((string?)s!["type"], "link", StringComparison.Ordinal)).ToList();
        Assert.Equal(["build-one", "build-one1"], links.Select(l => (string)l!["id"]!), StringComparer.Ordinal);
        Assert.All(links, l => Assert.Equal("anchor", (string?)l!["kind"]));
    }

    [Fact]
    public void AGroupMayRepeatInsideOneApproachAndOutsideEveryApproach()
    {
        const string A = "```csharp {#c-a1 group=g-a spoken=\"S\"}\nx();\n```\n\n```csharp {#c-a2 group=g-a spoken=\"S\"}\ny();\n```\n\n";
        const string Lead = "```csharp {#c-l1 group=g-lead spoken=\"S\"}\nx();\n```\n\n";
        const string Plain = "## Plain {#build-b}\n\n```csharp {#c-l2 group=g-lead spoken=\"S\"}\ny();\n```\n";

        Assert.Equal(2, Sections(Head + Lead + One + A + Two + Plain).Count);
    }

    [Theory]
    [InlineData("```csharp {#c-1 group=g spoken=\"S\"}\nx();\n```\n\n", "", "```csharp {#c-2 group=g spoken=\"S\"}\ny();\n```\n\n", "chapters/c/part.md:24: group \"g\" is also used at line 9; the code of an approach forms groups of its own")]
    [InlineData("", "```csharp {#c-1 group=g spoken=\"S\"}\nx();\n```\n\n", "```csharp {#c-2 group=g spoken=\"S\"}\ny();\n```\n\n", "group \"g\" is also used at line 13; the code of an approach forms groups of its own")]
    public void AGroupNeverReachesAcrossAnApproach(string lead, string first, string second, string expected) =>
        Refused(expected, ("chapters/c/part.md", Head + lead + One + first + Two + second));

    [Fact]
    public void AGroupOfOneSectionsApproachIsNotReusedInAnotherSection() =>
        Refused(
            "group \"g\" is also used at line 13",
            ("chapters/c/part.md", Head + One + "```csharp {#c-1 group=g spoken=\"S\"}\nx();\n```\n\n" + Two + "## Plain {#build-b}\n\n```csharp {#c-2 group=g spoken=\"S\"}\ny();\n```\n"));

    [Theory]
    [InlineData(One, "chapters/c/part.md:9: approach \"build-one\" stands alone; a section with approaches holds at least two")]
    [InlineData(One + "### Again {#build-two approach=\"one\"}\n\nText.\n", "chapters/c/part.md:13: approach label \"one\" is used twice in this section")]
    [InlineData("### First {#build-one}\n\nText.\n\n" + Two, "chapters/c/part.md:9: " + Form)]
    [InlineData("### First {#build-one approach=\"\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: " + Form)]
    [InlineData("### First {#build-one approach=\"   \"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: " + Form)]
    [InlineData("### First {#build-one approach}\n\nText.\n\n" + Two, "chapters/c/part.md:9: " + Form)]
    [InlineData("### First {#build-one approach=\"a\" approach=\"b\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: " + Form)]
    [InlineData("### First {#build-one approach=\"a\" extra=\"b\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: " + Form)]
    [InlineData("### First {#build-one speech=skip spoken=\"S\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: " + Form)]
    [InlineData("### First {#build-one .wide approach=\"a\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: heading attributes other than one {#id} are not supported")]
    [InlineData("### First {approach=\"a\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: heading attributes other than one {#id} are not supported")]
    [InlineData("### First\n\nText.\n\n" + Two, "chapters/c/part.md:9: heading has no {#id}; write exactly one at the end of the heading")]
    [InlineData("### &#32; {#build-one approach=\"a\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: an approach title holds text")]
    [InlineData("### First {#build-one approach=\"a\"}\n\n" + Two, "chapters/c/part.md:9: approach \"build-one\" has no blocks")]
    [InlineData(One + "### Last {#build-two approach=\"two\"}\n", "chapters/c/part.md:13: approach \"build-two\" has no blocks")]
    [InlineData("#### Deep {#build-one approach=\"a\"}\n\nText.\n", "chapters/c/part.md:9: only ## headings are supported")]
    [InlineData("### First {#card-one approach=\"a\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: id \"card-one\" starts with card-, which only a card id may")]
    [InlineData("### First {#build-a approach=\"a\"}\n\nText.\n\n" + Two, "chapters/c/part.md:9: duplicate id \"build-a\" (first used at chapters/c/part.md:7)")]
    public void AnApproachOutsideItsRulesIsRefused(string body, string expected) => Refused(expected, ("chapters/c/part.md", Head + body));

    [Fact]
    public void OnlyABuildPartTakesApproaches() =>
        Refused(
            "chapters/c/part.md:9: only ## headings are supported",
            ("chapters/c/part.md", Front.Replace("kind: build", "kind: syntax", StringComparison.Ordinal) + "## Title {#syn-a}\n\n" + One + Two));

    [Fact]
    public void AnApproachBelongsUnderASection() =>
        Refused("chapters/c/part.md:7: only ## headings are supported", ("chapters/c/part.md", Front + One + Two));

    [Fact]
    public void ARetiredIdCannotBeAnApproachId() =>
        Refused("aliases.yml:3: \"build-one\" is in use, so it cannot be retired", ("chapters/c/part.md", Head + One + Two), ("aliases.yml", "slugs: {}\nids:\n  build-one: build-a\n"));

    [Theory]
    [InlineData("one-approach")]
    [InlineData("no-approaches")]
    [InlineData("no-label")]
    [InlineData("blank-label")]
    [InlineData("label-not-text")]
    [InlineData("no-title")]
    [InlineData("empty-body")]
    [InlineData("unknown-field")]
    [InlineData("cards-beside")]
    [InlineData("on-a-syntax-part")]
    public void TheSchemaRefusesApproachesOutsideTheSameRules(string change)
    {
        var document = Json(Run(("chapters/c/part.md", Head + "Lead.\n\n" + One + Two)), "chapters/c/part.json");
        Assert.Null(Repository.Schema.Validate(document.ToJsonString()));
        var section = document["sections"]![0]!.AsObject();
        var approaches = section["approaches"]!.AsArray();
        var first = approaches[0]!.AsObject();
        switch (change)
        {
            case "one-approach": approaches.RemoveAt(1); break;
            case "no-approaches": section["approaches"] = new JsonArray(); break;
            case "no-label": first.Remove("label"); break;
            case "blank-label": first["label"] = string.Empty; break;
            case "label-not-text": first["label"] = first["title"]!.DeepClone(); break;
            case "no-title": first.Remove("title"); break;
            case "empty-body": first["body"] = new JsonArray(); break;
            case "unknown-field": first["selected"] = true; break;
            case "cards-beside": section["cards"] = new JsonArray(); break;
            case "on-a-syntax-part": document["kind"] = "syntax"; break;
            default: throw new ArgumentOutOfRangeException(nameof(change));
        }

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    private static JsonArray Sections(string part)
    {
        var result = Run(("chapters/c/part.md", part));
        Assert.Empty(result.Diagnostics);
        return Json(result, "chapters/c/part.json")["sections"]!.AsArray();
    }

    private static JsonNode Json(CompileResult result, string path) =>
        JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, path, StringComparison.Ordinal)).Bytes)!;

    private static void Refused(string expected, params (string Path, string Text)[] files)
    {
        var result = Run(files);

        Assert.Contains(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    private static CompileResult Run(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        foreach (var (path, text) in files.Prepend(("chapters/c/chapter.md", Chapter)))
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return Repository.Compile(folder.Path);
    }
}
