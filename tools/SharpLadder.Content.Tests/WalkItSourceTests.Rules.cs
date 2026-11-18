using System.Globalization;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <content>The compiler's rules on a read walk-it block: counts, indices, names and hooks.</content>
public sealed partial class WalkItSourceTests
{
    private const string Copy = "{ dst: 2, src: 1, note: Copy. }";
    private const string Hooked = "syn-a/b3";

    // The reader holds each count with one located refusal, so the compiler checks none again.
    [Theory]
    [InlineData("[]", 1, 1, "13: walk-it cells is empty; it holds 1 to 10")]
    [InlineData("[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]", 1, 1, "13: walk-it cells holds more than 10")]
    [InlineData("[0]", 0, 1, "17: walk-it steps is empty; it holds 1 to 8")]
    [InlineData("[0]", 9, 1, "26: walk-it steps holds more than 8")]
    [InlineData("[0]", 1, 0, "14: walk-it sequences is empty; it holds 1 to 4")]
    [InlineData("[0]", 1, 5, "31: walk-it sequences holds more than 4")]
    public void EachCountIsRefusedOnceByTheReader(string cells, int steps, int sequences, string expected) =>
        Assert.Equal(Path + expected, Shown(Run(Counted(cells, steps, sequences))));

    [Fact]
    public void TheSmallestAndLargestCountsAreAccepted()
    {
        var smallest = Block(Counted("[null]", 1, 1));
        var largest = Block(Counted(Ten, 8, 4));

        Assert.Equal("1 1 1", $"{smallest["cells"]!.AsArray().Count} {smallest["sequences"]!.AsArray().Count} {smallest["sequences"]![0]!["steps"]!.AsArray().Count}");
        Assert.Equal("10 4 8 8 8 8", $"{largest["cells"]!.AsArray().Count} {largest["sequences"]!.AsArray().Count} " + string.Join(' ', largest["sequences"]!.AsArray().Select(s => s!["steps"]!.AsArray().Count)));
    }

    [Theory]
    [InlineData("[4, \"ab\", null]", "{ dst: 3, src: 1, note: Copy. }", "18: walk-it dst 3 is outside the cells, 0 to 2")]
    [InlineData("[4, \"ab\", null]", "{ dst: 2, src: 9, note: Copy. }", "18: walk-it src 9 is outside the cells, 0 to 2")]
    [InlineData("[4]", "{ dst: 1, value: 1, note: Write. }", "18: walk-it dst 1 is outside the cells, 0 to 0")]
    [InlineData("[0, 1, 2, 3, 4, 5, 6, 7, 8]", "{ dst: 9, src: 0, note: Copy. }", "18: walk-it dst 9 is outside the cells, 0 to 8")]
    public void AnIndexIsBelowTheCellCount(string cells, string step, string expected) =>
        Assert.Equal(Path + expected, Shown(Run(Walk(cells: cells, step: step))));

    [Theory]
    [InlineData("[4]", "{ dst: 0, value: 1, note: Write. }", 0, null)]
    [InlineData("[4, 5]", "{ dst: 1, src: 0, note: Copy. }", 1, 0)]
    [InlineData("[4, 5]", "{ dst: 0, src: 1, note: Copy. }", 0, 1)]
    public void TheLastCellIsAnIndex(string cells, string step, int dst, int? src)
    {
        var compiled = Block(Walk(cells: cells, step: step))["sequences"]![0]!["steps"]![0]!;

        Assert.Equal(dst, (int)compiled["dst"]!);
        Assert.Equal(src, (int?)compiled["src"]);
    }

    [Theory]
    [InlineData("{ dst: 1, src: 1, note: Copy. }", 1)]
    [InlineData("{ dst: 0, src: -0, note: Copy. }", 0)]
    public void AStepNeverCopiesACellOntoItself(string step, int cell) =>
        Assert.Equal(Path + "18: " + SelfCopy(cell), Shown(Run(Walk(step: step))));

    // The self-copy is still replayed: it writes T2, the starting null, back into cell 2 marked lost, so (a) too.
    [Fact]
    public void ASelfCopyMarkedLostOntoNullIsAlsoRefusedUnderA() =>
        Assert.Equal(Path + "18: " + SelfCopy(2) + "\n" + NullLoss(18, 2), Shown(Run(Walk(step: "{ dst: 2, src: 2, note: Copy., lost: true }"))));

    [Fact]
    public void EachProblemOfOneStepIsItsOwnRefusal() =>
        Assert.Equal(
            string.Join('\n', Path + "18: walk-it dst 5 is outside the cells, 0 to 2", Path + "18: walk-it src 5 is outside the cells, 0 to 2", Path + "18: " + SelfCopy(5)),
            Shown(Run(Walk(step: "{ dst: 5, src: 5, note: Copy. }"))));

    [Theory]
    [InlineData("\"a\\nb\"", "\"a\\nb\" holds a line break or a character that cannot be shown; write it on one line")]
    [InlineData("\"a\\Lb\"", "\"a\\u2028b\" holds a line break or a character that cannot be shown; write it on one line")]
    [InlineData("|\n      safe", "\"safe\\n\" holds a line break or a character that cannot be shown; write it on one line")]
    [InlineData("\" \"", "\" \" is blank; write a name that shows")]
    [InlineData("\"\\u00A0\\u3000\"", "\"\\u00A0\\u3000\" is blank; write a name that shows")]
    [InlineData("\"\\uFEFF\"", "\"\\uFEFF\" is blank; write a name that shows")]
    public void ASequenceNameIsOneLineThatShows(string name, string expected) =>
        Assert.Equal(Path + "15: walk-it sequence name " + expected, Shown(Run(Walk().Replace("name: safe", "name: " + name, StringComparison.Ordinal))));

    [Theory]
    [InlineData("'*not* emphasis'", "*not* emphasis")]
    [InlineData(">-\n      folded\n      name", "folded name")]
    public void ANameIsKeptAsWritten(string name, string expected) =>
        Assert.Equal(expected, (string?)Block(Walk().Replace("name: safe", "name: " + name, StringComparison.Ordinal))["sequences"]![0]!["name"]);

    [Fact]
    public void ASequenceNameIsUniqueInTheBlock()
    {
        const string Twice = "walk-it sequence name \"safe\" is already the name of sequence 1; names are unique in the block";

        Assert.Equal(Path + "22: " + Twice + "\n" + Path + "25: " + Twice, Shown(Run(Walk(more: Sequence("other") + Sequence("safe") + Sequence("safe")))));
    }

    // Names compare as exact text, so a difference in case, spacing or composition is another name.
    [Theory]
    [InlineData("safe", "Safe")]
    [InlineData("safe", "\"safe \"")]
    [InlineData("\"\\u00E9\"", "\"e\\u0301\"")]
    public void NamesCompareAsExactText(string first, string second)
    {
        var block = Block(Walk(more: Sequence(second)).Replace("name: safe", "name: " + first, StringComparison.Ordinal));

        Assert.Equal(2, block["sequences"]!.AsArray().Select(s => (string?)s!["name"]).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void EachHookIsIssuedForItsOwnBlockAndSequence()
    {
        const string Second = "  - name: wrong\n    intro: Write first.\n    steps:\n      - { dst: 1, value: 7, note: Write. }\n      - { dst: 0, src: 1, note: Copy. }\n";
        var walk = Walk(more: Second + Sequence("third"));

        var record = Record(Chapter + Fence(walk, "walk-it {#walk-one}") + "\nBetween.\n\n" + Fence(walk, "walk-it {#walk-two}"));

        var hooks = record["intro"]!.AsArray()
            .Where(b => string.Equals((string?)b!["type"], "walk-it", StringComparison.Ordinal))
            .Select(b => (string?)b!["blockId"] + ": " + string.Join(" | ", b!["sequences"]!.AsArray().Select(s => (string?)s!["introBlockId"] + " " + string.Join(' ', s["steps"]!.AsArray().Select(t => (string?)t!["blockId"])))));
        Assert.Equal(
            "intro/b2: intro/b2.1.s0 intro/b2.1.s1 | intro/b2.2.s0 intro/b2.2.s1 intro/b2.2.s2 | intro/b2.3.s0 intro/b2.3.s1\n"
            + "intro/b4: intro/b4.1.s0 intro/b4.1.s1 | intro/b4.2.s0 intro/b4.2.s1 intro/b4.2.s2 | intro/b4.3.s0 intro/b4.3.s1",
            string.Join('\n', hooks));
    }

    // A hand-built node exercises an internal postcondition that no source text can reach.
    [Fact]
    public void AHookIsQualifiedByItsSectionAndBlock()
    {
        Assert.Equal("syn-a/b3.2.s0", WalkItHooks.Intro(Hooked, 2));
        Assert.Equal("syn-a/b3.4.s8", WalkItHooks.Step(Hooked, 4, 8));
        Assert.Null(WalkItHooks.Misplaced(Hooks(Own()), Hooked));
    }

    // A hand-built node exercises an internal postcondition that no source text can reach.
    // Each case moves one hook from another section, block, sequence or step, or from another field.
    [Theory]
    [InlineData(0, 0, "syn-b/b3.1.s0")]
    [InlineData(0, 0, "syn-a/b2.1.s0")]
    [InlineData(1, 0, "syn-a/b3.1.s0")]
    [InlineData(0, 2, "syn-a/b3.1.s1")]
    [InlineData(0, 1, "syn-a/b3.1.s0")]
    public void AHookFromAnotherPositionOrFieldIsRefused(int sequence, int position, string hook)
    {
        var hooks = Own();
        var own = hooks[sequence][position];
        hooks[sequence][position] = hook;

        Assert.Equal($"walk-it hook \"{hook}\" is not the one its position issues, \"{own}\"", WalkItHooks.Misplaced(Hooks(hooks), Hooked));
    }

    // A hand-built node exercises an internal postcondition that no source text can reach.
    [Fact]
    public void ABlockIdFromAnotherPositionIsRefused() =>
        Assert.Equal("walk-it block id \"syn-a/b2\" is not the one its position issues, \"syn-a/b3\"", WalkItHooks.Misplaced(Hooks(Own(), "syn-a/b2"), Hooked));

    [Theory]
    [InlineData("title/0/blockId", "intro/b2.1.s0")]
    public void TheSchemaRefusesAHookInAnyOtherField(string path, string hook)
    {
        var record = Record(Chapter + Fence(Accepted));
        var node = record["intro"]![1]!;
        var names = path.Split('/');
        foreach (var name in names[..^1])
        {
            node = int.TryParse(name, NumberStyles.None, CultureInfo.InvariantCulture, out var index) ? node[index]! : node[name]!;
        }

        node[names[^1]] = hook;

        Assert.NotNull(Repository.Schema.Validate(record.ToJsonString()));
    }

    [Theory]
    [InlineData("{ dst: 2, src: 1, note: Copy., blockId: intro/b2.1.s1 }", "", "18: unknown key \"blockId\" in a walk-it step; its keys are dst, src, value, note, lost")]
    [InlineData(Copy, "    introBlockId: intro/b2.1.s0\n", "19: unknown key \"introBlockId\" in a walk-it sequence; its keys are name, intro, steps")]
    [InlineData(Copy, "blockId: intro/b2\n", "19: unknown key \"blockId\" in the walk-it block; its keys are title, cells, sequences")]
    public void AHookIsNeverWrittenInSource(string step, string more, string expected) =>
        Assert.Equal(Path + expected, Shown(Run(Walk(step: step, more: more))));

    [Fact]
    public void AHookWrittenAsAnAttributeInTextIsRefused()
    {
        var result = Run(Walk(step: "{ dst: 2, src: 1, note: \"Copy. {data-block-id=intro/b2.1.s1}\" }"));

        Assert.StartsWith(Path + "18: ", Assert.Single(result.Diagnostics).ToString(), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    [Fact]
    public void AHookShapedNameStaysAName()
    {
        var sequence = Block(Walk().Replace("name: safe", "name: intro/b2.2.s0", StringComparison.Ordinal))["sequences"]![0]!;

        Assert.Equal("intro/b2.2.s0 intro/b2.1.s0", (string?)sequence["name"] + " " + (string?)sequence["introBlockId"]);
    }

    // Sequence s starts on line 15 + (s - 1) * (3 + steps), its steps on the lines after its steps key.
    private static string Counted(string cells, int steps, int sequences)
    {
        var items = steps == 0 ? " []" : string.Concat(Enumerable.Repeat("\n      - { dst: 0, value: 1, note: N. }", steps));
        var list = sequences == 0 ? " []" : string.Concat(Enumerable.Range(1, sequences).Select(s => $"\n  - name: s{s}\n    intro: I.\n    steps:{items}"));
        return $"title: T\ncells: {cells}\nsequences:{list}";
    }

    private static string Sequence(string name) => $"  - name: {name}\n    intro: More.\n    steps: [{Copy}]\n";

    private static string SelfCopy(int cell) =>
        string.Create(CultureInfo.InvariantCulture, $"a walk-it step copies cell {cell} onto itself; src and dst name different cells");

    private static string[][] Own() =>
        [["syn-a/b3.1.s0", "syn-a/b3.1.s1", "syn-a/b3.1.s2"], ["syn-a/b3.2.s0", "syn-a/b3.2.s1"]];

    // Each row is one sequence: its intro hook, then its step hooks.
    private static WalkItNode Hooks(string[][] hooks, string blockId = Hooked) => new()
    {
        BlockId = blockId,
        Id = "walk-shift",
        Title = [],
        Cells = [0L, 1L],
        Sequences = [.. hooks.Select(HookedSequence)],
    };

    private static WalkSequence HookedSequence(string[] row, int position) => new()
    {
        Name = position == 0 ? "one" : "two",
        IntroBlockId = row[0],
        Intro = [],
        Steps = [.. row.Skip(1).Select(hook => new WalkStep { BlockId = hook, Dst = 1, Src = 0, Note = [] })],
    };
}
