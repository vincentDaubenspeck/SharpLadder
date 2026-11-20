using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Problems and drills: root admission of practice/, the exact front matter, the four fields, the
// starter, the per-kind allowlist and what the record derives (speech, slot, suite hash).
public sealed partial class PracticeTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 14, dotnet: 10 }\n---\n\nIntro text.\n";
    private const string ProblemPath = "practice/problems/prob-0001.md";
    private const string ProblemSuite = "practice/problems/prob-0001.tests.cs";
    private const string DrillPath = "practice/drills/drill-a.md";
    private const string DrillSuite = "practice/drills/drill-a.tests.cs";
    private const string IndexPath = PracticeClosure.IndexPath;
    private const string Suite = "using System;\n\nConsole.WriteLine(\"#check pass one\");\n";
    private const string LinkRefused = "links and reparse points are not accepted at or below a root folder";

    private const string ProblemFront = "---\nid: prob-0001\nchapter: ch-test\nnumber: 1\ntitle: Vowel words\n"
        + "patternTags: [pat-a]\nladders: [ladder-a]\ntests:\n  file: prob-0001.tests.cs\n  version: 1\n  count: 2\n"
        + "reference: prob-0001.reference.cs\nparaphraseCheckedAt: 2026-11-01\n---\n";

    private const string DrillFront = "---\nid: drill-a\nchapter: ch-test\nrung: warm-up\ntitle: Count letters\ntype: Count with a loop\nideas: [term-a]\n"
        + "prerequisites: []\nprepares: [prob-0001]\nvariationOf: null\nladders: [ladder-a]\ntests:\n  file: drill-a.tests.cs\n  version: 1\n  count: 1\n"
        + "reference: drill-a.reference.cs\n---\n";

    private const string Statement = "\n## Statement\n\nCount the words that start with a vowel.\n\n- One item.\n- Two items.\n";
    private const string Examples = "\n## Examples\n\n```text {spoken=\"One example\"}\n[apple, pear] gives 1\n```\n";
    private const string Constraints = "\n## Constraints\n\nAt most ten words.\n";

    private static readonly string[] ProblemKeys = ["type", "id", "chapter", "number", "title", "patternTags", "ladders", "statement", "examples", "constraints", "starter", "spoken", "tests"];
    private static readonly string[] DrillKeys = ["type", "id", "chapter", "rung", "title", "move", "ideas", "prerequisites", "prepares", "variationOf", "ladders", "statement", "examples", "constraints", "starter", "spoken", "tests"];
    private static readonly string[] SuiteKeys = ["text", "version", "hash", "count", "review"];
    private static readonly string[] StarterKeys = ["id", "spoken", "source"];

    private static string Problem => ProblemFront + Statement + Examples + Constraints + StarterField("prob-0001");

    private static string Drill => DrillFront + Statement + Examples + Constraints + StarterField("drill-a");

    // A chapter with its hints and drill parts, a glossary entry, the pattern registry, one problem
    // and one drill with their suites, and the index, unless a test replaces or drops one.
    private static (string Path, string? Text)[] Basis =>
    [
        ("chapters/c/chapter.md", Chapter), .. PracticeClosure.Support, (DrillPartPath, DrillPart), (IndexPath, PracticeClosure.Index),
        (ProblemPath, Problem), (ProblemSuite, Suite), (DrillPath, Drill), (DrillSuite, Suite),
    ];

    public static TheoryData<string, string> BodyRefusals() => new()
    {
        { Statement + Examples + StarterField("prob-0001"), "a practice file needs the heading ## Starter" },
        { Statement + Examples + Constraints + "\n## Notes\n\nMore.\n" + StarterField("prob-0001"), "\"## Notes\" is not a practice heading" },
        { Examples + Statement + Constraints + StarterField("prob-0001"), "## Examples is out of order; a practice file holds the headings ## Statement, ## Examples, ## Constraints and ## Starter, in that order" },
        { Statement.Replace("## Statement", "## Statement {#prob-statement}", StringComparison.Ordinal) + Examples + Constraints + StarterField("prob-0001"), "a practice heading takes no {#id}" },
        { Statement.Replace("## Statement", "## Statement {spoken=\"S\"}", StringComparison.Ordinal) + Examples + Constraints + StarterField("prob-0001"), "a practice heading takes no attribute" },
        { Statement + "\n```csharp {#prob-x group=g spoken=\"S\"}\nx();\n```\n" + Examples + Constraints + StarterField("prob-0001"), "a csharp block stands in a practice file only as the starter" },
        { Statement + Examples + Constraints + "\n## Starter\n\nNo code here.\n", "## Starter holds only the starter block" },
        { Statement + Examples + Constraints + "\n## Starter\n", "## Starter holds no starter" },
        { Statement + Examples + Constraints + StarterField("prob-0001") + "\n```csharp {#prob-0001-starter starter spoken=\"S\"}\ny();\n```\n", "## Starter holds a second starter" },
        { Statement + Examples + Constraints + "\n## Starter\n\n```csharp {starter spoken=\"S\"}\nx();\n```\n", "the starter needs the id {#prob-0001-starter}" },
        { Statement + Examples + Constraints + StarterField("prob-0002"), "the starter id is \"prob-0002-starter\"; it must be \"prob-0001-starter\"" },
        { Statement + Examples + Constraints + "\n## Starter\n\n```csharp {#prob-0001-starter starter group=g spoken=\"S\"}\nx();\n```\n", "the starter does not take \"group\"" },
        { Statement + "\n## Examples\n\nProse is no example.\n" + Constraints + StarterField("prob-0001"), "## Examples holds only text blocks" },
    };

    public static TheoryData<string, string, string> FrontRefusals() => new()
    {
        { "  count: 2\n", "  count: 0\n", "tests.count is 0; it must be from 1 to 200" },
        { "  count: 2\n", "  count: 201\n", "tests.count is 201; it must be from 1 to 200" },
        { "  count: 2\n", "  count: 2\n  review:\n    a: { sectionId: sec-a, label: A }\n    b: { sectionId: sec-a, label: B }\n    c: { sectionId: sec-a, label: C }\n", "tests.review has 3 entries; at most tests.count (2) are allowed" },
        { "  file: prob-0001.tests.cs\n", "  file: other.tests.cs\n", "tests.file is \"other.tests.cs\"; it must be \"prob-0001.tests.cs\"" },
        { "reference: prob-0001.reference.cs\n", "reference: prob-0001.cs\n", "reference is \"prob-0001.cs\"; it must be \"prob-0001.reference.cs\"" },
        { "number: 1\n", "number: 1\nlink: https://example.com/fixture-problem-1\n", $"{ProblemPath}:5: front matter: Property 'link' not found" },
        { "paraphraseCheckedAt: 2026-11-01\n", "paraphraseCheckedAt: 2026-13-01\n", "paraphraseCheckedAt is \"2026-13-01\"; write a date as YYYY-MM-DD" },
        { "title: Vowel words\n", "title: Vowel words\nnotes: kept\n", $"{ProblemPath}:6: front matter: Property 'notes' not found" },
        { "  count: 2\n", "  count: 2\n  hash: sha256:00\n", $"{ProblemPath}:12: front matter: Property 'hash' not found" },
    };

    [Fact]
    public void AProblemAndADrillCompileToTheirRecords()
    {
        var result = Run();

        Assert.Empty(result.Diagnostics);
        Assert.Equal(RecordKind.Problem, File(result, "practice/problems/prob-0001.json").Kind);
        Assert.Equal(RecordKind.Drill, File(result, "practice/drills/drill-a.json").Kind);
    }

    // Boundary: authored front matter to public JSON. Each kind's record holds exactly its keys.
    [Fact]
    public void EachKindEmitsExactlyItsOwnKeys()
    {
        var result = Run();
        var problem = Json(result, "practice/problems/prob-0001.json");
        var drill = Json(result, "practice/drills/drill-a.json");

        Assert.Equal(ProblemKeys, Keys(problem), StringComparer.Ordinal);
        Assert.Equal(DrillKeys, Keys(drill), StringComparer.Ordinal);
        Assert.Equal(SuiteKeys, Keys(problem["tests"]!), StringComparer.Ordinal);
        Assert.Equal(StarterKeys, Keys(drill["starter"]!), StringComparer.Ordinal);
        Assert.Null(drill["variationOf"]);
        Assert.Equal("Count with a loop", (string?)drill["move"]);
    }

    [Fact]
    public void ReferenceAndParaphraseDateNeverShip()
    {
        var result = Run();

        foreach (var path in new[] { "practice/problems/prob-0001.json", "practice/drills/drill-a.json" })
        {
            var text = Encoding.UTF8.GetString(File(result, path).Bytes);
            foreach (var hidden in new[] { "reference", "paraphraseCheckedAt", ".reference.cs", "2026-11-01" })
            {
                Assert.DoesNotContain(hidden, text, StringComparison.Ordinal);
            }
        }
    }

    [Fact]
    public void AProblemFieldOnADrillIsRefused() =>
        Refused($"{DrillPath}:5: front matter: Property 'number' not found", (DrillPath, Drill.Replace("rung: warm-up\n", "rung: warm-up\nnumber: 3\n", StringComparison.Ordinal)));

    [Theory]
    [MemberData(nameof(FrontRefusals))]
    public void FrontMatterOutsideItsRulesIsRefused(string from, string to, string expected) =>
        Refused(expected, (ProblemPath, Problem.Replace(from, to, StringComparison.Ordinal)));

    [Fact]
    public void ARungOffTheRampIsRefused() =>
        Refused("rung \"stretch\" is not a ramp rung", (DrillPath, Drill.Replace("rung: warm-up", "rung: stretch", StringComparison.Ordinal)));

    [Theory]
    [InlineData("practice/problems/prob-01", "problem id \"prob-01\" is not prob- and four digits")]
    [InlineData("practice/drills/drill-abcdefghijklmnopqrstuvwxyz012345678", "is not drill- and 1 to 34 lowercase letters, digits and hyphens")]
    public void AnIdOutsideItsFormIsRefused(string stem, string expected)
    {
        var id = Path.GetFileName(stem);
        var text = stem.Contains("/problems/", StringComparison.Ordinal)
            ? Problem.Replace("prob-0001", id, StringComparison.Ordinal)
            : Drill.Replace("drill-a", id, StringComparison.Ordinal);
        Refused(expected, (stem + ".md", text), (stem + ".tests.cs", Suite));
    }

    [Fact]
    public void AnIdOtherThanTheFileNameIsRefused() =>
        Refused("the file is named \"prob-0001.md\" and states the id \"prob-0002\"", (ProblemPath, Problem.Replace("id: prob-0001", "id: prob-0002", StringComparison.Ordinal)));

    [Fact]
    public void TwoProblemsWithOneNumberAreRefused() =>
        Refused("problem number 1 is used twice (first used at", ("practice/problems/prob-0002.md", Problem.Replace("prob-0001", "prob-0002", StringComparison.Ordinal)), ("practice/problems/prob-0002.tests.cs", Suite));

    [Theory]
    [MemberData(nameof(BodyRefusals))]
    public void ABodyOutsideTheFourFieldsIsRefused(string body, string expected) =>
        Refused(expected, (ProblemPath, ProblemFront + body));

    // A list item is spoken on its own, so its refusal names its own line, not the list's.
    [Fact]
    public void ALaterListItemThatCannotBeStoredIsRefusedOnItsOwnLine()
    {
        var result = Run((ProblemPath, Problem.Replace("- Two items.", "- Two a￾b items.", StringComparison.Ordinal)));

        Assert.Equal($"{ProblemPath}:21: spoken text holds a character that cannot be stored (a lone surrogate or a noncharacter)", Assert.Single(result.Diagnostics).ToString());
        Assert.Empty(result.Files);
    }

    [Fact]
    public void AStarterInAChapterFileIsRefused() =>
        Refused("a starter block stands only under ## Starter in a practice file", ("chapters/c/part.md", "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## Title {#syn-a}\n\n```csharp {#syn-a1 group=g starter spoken=\"S\"}\nx();\n```\n"));

    [Theory]
    [InlineData(86, true)]
    [InlineData(87, false)]
    public void ASuiteLineHasAtMost86Characters(int length, bool passes)
    {
        var result = Run((ProblemSuite, Suite + "// " + new string('é', length - 3) + "\n"));

        Assert.Equal(passes, result.Diagnostics.Count == 0);
        Assert.Equal(passes ? string.Empty : $"{ProblemSuite}:4: line is 87 characters; at most 86 are allowed", string.Join('\n', result.Diagnostics.Select(d => d.ToString())));
    }

    [Theory]
    [InlineData(86, true)]
    [InlineData(87, false)]
    public void AStarterLineHasAtMost86Characters(int length, bool passes)
    {
        var line = "// " + new string('x', length - 3);
        var result = Run((DrillPath, Drill.Replace("static int Count", line + "\nstatic int Count", StringComparison.Ordinal)));

        Assert.Equal(passes, result.Diagnostics.Count == 0);
        Assert.Equal(passes ? string.Empty : $"{DrillPath}:39: line is 87 characters; at most 86 are allowed", string.Join('\n', result.Diagnostics.Select(d => d.ToString())));
    }

    // The starter's own checks read only the starter, so a refusal elsewhere in the body leaves
    // its line standing.
    [Fact]
    public void AnEmptyStarterIsReportedBesideAnUnrelatedRefusal()
    {
        var empty = "\n## Starter\n\n```csharp {#prob-0001-starter starter spoken=\"The starting method\"}\n```\n";
        var result = Run((ProblemPath, ProblemFront + Statement + "\n[bad]: https://example.com\n" + Examples + Constraints + empty));

        Assert.Equal(
            [
                $"{ProblemPath}:23: link target \"https://example.com\" is not an internal target; write [text](#id) or [text](ch-chapter#id)",
                $"{ProblemPath}:37: the starter holds no code",
            ],
            result.Diagnostics.Select(d => d.ToString()),
            StringComparer.Ordinal);
        Assert.Empty(result.Files);
    }

    // Boundary: every entry under practice/ is an expected name or a refusal.
    [Theory]
    [InlineData("practice/notes.md", "practice/notes.md: practice/ holds only problems/, drills/ and problems.yml")]
    [InlineData("practice/problems.yaml", "practice/problems.yaml: practice/ holds only problems/, drills/ and problems.yml")]
    [InlineData("practice/problems/readme.txt", "practice/problems/readme.txt: problems/ holds only <id>.md and <id>.tests.cs pairs")]
    [InlineData("practice/drills/drill-b.tests.cs", "practice/drills/drill-b.tests.cs: the suite has no drill-b.md beside it")]
    [InlineData("practice/drills/drill-b.md", "practice/drills/drill-b.md: the practice file has no suite drill-b.tests.cs beside it")]
    public void AnUnexpectedPracticeEntryIsRefused(string path, string expected) =>
        Refused(expected, (path, "x\n"));

    [Fact]
    public void ALinkUnderPracticeIsRefusedAsABoundaryFault()
    {
        using var outside = new TempFolder();
        outside.Write("real/drill-a.md", Drill);
        outside.Write("real/drill-a.tests.cs", Suite);
        using var folder = Tree((DrillPath, null), (DrillSuite, null));
        using var linked = Links.Folder(Path.Combine(folder.Path, "practice", "drills"), Path.Combine(outside.Path, "real"));

        var refusal = Assert.Throws<BoundaryException>(() => Repository.Compile(folder.Path));

        Assert.Contains(LinkRefused, refusal.Message, StringComparison.Ordinal);
    }

    // Statement, Examples and Constraints speak in order; the starter is never spoken.
    [Fact]
    public void SpeechTargetsEveryPracticeBlockInOrder()
    {
        var spoken = Json(Run(), "practice/problems/prob-0001.json")["spoken"]!;
        var segments = spoken["segments"]!.AsArray().Select(s => ((string?)s!["target"]!["type"], (string?)s["target"]!["blockId"], (string?)s["text"])).ToList();

        Assert.Equal(
            new (string?, string?, string?)[]
            {
                ("block", "prob-0001/statement/b1", "Count the words that start with a vowel."),
                ("block", "prob-0001/statement/b2.i1", "One item."),
                ("block", "prob-0001/statement/b2.i2", "Two items."),
                ("block", "prob-0001/examples/b1", "One example"),
                ("block", "prob-0001/constraints/b1", "At most ten words."),
            },
            segments);
    }

    // The shared vectors fix the slot as the SHA-256 of the texts as a compact JSON array; plain ASCII
    // texts need no escaping, so the same rule recomputes the record's slot from its segments.
    [Fact]
    public void SlotIsTheSpeechContractOverTheSegmentTexts()
    {
        var vectors = JsonNode.Parse(System.IO.File.ReadAllBytes(Path.Combine(Repository.Root, "tools", "SharpLadder.Content.Tests", "fixtures", "slot", "vectors.json")))!;
        var twoTexts = vectors["accepted"]!.AsArray().Single(v => string.Equals((string?)v!["name"], "two texts", StringComparison.Ordinal))!;
        Assert.Equal((string?)twoTexts["slot"], Slot(["a", "b"]));

        var spoken = Json(Run(), "practice/drills/drill-a.json")["spoken"]!;
        var texts = spoken["segments"]!.AsArray().Select(s => (string)s!["text"]!).ToList();

        Assert.Equal(Slot(texts), (string?)spoken["audio"]);
    }

    [Fact]
    public void SuiteHashIsRecomputedFromTheEmittedText()
    {
        var tests = Json(Run(), "practice/problems/prob-0001.json")["tests"]!;
        var text = (string)tests["text"]!;

        Assert.Equal(Suite, text);
        Assert.Equal("sha256:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text))), (string?)tests["hash"]);
    }

    private static string StarterField(string id) =>
        $"\n## Starter\n\n```csharp {{#{id}-starter starter spoken=\"The starting method\"}}\nstatic int Count(string[] words) => throw new NotImplementedException();\n```\n";

    private static string Slot(IReadOnlyList<string> texts) =>
        "sha256:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(texts))));

    private static List<string> Keys(JsonNode node) => [.. node.AsObject().Select(p => p.Key)];

    private static OutputFile File(CompileResult result, string path) =>
        result.Files.Single(f => string.Equals(f.RelativePath, path, StringComparison.Ordinal));

    private static JsonNode Json(CompileResult result, string path)
    {
        Assert.Empty(result.Diagnostics);
        return JsonNode.Parse(File(result, path).Bytes)!;
    }

    private static void Refused(string expected, params (string Path, string? Text)[] files)
    {
        var result = Run(files);

        Assert.Contains(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    private static CompileResult Run(params (string Path, string? Text)[] files)
    {
        using var folder = Tree(files);
        return Repository.Compile(folder.Path);
    }

    private static TempFolder Tree(params (string Path, string? Text)[] files)
    {
        var folder = new TempFolder();
        foreach (var (path, text) in Basis.Where(b => !files.Any(f => string.Equals(f.Path, b.Path, StringComparison.Ordinal))).Concat(files))
        {
            if (text is not null)
            {
                folder.Write(path, text);
            }
        }

        return folder;
    }
}
