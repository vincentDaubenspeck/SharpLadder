using System.Globalization;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <content>The lost rule decided by replaying tokens, proven with vectors worked out by hand.</content>
public sealed partial class WalkItSourceTests
{
    private const string Abc = "[4, \"ab\", null]";

    // Each outcome is derived from the rule text, not from a run. Tn is starting cell n's token and
    // Lk the token step k writes as a literal; the cells are [4, "ab", null] unless a row says else.
    public static TheoryData<string, string> AcceptedLosses() => new()
    {
        // (a) not met: step 1 overwrites T1 ("ab"), which is not null, and no later step reads T1.
        { Abc, "1=7!" },

        // (a) not met: 0 and "" are values, not null; steps 1 and 2 strike different cells.
        { "[0, \"\", null]", "0=1! 1=2!" },

        // (a) not met: before step 2, cell 2 holds L1 (5) from step 1, no longer the starting null.
        { Abc, "2=5 2=6!" },

        // (b) not met: step 1 reads T1 before step 2 overwrites it, and no step after 2 reads T1.
        { Abc, "2<1 1=7!" },

        // (b) not met: step 2 reads cell 1 after step 1's write, so it reads L1, not T1.
        { Abc, "1=7! 2<1" },

        // (b) not met: step 3 writes the copy of T1 in cell 2 again, so step 4 reads L3, not T1.
        { Abc, "2<1 1=7! 2=5 0<2" },

        // (b) not met: step 3 writes over the copy of T1 in cell 2 but reads T0; a write is not a read.
        { Abc, "2<1 1=7! 2<0" },

        // Equal values: step 1 overwrites T0 (5), and step 2 reads T1, an equal value but another token.
        { "[5, 5, null]", "0=9! 2<1" },

        // Literal: step 1 writes 5 as the new token L1, so step 3 reads L1, not T0 (5) overwritten by step 2.
        { "[5, 0, null]", "1=5 0=7! 2<1" },

        // Second loss not met: steps 1 and 2 strike different cells.
        { Abc, "1=7! 0=8!" },

        // Second loss not met: the strike stays in cell 1; step 2 copies only L1, and step 3 strikes cell 2 first.
        { Abc, "1=7! 2<1 2=9!" },

        // Unstated, built literally: no rule asks for a mark on overwrites of T0 and T1 never read again.
        { Abc, "0=7 1=8" },

        // Unstated, built literally: no rule refuses copying T2, the starting null, into cell 0.
        { Abc, "0<2" },

        // Unstated, built literally: step 2 writes T1 back over T1, and no later step reads T1.
        { Abc, "2<1 1<2!" },

        // Independent: sequence 2 replays from the starting cells, so its step 1 is the first strike of cell 1.
        { Abc, "1=7! / 1=8!" },

        // Independent: sequence 1 marks T1 lost, but only its own later steps count, so sequence 2 reads T1.
        { Abc, "1=7! / 2<1" },

        // Independent: sequence 1's copy of T1 into cell 2 is gone in sequence 2, whose step 1 reads T2.
        { Abc, "2<1 1=7! / 0<2" },

        // Literal identity: no starting cell is null; steps 1 and 2 write 7 as two tokens, L1 and L2,
        // so step 4 reads L2 from cell 1, not L1 overwritten in cell 0 by step 3.
        { "[4, \"ab\", 5]", "0=7 1=7 0=8! 2<1" },
    };

    // Sequence 1's step k is on line 17 + k, and sequence 2's on line 20 + k + sequence 1's step count.
    public static TheoryData<string, string, string> RefusedLosses() => new()
    {
        // (a): before step 1, cell 2 holds T2, the starting null.
        { Abc, "2=5!", NullLoss(18, 2) },

        // (a) by a copy: cell 2 still holds the starting null when step 1 copies T0 onto it.
        { Abc, "2<0!", NullLoss(18, 2) },

        // (a): step 1 copies T0 (null) into cell 2, so cell 2 holds null before step 2.
        { "[null, 4, 0]", "2<0 2=5!", NullLoss(19, 2) },

        // (a) and (b): step 2 overwrites T0 (null) in cell 0, and step 3 reads T0 from step 1's copy in cell 2.
        { "[null, 4, 0]", "2<0 0=1! 1<2", NullLoss(19, 0) + "\n" + ReadLoss(19, 0, 3, 2) },

        // (b) by a direct read: step 2 overwrites the copy of T1 in cell 2, and step 3 reads T1 where it started.
        { Abc, "2<1 2=9! 0<1", ReadLoss(19, 2, 3, 1) },

        // (b) by a copy: step 1 carries T1 into cell 2, step 2 overwrites T1 in cell 1, and step 3 reads cell 2.
        { Abc, "2<1 1=7! 0<2", ReadLoss(19, 1, 3, 2) },

        // (b) by two copies: T1 reaches cell 0 by steps 1 and 2, and step 5 reads it after step 4 rewrote cell 2.
        { Abc, "2<1 0<2 1=7! 2=5 1<0", ReadLoss(20, 1, 5, 0) },

        // (b) at the read: step 3 reads T1 from cell 2 before step 4 writes cell 2, so the later write changes nothing.
        { Abc, "2<1 1=7! 0<2 2=5", ReadLoss(19, 1, 3, 2) },

        // (b) once: steps 3 and 4 both read T1 from cell 2, and the first reader is named.
        { Abc, "2<1 1=7! 0<2 1<2", ReadLoss(19, 1, 3, 2) },

        // Equal values: step 1 carries T0 (5) into cell 2, so step 3 reads T0 itself after step 2 overwrote it.
        { "[5, 5, null]", "2<0 0=9! 1<2", ReadLoss(19, 0, 3, 2) },

        // Copy beside the literal row: step 1 carries T0 into cell 1, so step 3 reads T0 overwritten by step 2.
        { "[5, 0, null]", "1<0 0=7! 2<1", ReadLoss(19, 0, 3, 1) },

        // Second loss: step 1 strikes cell 1, so step 2's mark on cell 1 is a second loss.
        { Abc, "1=7! 1=8!", SecondLoss(19, 1, 1) },

        // Second loss: step 1's strike stays through the unmarked writes of steps 2 and 3.
        { Abc, "1=7! 1=8 1<0 1=9!", SecondLoss(21, 1, 1) },

        // Second loss twice: steps 2 and 3 each mark cell 1 again, and each meets step 1's strike.
        { Abc, "1=7! 1=8! 1=9!", SecondLoss(19, 1, 1) + "\n" + SecondLoss(20, 1, 1) },

        // Unstated, built literally: step 1 is refused under (a) and still strikes cell 2, so step 2 is a second loss.
        { Abc, "2=5! 2=6!", NullLoss(18, 2) + "\n" + SecondLoss(19, 2, 1) },

        // (a) and second loss: step 1 copies T0 (null) over T1 in cell 1 and strikes it, so step 2 breaks both.
        { "[null, 4, 0]", "1<0! 1=5!", NullLoss(19, 1) + "\n" + SecondLoss(19, 1, 1) },

        // Unstated, built literally: step 2 writes T1 back over T1, and step 3 still reads T1 from cell 1.
        { Abc, "2<1 1<2! 0<1", ReadLoss(19, 1, 3, 1) },

        // Independent: sequence 2 replays from the starting cells, so cell 2 holds null again at its step 1.
        { Abc, "2=5 / 2=6!", NullLoss(22, 2) },

        // Independent: sequence 2's step 2 meets the strike of its own step 1, and sequence 1's strike is not counted.
        { Abc, "1=7! / 1=8! 1=9!", SecondLoss(23, 1, 1) },
    };

    // Refused rows that turn on the token a cell holds rather than its value, laid out as above.
    public static TheoryData<string, string, string> TokenLosses() => new()
    {
        // Literal identity: no starting cell is null; step 2 carries L1 into cell 1, step 3 overwrites L1 in cell 0, and step 4 reads L1 from cell 1.
        { "[4, \"ab\", 5]", "0=7 1<0 0=8! 2<1", ReadLoss(20, 0, 4, 1) },

        // Refused first loss still strikes: step 2 overwrites T1 ("ab", not null) and step 3 reads T1 from cell 2, so (b);
        // step 4 overwrites L2 in cell 1, a literal no step reads, and meets step 2's strike, so a second loss.
        { Abc, "2<1 1=7! 0<2 1=8!", ReadLoss(19, 1, 3, 2) + "\n" + SecondLoss(21, 1, 2) },
    };

    // A self-copy is refused, but it reads its cell before writing back the same token, so the
    // sequence is still replayed and each broken lost rule is refused as well.
    public static TheoryData<string, string, string> SelfCopyReplays() => new()
    {
        // Step 3 copies cell 2 onto itself and so reads T1 there after step 2 overwrote T1 in cell 1: (b) at step 2.
        { Abc, "2<1 1=7! 2<2", Path + "20: " + SelfCopy(2) + "\n" + ReadLoss(19, 1, 3, 2) },

        // Step 1 writes T2, the starting null, back into cell 2 and is marked lost, so (a); no later step reads cell 2.
        { Abc, "2<2!", Path + "18: " + SelfCopy(2) + "\n" + NullLoss(18, 2) },

        // Step 1 writes T0 back into cell 0; step 2, marked lost, overwrites T2, the starting null, in cell 2: (a).
        { Abc, "0<0 2=5!", Path + "18: " + SelfCopy(0) + "\n" + NullLoss(19, 2) },
    };

    // Each sequence below also breaks a lost rule, which only a replay would report.
    public static TheoryData<string, string, string> SkippedReplays() => new()
    {
        // Step 1 breaks (a), but step 2 is refused for src 9, so the sequence is not replayed.
        { Abc, "2=5! 0<9", Path + "19: walk-it src 9 is outside the cells, 0 to 2" },

        // Replaying would write cell 5, which is not one of the cells.
        { Abc, "5=1!", Path + "18: walk-it dst 5 is outside the cells, 0 to 2" },

        // The skip is per sequence: sequence 2 is still replayed, and its (a) is refused.
        { Abc, "2<9 / 2=6!", Path + "18: walk-it src 9 is outside the cells, 0 to 2\n" + NullLoss(22, 2) },
    };

    // Sequence 2 is renamed s1, so its name repeats sequence 1's; only an index outside the cells
    // stops a replay, so sequence 2's lost rules are still judged.
    public static TheoryData<string, string, string> NamedReplays() => new()
    {
        // Step 1 of sequence 2 marks cell 2 lost while it holds T2, the starting null: (a).
        { Abc, "1=7 / 2=6!", RepeatedName(19) + "\n" + NullLoss(22, 2) },

        // Step 2 of sequence 2 overwrites T1 in cell 1, and steps 3 and 4 read it from cell 2: (b), naming step 3.
        { Abc, "0=5 / 2<1 1=7! 0<2 1<2", RepeatedName(19) + "\n" + ReadLoss(23, 1, 3, 2) },
    };

    [Theory]
    [MemberData(nameof(AcceptedLosses))]
    public void ALossTheReplayAllowsIsAccepted(string cells, string sequences)
    {
        var block = Block(Replayed(cells, sequences));

        Assert.Equal(sequences.Count(c => c == '!'), block["sequences"]!.AsArray().Sum(s => s!["steps"]!.AsArray().Count(t => t!["lost"] is not null)));
    }

    [Theory]
    [MemberData(nameof(RefusedLosses))]
    [MemberData(nameof(TokenLosses))]
    public void ALossIsRefusedAtTheMarkedStepOncePerRule(string cells, string sequences, string expected)
    {
        var result = Run(Replayed(cells, sequences));

        Assert.Equal(expected, Shown(result));
        Assert.Empty(result.Files);
    }

    [Theory]
    [MemberData(nameof(SelfCopyReplays))]
    public void ASequenceWithASelfCopyIsStillReplayed(string cells, string sequences, string expected)
    {
        var result = Run(Replayed(cells, sequences));

        Assert.Equal(expected, Shown(result));
        Assert.Empty(result.Files);
    }

    [Theory]
    [MemberData(nameof(SkippedReplays))]
    public void ASequenceWithAnIndexRefusalIsNotReplayed(string cells, string sequences, string expected)
    {
        var result = Run(Replayed(cells, sequences));

        Assert.Equal(expected, Shown(result));
        Assert.Empty(result.Files);
    }

    [Theory]
    [MemberData(nameof(NamedReplays))]
    public void ASequenceWithARefusedNameIsStillReplayed(string cells, string sequences, string expected)
    {
        var result = Run(Replayed(cells, sequences).Replace("name: s2", "name: s1", StringComparison.Ordinal));

        Assert.Equal(expected, Shown(result));
        Assert.Empty(result.Files);
    }

    // Sequences are split by " / " and steps by spaces: "2<1" copies cell 1 into cell 2, "1=7" writes
    // 7 into cell 1, and a trailing "!" marks the step lost. The layout is Walk's.
    private static string Replayed(string cells, string sequences) =>
        $"title: Shift\ncells: {cells}\nsequences:\n" + string.Concat(sequences.Split(" / ").Select((steps, s) =>
            $"  - name: s{s + 1}\n    intro: I.\n    steps:\n" + string.Concat(steps.Split(' ').Select(step => $"      - {ReplayedStep(step)}\n"))));

    private static string ReplayedStep(string step)
    {
        var parts = step.TrimEnd('!').Split('<', '=');
        var source = step.Contains('<', StringComparison.Ordinal) ? "src" : "value";
        var lost = step.EndsWith('!') ? ", lost: true" : string.Empty;
        return $"{{ dst: {parts[0]}, {source}: {parts[1]}, note: N.{lost} }}";
    }

    private static string NullLoss(int line, int cell) =>
        string.Create(CultureInfo.InvariantCulture, $"{Path}{line}: a walk-it step marked lost writes cell {cell}, which holds null before the write; mark lost only where a value is overwritten");

    private static string ReadLoss(int line, int cell, int reader, int from) =>
        string.Create(CultureInfo.InvariantCulture, $"{Path}{line}: a walk-it step marked lost overwrites the value in cell {cell}, but step {reader} still reads that value from cell {from}; mark lost only a value that is never read again");

    private static string RepeatedName(int line) =>
        string.Create(CultureInfo.InvariantCulture, $"{Path}{line}: walk-it sequence name \"s1\" is already the name of sequence 1; names are unique in the block");

    private static string SecondLoss(int line, int cell, int first) =>
        string.Create(CultureInfo.InvariantCulture, $"{Path}{line}: a walk-it step marked lost writes cell {cell}, which already shows the value struck at step {first}; a cell is struck at most once in a sequence");
}
