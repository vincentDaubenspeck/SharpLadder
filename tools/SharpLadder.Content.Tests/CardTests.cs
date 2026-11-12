using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Cards: the one written form, the block numbering through a section, the spoken labels, and
// what is refused by the compiler and by the schema.
public sealed class CardTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string Front = "---\nkind: cards\nchapter: ch-test\norder: 1\n---\n\n";
    private const string Head = Front + "## Cards {#cards-a}\n\n";
    private const string Fields = "- reach: R.\n- build: B.\n- why: W.\n";
    private const string One = "### One {#card-one}\n\n" + Fields;
    private const string Two = "### Two {#card-two}\n\n" + Fields;
    private const string Full = "### Count *things* {#card-one}\n\n- reach: R `x`.\n- build: B.\n- why: W.\n\n  More.\n- traps:\n  - T1.\n  - T2.\n- also:\n  - A1.\n";
    private const string TrapsRule = "the traps field of card \"card-one\" is \"traps:\" with a bullet list of one or two items below it";
    private const string AlsoRule = "the also field of card \"card-one\" is \"also:\" with a bullet list of one or two items below it";
    private const string BuildRule = "the build field of card \"card-one\" is one paragraph or one code block with an id";
    private const string OnlyCards = "a cards section holds cards only: a ### heading with a {#card-id} and one bullet list of its fields";
    private const string Labels = "a field starts with its label in plain text and a colon; the labels are reach, build, why, traps, also";

    [Fact]
    public void ACardCompilesToItsFieldsInOrderInPlaceOfABody()
    {
        var section = Sections(Head + Full)[0]!.AsObject();
        var card = section["cards"]![0]!.AsObject();

        Assert.Equal(["id", "number", "title", "cards", "spoken"], section.Select(p => p.Key), StringComparer.Ordinal);
        Assert.Equal(["id", "title", "reach", "build", "why", "traps", "also"], card.Select(p => p.Key), StringComparer.Ordinal);
        Assert.Equal("card-one", (string?)card["id"]);
        Assert.Equal("""[{"type":"text","text":"Count "},{"type":"em","content":[{"type":"text","text":"things"}]}]""", card["title"]!.ToJsonString());
        Assert.Equal("paragraph", (string?)card["reach"]!["type"]);
        Assert.Equal("""{"type":"list","blockId":"cards-a/b5","ordered":false,"items":[{"blockId":"cards-a/b5.i1","content":[{"type":"text","text":"T1."}]},{"blockId":"cards-a/b5.i2","content":[{"type":"text","text":"T2."}]}]}""", card["traps"]!.ToJsonString());
    }

    [Fact]
    public void ACardWithoutTheOptionalFieldsHasNoKeysForThem()
    {
        var card = Sections(Head + One)[0]!["cards"]![0]!.AsObject();

        Assert.Equal(["id", "title", "reach", "build", "why"], card.Select(p => p.Key), StringComparer.Ordinal);
    }

    [Fact]
    public void BlockNumbersRunThroughEveryCardAndRestartInEachSection()
    {
        var sections = Sections(Head + Full + "\n" + Two + "\n## More {#cards-b}\n\n" + One.Replace("card-one", "card-three", StringComparison.Ordinal));

        Assert.Equal(
            ["cards-a/b1", "cards-a/b2", "cards-a/b3", "cards-a/b4", "cards-a/b5", "cards-a/b6", "cards-a/b7", "cards-a/b8", "cards-a/b9"],
            sections[0]!["cards"]!.AsArray().SelectMany(c => BlockIds(c!)),
            StringComparer.Ordinal);
        Assert.Equal(["cards-b/b1", "cards-b/b2", "cards-b/b3"], sections[1]!["cards"]!.AsArray().SelectMany(c => BlockIds(c!)), StringComparer.Ordinal);
        Assert.Equal(["1.1", "1.2"], sections.Select(s => (string?)s!["number"]), StringComparer.Ordinal);
    }

    [Fact]
    public void EachFieldIsAnnouncedOnceAndTheTitleRidesOnTheFirstSegment()
    {
        var speech = Sections(Head + Full + "\n" + Two)[0]!["spoken"]!;
        string[] texts = ["Card: Count things. Reach for: R x.", "Build: B.", "Why: W.", "More.", "Traps: T1.", "T2.", "Also: A1.", "Card: Two. Reach for: R.", "Build: B.", "Why: W."];

        Assert.Equal(texts, speech["segments"]!.AsArray().Select(s => (string)s!["text"]!), StringComparer.Ordinal);
        Assert.Equal(
            ["cards-a/b1", "cards-a/b2", "cards-a/b3", "cards-a/b4", "cards-a/b5.i1", "cards-a/b5.i2", "cards-a/b6.i1", "cards-a/b7", "cards-a/b8", "cards-a/b9"],
            speech["segments"]!.AsArray().Select(s => (string)s!["target"]!["blockId"]!),
            StringComparer.Ordinal);
        Assert.Equal(AudioSlot.Of(texts), (string?)speech["audio"]);
    }

    [Theory]
    [InlineData("Really?", "Card: Really?. Reach for: R.")]
    [InlineData("Stop.", "Card: Stop.. Reach for: R.")]
    [InlineData("*Em* and `code`", "Card: Em and code. Reach for: R.")]
    [InlineData("See [here](#card-one)", "Card: See here. Reach for: R.")]
    public void TheCardPrefixAlwaysWritesItsFullStop(string title, string expected) =>
        Assert.Equal(expected, (string?)Sections(Head + "### " + title + " {#card-one}\n\n" + Fields)[0]!["spoken"]!["segments"]![0]!["text"]);

    [Fact]
    public void CardOrderChangesTheSpokenOrderAndTheSlot()
    {
        var forward = Sections(Head + One + "\n" + Two)[0]!["spoken"]!;
        var reversed = Sections(Head + Two + "\n" + One)[0]!["spoken"]!;

        Assert.Equal("Card: One. Reach for: R.", (string?)forward["segments"]![0]!["text"]);
        Assert.Equal("Card: Two. Reach for: R.", (string?)reversed["segments"]![0]!["text"]);
        Assert.NotEqual((string?)forward["audio"], (string?)reversed["audio"], StringComparer.Ordinal);
    }

    [Fact]
    public void ASkippedCardsSectionSpeaksItsSummaryAndKeepsItsCards()
    {
        var section = Sections(Front + "## Cards {#cards-a speech=skip spoken=\"Two cards.\"}\n\n" + One + "\n" + Two)[0]!;

        Assert.Equal("""[{"target":{"type":"section","sectionId":"cards-a"},"text":"Two cards."}]""", section["spoken"]!["segments"]!.ToJsonString());
        Assert.Equal(2, section["cards"]!.AsArray().Count);
    }

    [Theory]
    [InlineData("- build: B.\n", "paragraph")]
    [InlineData("- build:\n\n  ```csharp {#one-code group=g spoken=\"S\"}\n  x();\n  ```\n\n", "code")]
    [InlineData("- build:\n\n  ```text {#one-text spoken=\"S\"}\n  x\n  ```\n\n", "text")]
    public void BuildIsOneParagraphOrOneFenceWithAnId(string build, string type)
    {
        var card = Sections(Head + "### One {#card-one}\n\n- reach: R.\n" + build + "- why: W.\n")[0]!["cards"]![0]!;

        Assert.Equal(type, (string?)card["build"]!["type"]);
        Assert.Equal("cards-a/b2", (string?)card["build"]!["blockId"]);
    }

    [Fact]
    public void WhyHoldsEveryBlockKindAndEachIsSpoken()
    {
        const string Why = "- why: W.\n\n  - a\n  - b\n\n  | A |\n  | --- |\n  | 1 |\n\n  ```csharp {#one-code group=g spoken=\"Code.\"}\n  x();\n  ```\n\n  ```text {spoken=\"Text.\"}\n  x\n  ```\n";
        var section = Sections(Head + "### One {#card-one}\n\n- reach: R.\n- build: B.\n" + Why)[0]!;

        Assert.Equal(["paragraph", "list", "table", "code", "text"], section["cards"]![0]!["why"]!.AsArray().Select(b => (string?)b!["type"]), StringComparer.Ordinal);
        Assert.Equal(
            ["Card: One. Reach for: R.", "Build: B.", "Why: W.", "a", "b", "Columns: A. Row 1. A: 1.", "Code.", "Text."],
            section["spoken"]!["segments"]!.AsArray().Select(s => (string)s!["text"]!),
            StringComparer.Ordinal);
    }

    [Fact]
    public void ACardIsALinkTargetAndASeeTarget()
    {
        var result = Run(
            ("chapters/c/part.md", Head + One + "\n### Two {#card-two}\n\n- reach: R.\n- build: B.\n- why: See [the first](#card-one).\n"),
            ("glossary/term-a.md", "---\nid: term-a\nterm: A\nshort: S.\nsee: [card-one]\n---\n\nBody.\n"));

        Assert.Empty(result.Diagnostics);
        var link = Json(result, "chapters/c/part.json")["sections"]![0]!["cards"]![1]!["why"]![0]!["content"]![1]!;
        Assert.Equal("card-one", (string?)link["id"]);
        Assert.Equal("anchor", (string?)link["kind"]);
    }

    [Theory]
    [InlineData("### One {#card-one}\n\n- build: B.\n- why: W.\n", "chapters/c/part.md:9: card \"card-one\" has no reach field; reach, build and why are required")]
    [InlineData("### One {#card-one}\n\n- reach: R.\n- why: W.\n", "chapters/c/part.md:9: card \"card-one\" has no build field; reach, build and why are required")]
    [InlineData("### One {#card-one}\n\n- reach: R.\n- build: B.\n", "chapters/c/part.md:9: card \"card-one\" has no why field; reach, build and why are required")]
    [InlineData(One + "- extra: X.\n", "chapters/c/part.md:14: " + Labels)]
    [InlineData("### One {#card-one}\n\n- build: B.\n- reach: R.\n- why: W.\n", "chapters/c/part.md:12: field \"reach\" is out of order; the order is reach, build, why, traps, also")]
    [InlineData(One + "- why: Again.\n", "chapters/c/part.md:14: field \"why\" is written twice")]
    [InlineData("### One {#card-one}\n\n- reach:\n- build: B.\n- why: W.\n", "chapters/c/part.md:11: field \"reach\" is empty")]
    [InlineData(One + "- traps:\n", "chapters/c/part.md:14: field \"traps\" is empty")]
    [InlineData("### One {#card-one}\n\n- reach:\n  - a\n- build: B.\n- why: W.\n", "chapters/c/part.md:9: the reach field of card \"card-one\" is one paragraph")]
    [InlineData("### One {#card-one}\n\n- reach: R.\n\n  More.\n- build: B.\n- why: W.\n", "chapters/c/part.md:9: the reach field of card \"card-one\" is one paragraph")]
    [InlineData("### One {#card-one}\n\n- reach: R.\n- build: B.\n\n  More.\n- why: W.\n", "chapters/c/part.md:9: " + BuildRule)]
    [InlineData("### One {#card-one}\n\n- reach: R.\n- build:\n  - a\n- why: W.\n", "chapters/c/part.md:9: " + BuildRule)]
    [InlineData("### One {#card-one}\n\n- reach: R.\n- build:\n\n  ```text {spoken=\"S\"}\n  x\n  ```\n\n- why: W.\n", "chapters/c/part.md:9: " + BuildRule)]
    [InlineData("### One {#card-one}\n\n- reach: R.\n- build:\n\n  ```csharp {group=g spoken=\"S\"}\n  x();\n  ```\n\n- why: W.\n", "chapters/c/part.md:14: ")]
    public void ACardOutsideItsFieldRulesIsRefused(string cards, string expected) => Refused(expected, ("chapters/c/part.md", Head + cards));

    [Theory]
    [InlineData("- traps:\n  - T1.\n  - T2.\n  - T3.\n", TrapsRule)]
    [InlineData("- traps: T.\n", TrapsRule)]
    [InlineData("- traps:\n  1. T.\n", TrapsRule)]
    [InlineData("- traps:\n  - T.\n\n  Extra.\n", TrapsRule)]
    [InlineData("- traps:\n\n  Extra.\n\n  - T.\n", TrapsRule)]
    [InlineData("- traps:\n  - T.\n\n    More.\n", "a list item holds one paragraph only")]
    [InlineData("- traps:\n  - T.\n    - nested\n", "a list item holds one paragraph only")]
    [InlineData("- also:\n  - A1.\n  - A2.\n  - A3.\n", AlsoRule)]
    [InlineData("- also: A.\n", AlsoRule)]
    [InlineData("- also:\n  1. A.\n", AlsoRule)]
    [InlineData("- also:\n  - A.\n- traps:\n  - T.\n", "field \"traps\" is out of order")]
    public void TrapsAndAlsoAreOneOrTwoPlainItems(string field, string expected) => Refused(expected, ("chapters/c/part.md", Head + One + field));

    [Theory]
    [InlineData("### One\n\n" + Fields, "chapters/c/part.md:9: heading has no {#id}; write exactly one at the end of the heading")]
    [InlineData("### One {#one}\n\n" + Fields, "chapters/c/part.md:9: card id \"one\" must start with card-")]
    [InlineData("### One {#term-one}\n\n" + Fields, "chapters/c/part.md:9: card id \"term-one\" must start with card-")]
    [InlineData("### One {#card-one speech=skip spoken=\"S\"}\n\n" + Fields, "chapters/c/part.md:9: a card heading takes its {#id} and nothing else")]
    [InlineData("### One {#card-one .wide}\n\n" + Fields, "chapters/c/part.md:9: heading attributes other than one {#id} are not supported")]
    [InlineData("### One {#card-one} {#card-two}\n\n" + Fields, "chapters/c/part.md:9: heading has more than one {#id}")]
    [InlineData("### &#32; {#card-one}\n\n" + Fields, "chapters/c/part.md:9: a card title holds text")]
    [InlineData("#### One {#card-one}\n\n" + Fields, "chapters/c/part.md:9: only ## headings are supported")]
    [InlineData("Text.\n\n" + One, "chapters/c/part.md:9: " + OnlyCards)]
    [InlineData(One + "\nText.\n\n" + Two, "chapters/c/part.md:15: " + OnlyCards)]
    [InlineData("### One {#card-one}\n\nText.\n\n" + Fields, "chapters/c/part.md:11: " + OnlyCards)]
    [InlineData(One + "\n<!-- -->\n\n- reach: R.\n", "chapters/c/part.md:")]
    [InlineData("### One {#card-one}\n\n" + Two, "chapters/c/part.md:9: card \"card-one\" has no fields; write one bullet list below its heading")]
    [InlineData("### One {#card-one}\n", "chapters/c/part.md:9: card \"card-one\" has no fields; write one bullet list below its heading")]
    [InlineData("", "chapters/c/part.md:7: a cards section holds at least one card")]
    [InlineData(One + "\n## Empty {#cards-b}\n", "chapters/c/part.md:15: a cards section holds at least one card")]
    [InlineData(One + "\n" + One, "chapters/c/part.md:15: duplicate id \"card-one\" (first used at chapters/c/part.md:9)")]
    public void ACardsSectionHoldsCardsAndNothingElse(string cards, string expected) => Refused(expected, ("chapters/c/part.md", Head + cards));

    [Fact]
    public void ACardBelongsUnderASection() =>
        Refused("chapters/c/part.md:7: only ## headings are supported", ("chapters/c/part.md", Front + One));

    [Theory]
    [InlineData("## Title {#syn-a}\n\n### One {#card-one}\n\n" + Fields, "chapters/c/part.md:9: only ## headings are supported")]
    [InlineData("## Title {#card-sec}\n\nText.\n", "chapters/c/part.md:7: id \"card-sec\" starts with card-, which only a card id may")]
    [InlineData("## Title {#syn-a}\n\n```csharp {#card-code group=g spoken=\"S\"}\nx();\n```\n", "chapters/c/part.md:9: id \"card-code\" starts with card-, which only a card id may")]
    [InlineData("## Title {#syn-a}\n\n```text {#card-text spoken=\"S\"}\nx\n```\n", "chapters/c/part.md:9: id \"card-text\" starts with card-, which only a card id may")]
    public void OnlyACardTakesTheCardPrefixAndOnlyACardsPartTakesCards(string body, string expected) =>
        Refused(expected, ("chapters/c/part.md", "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n" + body));

    [Fact]
    public void ACardIdIsUniqueAcrossFiles() =>
        Refused(
            "duplicate id \"card-one\"",
            ("chapters/c/part.md", Head + One),
            ("chapters/c/more.md", Front.Replace("order: 1", "order: 2", StringComparison.Ordinal) + "## Other {#cards-b}\n\n" + One));

    [Fact]
    public void ARetiredIdCannotBeACardId() =>
        Refused("aliases.yml:3: \"card-one\" is in use, so it cannot be retired", ("chapters/c/part.md", Head + One + "\n" + Two), ("aliases.yml", "slugs: {}\nids:\n  card-one: cards-a\n"));

    [Fact]
    public void ACardIsNotAnAliasSuccessor() =>
        Refused("aliases.yml:3: ", ("chapters/c/part.md", Head + One), ("aliases.yml", "slugs: {}\nids:\n  old-card: card-one\n"));

    [Theory]
    [InlineData("body")]
    [InlineData("no-cards")]
    [InlineData("empty-cards")]
    [InlineData("no-why")]
    [InlineData("empty-why")]
    [InlineData("unknown-field")]
    [InlineData("card-id")]
    [InlineData("third-trap")]
    [InlineData("no-trap")]
    [InlineData("ordered-traps")]
    [InlineData("traps-start")]
    [InlineData("reach-list")]
    [InlineData("build-list")]
    [InlineData("build-text-no-id")]
    public void TheSchemaRefusesACardsRecordOutsideTheSameRules(string change)
    {
        var document = Json(Run(("chapters/c/part.md", Head + Full.Replace("- build: B.\n", "- build:\n\n  ```text {#one-text spoken=\"S\"}\n  x\n  ```\n\n", StringComparison.Ordinal))), "chapters/c/part.json");
        Assert.Null(Repository.Schema.Validate(document.ToJsonString()));
        var section = document["sections"]![0]!.AsObject();
        var card = section["cards"]![0]!.AsObject();
        var traps = card["traps"]!.AsObject();
        switch (change)
        {
            case "body": section["body"] = new JsonArray(); break;
            case "no-cards": section.Remove("cards"); section["body"] = new JsonArray(); break;
            case "empty-cards": section["cards"] = new JsonArray(); break;
            case "no-why": card.Remove("why"); break;
            case "empty-why": card["why"] = new JsonArray(); break;
            case "unknown-field": card["extra"] = card["reach"]!.DeepClone(); break;
            case "card-id": card["id"] = "one"; break;
            case "third-trap": traps["items"]!.AsArray().Add(traps["items"]![0]!.DeepClone()); break;
            case "no-trap": traps["items"] = new JsonArray(); break;
            case "ordered-traps": traps["ordered"] = true; break;
            case "traps-start": traps["start"] = 1; break;
            case "reach-list": card["reach"] = traps.DeepClone(); break;
            case "build-list": card["build"] = traps.DeepClone(); break;
            case "build-text-no-id": card["build"]!.AsObject().Remove("id"); break;
            default: throw new ArgumentOutOfRangeException(nameof(change));
        }

        Assert.NotNull(Repository.Schema.Validate(document.ToJsonString()));
    }

    private static IEnumerable<string> BlockIds(JsonNode card)
    {
        yield return (string)card["reach"]!["blockId"]!;
        yield return (string)card["build"]!["blockId"]!;
        foreach (var block in card["why"]!.AsArray())
        {
            yield return (string)block!["blockId"]!;
        }

        foreach (var name in new[] { "traps", "also" })
        {
            if (card[name] is { } list)
            {
                yield return (string)list["blockId"]!;
            }
        }
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
