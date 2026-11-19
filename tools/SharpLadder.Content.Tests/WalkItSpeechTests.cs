using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <summary>
/// Walk-it speech, read back from real source compiled under the admitted schema: the title, then
/// each sequence's intro and notes as written, each on the hook of its own field, in every host
/// that speaks. The record holds every step whichever one is shown.
/// </summary>
public sealed class WalkItSpeechTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 14, dotnet: 10 }\n---\n\nIntro text.\n";
    private const string SyntaxHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n";
    private const string BuildHead = "---\nkind: build\nchapter: ch-test\norder: 1\n---\n\n## Build {#build-a}\n\n";
    private const string CardsHead = "---\nkind: cards\nchapter: ch-test\norder: 1\n---\n\n## Cards {#cards-a}\n\n";
    private const string DrillHead = "---\nkind: drill\nchapter: ch-test\norder: 2\n---\n\n";
    private const string ChapterPath = "chapters/c/chapter.md";
    private const string PartPath = "chapters/c/part.md";
    private const string PartJson = "chapters/c/part.json";
    private const string EmptyText = "spoken text is empty";
    private const string CannotStore = "spoken text holds a character that cannot be stored (a lone surrogate or a noncharacter)";

    // Sequences of different lengths, up to the most steps one may hold, so a hook or a text out of
    // place in any of them shows.
    private const string ThreeWays = """
        title: Three *ways* to move
        cells: [1, 2, 3]
        sequences:
            -   name: one
                intro: One step.
                steps:
                    - { dst: 0, src: 1, note: Copy b to a. }
            -   name: three
                intro: Three steps.
                steps:
                    - { dst: 2, value: 7, note: Write seven. }
                    - { dst: 1, src: 2, note: Copy c to b. }
                    - { dst: 0, value: 9, note: Write nine. }
            -   name: eight
                intro: Eight steps.
                steps:
                    - { dst: 0, value: 10, note: Ten goes to a. }
                    - { dst: 1, value: 11, note: Eleven goes to b. }
                    - { dst: 2, value: 12, note: Twelve goes to c. }
                    - { dst: 0, src: 2, note: c is copied to a. }
                    - { dst: 1, value: 13, note: Thirteen goes to b. }
                    - { dst: 2, src: 1, note: b is copied to c. }
                    - { dst: 1, value: 14, note: Fourteen goes to b. }
                    - { dst: 0, src: 1, note: b is copied to a. }
        """;

    private const string Swap = """
        title: Swap
        cells: ["x", "y", null]
        sequences:
            -   name: swap
                intro: Use the spare cell.
                steps:
                    - { dst: 2, src: 0, note: Save x. }
                    - { dst: 0, src: 1, note: Move y. }
                    - { dst: 1, src: 2, note: Restore x. }
        """;

    // YAML escapes write the decomposed text, which an editor would otherwise compose on save.
    private const string Inline = """
        title: "Shift *right* and **left** `x` &amp; caf*e*\u0301"
        cells: [1, 2]
        sequences:
            -   name: only
                intro: "See [the first part](#syn-a) first"
                steps:
                    -   dst: 0
                        src: 1
                        note: "Two  spaces and a `  code  ` span"
                    -   dst: 1
                        value: 5
                        note: "cafe\u0301 decomposed"
        """;

    private static readonly string Sites = SyntaxHead
        + "## First {#syn-a}\n\nBefore the walk.\n\n" + Fence("walk-three", ThreeWays) + "\nAfter the walk.\n\n"
        + "## Second {#syn-b}\n\nLead in.\n\n- first item\n- second item\n\nBefore the next walk.\n\n" + Fence("walk-one", Swap) + "\nClosing words.\n";

    private static readonly string[] FirstSection =
    [
        "syn-a/b1 = Before the walk.",
        "syn-a/b2 = Three ways to move",
        "syn-a/b2.1.s0 = One step.",
        "syn-a/b2.1.s1 = Copy b to a.",
        "syn-a/b2.2.s0 = Three steps.",
        "syn-a/b2.2.s1 = Write seven.",
        "syn-a/b2.2.s2 = Copy c to b.",
        "syn-a/b2.2.s3 = Write nine.",
        "syn-a/b2.3.s0 = Eight steps.",
        "syn-a/b2.3.s1 = Ten goes to a.",
        "syn-a/b2.3.s2 = Eleven goes to b.",
        "syn-a/b2.3.s3 = Twelve goes to c.",
        "syn-a/b2.3.s4 = c is copied to a.",
        "syn-a/b2.3.s5 = Thirteen goes to b.",
        "syn-a/b2.3.s6 = b is copied to c.",
        "syn-a/b2.3.s7 = Fourteen goes to b.",
        "syn-a/b2.3.s8 = b is copied to a.",
        "syn-a/b3 = After the walk.",
    ];

    private static readonly string[] SecondSection =
    [
        "syn-b/b1 = Lead in.",
        "syn-b/b2.i1 = first item",
        "syn-b/b2.i2 = second item",
        "syn-b/b3 = Before the next walk.",
        "syn-b/b4 = Swap",
        "syn-b/b4.1.s0 = Use the spare cell.",
        "syn-b/b4.1.s1 = Save x.",
        "syn-b/b4.1.s2 = Move y.",
        "syn-b/b4.1.s3 = Restore x.",
        "syn-b/b5 = Closing words.",
    ];

    [Fact]
    public void PartSectionsSpeakEveryWalkFieldOnItsOwnHookInReadingOrder()
    {
        var sections = Record(Accepted((PartPath, Sites)), PartJson)["sections"]!.AsArray();

        Assert.Equal(
            [
                "syn-a/b2: syn-a/b2.1.s0 syn-a/b2.1.s1 | syn-a/b2.2.s0 syn-a/b2.2.s1 syn-a/b2.2.s2 syn-a/b2.2.s3 | syn-a/b2.3.s0 syn-a/b2.3.s1 syn-a/b2.3.s2 syn-a/b2.3.s3 syn-a/b2.3.s4 syn-a/b2.3.s5 syn-a/b2.3.s6 syn-a/b2.3.s7 syn-a/b2.3.s8",
                "syn-b/b4: syn-b/b4.1.s0 syn-b/b4.1.s1 syn-b/b4.1.s2 syn-b/b4.1.s3",
            ],
            sections.SelectMany(s => Walks(s!["body"]!)).Select(Hooks),
            StringComparer.Ordinal);
        Assert.Equal(FirstSection, Pairs(sections[0]!["spoken"]!), StringComparer.Ordinal);
        Assert.Equal(SecondSection, Pairs(sections[1]!["spoken"]!), StringComparer.Ordinal);
    }

    // The targets are read from the compiled block's own fields and the texts are keyed by the
    // sequence name, so a text spoken on another field's or another sequence's hook fails.
    [Fact]
    public void EachWalkTextIsSpokenOnTheHookItsOwnFieldCarries()
    {
        var authored = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["one"] = ["One step.", "Copy b to a."],
            ["three"] = ["Three steps.", "Write seven.", "Copy c to b.", "Write nine."],
            ["eight"] = ["Eight steps.", "Ten goes to a.", "Eleven goes to b.", "Twelve goes to c.", "c is copied to a.", "Thirteen goes to b.", "b is copied to c.", "Fourteen goes to b.", "b is copied to a."],
            ["swap"] = ["Use the spare cell.", "Save x.", "Move y.", "Restore x."],
        };
        var titles = new Dictionary<string, string>(StringComparer.Ordinal) { ["walk-three"] = "Three ways to move", ["walk-one"] = "Swap" };
        var checkedBlocks = 0;

        foreach (var section in Record(Accepted((PartPath, Sites)), PartJson)["sections"]!.AsArray())
        {
            var spoken = Pairs(section!["spoken"]!).ToList();
            foreach (var block in Walks(section["body"]!))
            {
                var own = (string)block["blockId"]!;
                var expected = new List<string> { own + " = " + titles[(string)block["id"]!] };
                foreach (var sequence in block["sequences"]!.AsArray())
                {
                    var texts = authored[(string)sequence!["name"]!];
                    var hooks = sequence["steps"]!.AsArray().Select(t => (string)t!["blockId"]!).Prepend((string)sequence["introBlockId"]!).ToList();
                    Assert.Equal(texts.Length, hooks.Count);
                    expected.AddRange(hooks.Zip(texts, (hook, text) => hook + " = " + text));
                }

                Assert.Equal(expected, spoken.Where(p => p.StartsWith(own + " ", StringComparison.Ordinal) || p.StartsWith(own + ".", StringComparison.Ordinal)), StringComparer.Ordinal);
                checkedBlocks++;
            }
        }

        Assert.Equal(2, checkedBlocks);
    }

    [Fact]
    public void MovingAWalkChangesItsTargetsButNotItsTexts()
    {
        var alone = Record(Accepted((PartPath, SyntaxHead + "## First {#syn-a}\n\n" + Fence("walk-one", Swap))), PartJson)["sections"]![0]!["spoken"]!;
        var moved = Record(Accepted((PartPath, SyntaxHead + "## Other {#syn-z}\n\nOne.\n\nTwo.\n\n" + Fence("walk-one", Swap))), PartJson)["sections"]![0]!["spoken"]!;

        Assert.Equal(
            ["syn-a/b1 = Swap", "syn-a/b1.1.s0 = Use the spare cell.", "syn-a/b1.1.s1 = Save x.", "syn-a/b1.1.s2 = Move y.", "syn-a/b1.1.s3 = Restore x."],
            Pairs(alone),
            StringComparer.Ordinal);
        Assert.Equal(
            ["syn-z/b1 = One.", "syn-z/b2 = Two.", "syn-z/b3 = Swap", "syn-z/b3.1.s0 = Use the spare cell.", "syn-z/b3.1.s1 = Save x.", "syn-z/b3.1.s2 = Move y.", "syn-z/b3.1.s3 = Restore x."],
            Pairs(moved),
            StringComparer.Ordinal);
        Assert.Equal("sha256:768ffaf1b02c3b9a3e681d957ca81d09f5e0a563f0e999020b8784bd3a9162b1", (string?)alone["audio"]);
    }

    [Fact]
    public void WalkTextIsFlattenedWithNothingAddedAndStoredComposed()
    {
        var decomposed = Speech((PartPath, SyntaxHead + "## First {#syn-a}\n\n" + Fence("walk-inline", Inline)), PartJson);
        var composed = Speech((PartPath, SyntaxHead + "## First {#syn-a}\n\n" + Fence("walk-inline", Inline.Replace("caf*e*\\u0301", "caf\\u00e9", StringComparison.Ordinal).Replace("cafe\\u0301", "caf\\u00e9", StringComparison.Ordinal))), PartJson);

        string[] expected =
        [
            "syn-a/b1 = Shift right and left x & caf\u00e9",
            "syn-a/b1.1.s0 = See the first part first",
            "syn-a/b1.1.s1 = Two  spaces and a  code  span",
            "syn-a/b1.1.s2 = caf\u00e9 decomposed",
        ];
        Assert.Equal(expected, Pairs(decomposed), StringComparer.Ordinal);
        Assert.Equal(expected, Pairs(composed), StringComparer.Ordinal);
        Assert.Equal((string?)composed["audio"], (string?)decomposed["audio"]);
    }

    // Worked out apart from the compiler: SHA-256 over the UTF-8 JSON array of each section's texts
    // above, with no BOM and no final newline.
    [Fact]
    public void EachSectionSlotIsTheHashOfItsCompleteSpeech()
    {
        var sections = Record(Accepted((PartPath, Sites)), PartJson)["sections"]!;

        Assert.Equal("sha256:7e9356da6d015ca6dd22f32b229166a803c81f992ea1b3ca680980e8c9830cce", (string?)sections[0]!["spoken"]!["audio"]);
        Assert.Equal("sha256:496fe6d7bce20cd1935201a95eaf57a3fc00962a0d2c8c9704cbd6c992db8490", (string?)sections[1]!["spoken"]!["audio"]);
    }

    [Fact]
    public void APartWithWalksCompilesToTheSameFilesTwice()
    {
        var first = Accepted((PartPath, Sites));
        var second = Accepted((PartPath, Sites));

        Assert.Equal(Listed(first), Listed(second), StringComparer.Ordinal);

        static string Listed(CompileResult result) => string.Join('\n', result.Files.Select(f => f.RelativePath + " " + Convert.ToBase64String(f.Bytes)));
    }

    [Fact]
    public void AnApproachLabelJoinsOnlyTheTitleOfTheWalkThatOpensIt()
    {
        var part = BuildHead + "Lead.\n\n"
            + "### First way {#build-one approach=\"one\"}\n\n" + Fence("walk-plan-a", Mini("Plan A", "Intro A.", "Note A.")) + "\nMiddle.\n\n" + Fence("walk-plan-b", Mini("Plan B", "Intro B.", "Note B."))
            + "\n### Second way {#build-two approach=\"two\"}\n\nTwo text.\n\n" + Fence("walk-plan-c", Mini("Plan C", "Intro C.", "Note C."));

        Assert.Equal(
            [
                "build-a/b1 = Lead.",
                "build-a/b2 = Approach: one. Plan A",
                "build-a/b2.1.s0 = Intro A.",
                "build-a/b2.1.s1 = Note A.",
                "build-a/b3 = Middle.",
                "build-a/b4 = Plan B",
                "build-a/b4.1.s0 = Intro B.",
                "build-a/b4.1.s1 = Note B.",
                "build-a/b5 = Approach: two. Two text.",
                "build-a/b6 = Plan C",
                "build-a/b6.1.s0 = Intro C.",
                "build-a/b6.1.s1 = Note C.",
            ],
            Pairs(Speech((PartPath, part), PartJson)),
            StringComparer.Ordinal);
    }

    [Fact]
    public void ACardWhyLabelJoinsOnlyTheTitleOfTheWalkThatOpensIt()
    {
        var part = CardsHead + "### One {#card-one}\n\n- reach: R.\n- build: B.\n- why:\n\n" + Fence("walk-why", Mini("Plan W", "Intro W.", "Note W."), "  ")
            + "\n  More.\n- traps:\n  - T1.\n\n### Two {#card-two}\n\n- reach: R.\n- build: B.\n- why: W.\n";

        Assert.Equal(
            [
                "cards-a/b1 = Card: One. Reach for: R.",
                "cards-a/b2 = Build: B.",
                "cards-a/b3 = Why: Plan W",
                "cards-a/b3.1.s0 = Intro W.",
                "cards-a/b3.1.s1 = Note W.",
                "cards-a/b4 = More.",
                "cards-a/b5.i1 = Traps: T1.",
                "cards-a/b6 = Card: Two. Reach for: R.",
                "cards-a/b7 = Build: B.",
                "cards-a/b8 = Why: W.",
            ],
            Pairs(Speech((PartPath, part), PartJson)),
            StringComparer.Ordinal);
    }

    // The approach rule refuses one with nothing spoken; a walk-it alone is spoken.
    [Fact]
    public void AnApproachHoldingOnlyAWalkSpeaks()
    {
        var part = BuildHead + "### First way {#build-one approach=\"one\"}\n\n" + Fence("walk-only", Mini("Plan", "Intro.", "Note."))
            + "\n### Second way {#build-two approach=\"two\"}\n\nTwo text.\n";

        Assert.Equal(
            ["build-a/b1 = Approach: one. Plan", "build-a/b1.1.s0 = Intro.", "build-a/b1.1.s1 = Note.", "build-a/b2 = Approach: two. Two text."],
            Pairs(Speech((PartPath, part), PartJson)),
            StringComparer.Ordinal);
    }

    [Fact]
    public void AChapterSectionSpeaksAWalk() =>
        Assert.Equal(
            ["ch-sec/b1 = Plan", "ch-sec/b1.1.s0 = Intro.", "ch-sec/b1.1.s1 = Note."],
            Pairs(Speech((ChapterPath, Chapter + "\n## Heading {#ch-sec}\n\n" + Fence("walk-ch", Mini("Plan", "Intro.", "Note."))), "chapters/c/chapter.json")),
            StringComparer.Ordinal);

    [Fact]
    public void ABuildSectionWithoutApproachesSpeaksAWalk() =>
        Assert.Equal(
            ["build-a/b1 = Plan", "build-a/b1.1.s0 = Intro.", "build-a/b1.1.s1 = Note."],
            Pairs(Speech((PartPath, BuildHead + Fence("walk-build", Mini("Plan", "Intro.", "Note."))), PartJson)),
            StringComparer.Ordinal);

    [Fact]
    public void ADrillSectionSpeaksAWalk()
    {
        var drill = DrillHead + "## One idea {#ramp-warm rung=warm-up}\n\nEach drill uses one idea.\n\n" + Fence("walk-drill", Mini("Plan", "Intro.", "Note.")) + "\n1. [Count the letters](#drill-count)\n";

        Assert.Equal(
            ["ramp-warm/b1 = Each drill uses one idea.", "ramp-warm/b2 = Plan", "ramp-warm/b2.1.s0 = Intro.", "ramp-warm/b2.1.s1 = Note.", "ramp-warm/b3.i1 = Count the letters"],
            Pairs(Record(Accepted([("chapters/c/drill.md", drill), .. PracticeClosure.WithProblem, .. PracticeClosure.Drill("drill-count", "warm-up")]), "chapters/c/drill.json")["sections"]![0]!["spoken"]!),
            StringComparer.Ordinal);
    }

    [Fact]
    public void AWalkInTheChapterIntroIsNeverSpoken()
    {
        var chapter = Record(Accepted((ChapterPath, Chapter + "\n" + Fence("walk-intro", Mini("Plan", "Intro.", "Note.")) + "\n## Heading {#ch-sec}\n\nBody words.\n")), "chapters/c/chapter.json");

        Assert.Equal("walk-it", (string?)chapter["intro"]![1]!["type"]);
        Assert.Null(chapter["spoken"]);
        Assert.Equal(["ch-sec/b1 = Body words."], Pairs(chapter["sections"]![0]!["spoken"]!), StringComparer.Ordinal);
    }

    [Fact]
    public void ASkippedSectionKeepsOnlyItsSummaryAndSectionTarget()
    {
        var section = Record(Accepted((PartPath, SyntaxHead + "## Title {#syn-s speech=skip spoken=\"The summary.\"}\n\n" + Fence("walk-skip", Mini("Plan", "Intro.", "Note.")) + "\nShown.\n")), PartJson)["sections"]![0]!;

        Assert.Equal(["walk-it", "paragraph"], section["body"]!.AsArray().Select(b => (string?)b!["type"]), StringComparer.Ordinal);
        Assert.Equal("""[{"target":{"type":"section","sectionId":"syn-s"},"text":"The summary."}]""", section["spoken"]!["segments"]!.ToJsonString());
        Assert.Equal("sha256:f5377445c0ce0b33152cb7a09e6eb101c58865af631d8e878ad514b1922ed29a", (string?)section["spoken"]!["audio"]);
    }

    [Fact]
    public void GlossaryAndErrorRecordsStaySpeechless()
    {
        var walk = Mini("Plan", "Intro.", "Note.");
        var result = Accepted(
            ("glossary/term-a.md", "---\nid: term-a\nterm: A term\nshort: What it means.\n---\n\n" + Fence("walk-term", walk)),
            ("errors/err-a.md", "---\nid: err-a\nkind: compiler\ncode: CS0001\nwrote: A thing\ngot: A message\n---\n\n- cause:\n\n" + Fence("walk-err", walk, "  ") + "- hint: Two.\n"));
        var term = Record(result, "glossary/term-a.json");
        var error = Record(result, "errors/err-a.json");

        Assert.Equal("walk-it", (string?)term["body"]![0]!["type"]);
        Assert.Equal("walk-it", (string?)error["cause"]![0]!["type"]);
        Assert.DoesNotContain("spoken", term.ToJsonString(), StringComparison.Ordinal);
        Assert.DoesNotContain("spoken", error.ToJsonString(), StringComparison.Ordinal);
    }

    // The same block in the chapter intro, where nothing is spoken, compiles, so each refusal is
    // speech's own and not an earlier YAML or Markdown one.
    [Theory]
    [InlineData("title", "\"&#32;\"", EmptyText)]
    [InlineData("note", "\"&#32;\"", EmptyText)]
    [InlineData("intro", "\"\\uFDD0\"", CannotStore)]
    public void UnspeakableWalkTextIsRefusedAtTheBlockLine(string field, string value, string problem)
    {
        var walk = Fence("walk-bad", Mini(Pick("title", "Plan"), Pick("intro", "Intro."), Pick("note", "Note.")));

        Assert.Equal(string.Empty, Shown(Compile((ChapterPath, Chapter + "\n" + walk))));
        var result = Compile((PartPath, SyntaxHead + "## Title {#syn-a}\n\n" + walk));
        Assert.Equal(PartPath + ":9: " + problem, Shown(result));
        Assert.Empty(result.Files);

        string Pick(string name, string otherwise) => string.Equals(name, field, StringComparison.Ordinal) ? value : otherwise;
    }

    [Fact]
    public void UnspeakableWalkTextInACardIsRefusedAtTheCardLine()
    {
        var result = Compile((PartPath, CardsHead + "### One {#card-one}\n\n- reach: R.\n- build: B.\n- why:\n\n" + Fence("walk-bad", Mini("\"&#32;\"", "Intro.", "Note."), "  ")));

        Assert.Equal(PartPath + ":9: " + EmptyText, Shown(result));
        Assert.Empty(result.Files);
    }

    private static string Mini(string title, string intro, string note) =>
        "title: " + title + "\ncells: [1, 2]\nsequences:\n  - name: only\n    intro: " + intro + "\n    steps:\n      - { dst: 0, src: 1, note: " + note + " }\n";

    private static string Fence(string id, string document, string indent = "") =>
        string.Concat(("```walk-it {#" + id + "}\n" + document.TrimEnd('\n') + "\n```").Split('\n').Select(line => indent + line + "\n"));

    private static IEnumerable<JsonNode> Walks(JsonNode body) =>
        body.AsArray().Where(b => string.Equals((string?)b!["type"], "walk-it", StringComparison.Ordinal)).Select(b => b!);

    private static string Hooks(JsonNode block) =>
        (string?)block["blockId"] + ": " + string.Join(" | ", block["sequences"]!.AsArray().Select(s => (string?)s!["introBlockId"] + " " + string.Join(' ', s["steps"]!.AsArray().Select(t => (string?)t!["blockId"]))));

    private static IEnumerable<string> Pairs(JsonNode speech) =>
        speech["segments"]!.AsArray().Select(s => Target(s!["target"]!) + " = " + (string?)s["text"]);

    private static string Target(JsonNode target) =>
        string.Equals((string?)target["type"], "block", StringComparison.Ordinal) ? (string)target["blockId"]! : "section " + (string?)target["sectionId"];

    private static JsonNode Speech((string Path, string Text) file, string output) =>
        Record(Accepted(file), output)["sections"]![0]!["spoken"]!;

    private static CompileResult Accepted(params (string Path, string Text)[] files)
    {
        var result = Compile(files);
        Assert.Equal(string.Empty, Shown(result));
        return result;
    }

    // The compiled record passes the schema in the compiler; it is checked again here so a test
    // never rests on the compiler having called the check.
    private static JsonNode Record(CompileResult result, string path)
    {
        var record = JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, path, StringComparison.Ordinal)).Bytes)!;
        Assert.Null(Repository.Schema.Validate(record.ToJsonString()));
        return record;
    }

    // A chapter, a plain part and empty registries stand beside the files under test.
    private static CompileResult Compile(params (string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        (string Path, string Text)[] basis =
        [
            (ChapterPath, Chapter),
            (PartPath, SyntaxHead + "## Plain {#syn-p}\n\nText.\n"),
            ("aliases.yml", "slugs: {}\nids: {}\n"),
            ("patterns.yml", "patterns: []\n"),
        ];
        foreach (var (path, text) in basis.Where(b => !files.Any(f => string.Equals(f.Path, b.Path, StringComparison.Ordinal))).Concat(files))
        {
            folder.Write(path, text);
        }

        return ContentCompiler.Compile(folder.Path, Repository.Schema, folder.Path);
    }

    private static string Shown(CompileResult result) => string.Join('\n', result.Diagnostics.Select(d => d.ToString()));
}
