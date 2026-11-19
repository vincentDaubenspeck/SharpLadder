using System.Collections.Immutable;
using System.Text;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// Result records fed to the parser and the verdicts as bytes with an exit status; no child runs.
// The group has two blocks with checks, so its bound is four records.
public sealed class RecordTests
{
    private const string File = "chapters/runs/records.md";
    private const string Token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private const string Start = $$"""{"token":"{{Token}}","kind":"start","pid":4242,"coreLibraryDirectory":"runtime"}""" + "\n";
    private const string First = $$"""{"token":"{{Token}}","kind":"check","blockId":"first"}""" + "\n";
    private const string Second = $$"""{"token":"{{Token}}","kind":"check","blockId":"second"}""" + "\n";
    private const string FirstFailed = $$"""{"token":"{{Token}}","kind":"check-failed","blockId":"first"}""" + "\n";
    private const string End = $$"""{"token":"{{Token}}","kind":"end"}""" + "\n";

    private static readonly CompiledGroup Group = Compiled(
        Block("first", 10, "int a = 1;\n", "a == 1"),
        Block("second", 20, "int b = 2;\n", "b == 2"));

    [Fact]
    public void MalformedRecordFailsTheGroup()
    {
        var malformed = $$"""{"token":"{{Token}}","kind":"check","blockId":first}""" + "\n";

        Assert.Equal("chapters/runs/records.md:11 first result record 2 is malformed", Judge(Start + malformed + Second + End, 0));
    }

    [Fact]
    public void DuplicateRecordFailsTheGroup()
    {
        Assert.Equal("chapters/runs/records.md:11 first result record 3 repeats an earlier record", Judge(Start + First + First + Second, 0));
    }

    [Fact]
    public void ExtraRecordFailsTheGroup()
    {
        Assert.Equal("chapters/runs/records.md:11 first result record 3 is not expected there", Judge(Start + FirstFailed + End, 1));
        Assert.Equal("chapters/runs/records.md:11 first result record 2 is not expected there", Judge(Start + Second + First + End, 0));
    }

    [Fact]
    public void MissingRecordFailsTheGroup()
    {
        Assert.Equal("chapters/runs/records.md:11 first the check record of second is missing before result record 3", Judge(Start + First + End, 0));
    }

    [Fact]
    public void OversizedRecordFailsTheGroup()
    {
        var oversized = $$"""{"token":"{{Token}}","kind":"check","blockId":"{{new string('x', 16 * 1024)}}"}""" + "\n";

        Assert.Equal("chapters/runs/records.md:11 first result record 2 is longer than 16 KiB", Judge(Start + oversized + First + Second + End, 0));
    }

    [Fact]
    public void TooManyRecordsFailTheGroup()
    {
        Assert.Equal("chapters/runs/records.md:11 first wrote more than 4 result records", Judge(Start + First + Second + End + End, 0));
    }

    [Fact]
    public void TerminalRecordWithTheWrongExitStatusFails()
    {
        Assert.Null(Judge(Start + First + Second + End, 0));
        Assert.Equal("chapters/runs/records.md:11 first exited with status 1 after its end record", Judge(Start + First + Second + End, 1));
    }

    private static string? Judge(string results, int exitStatus)
    {
        var records = new ResultReader(Token, Group, processGroup: false);
        records.Append(Encoding.UTF8.GetBytes(results));
        records.Complete();
        return GroupVerdict.Judge(Group, records, exitStatus)?.ToString();
    }

    private static SourceBlock Block(string id, int fence, string source, string check) =>
        new(File, id, "records", File, fence, fence + 1, null, source, check, null, null, "Section", fence);

    private static CompiledGroup Compiled(params SourceBlock[] blocks)
    {
        var result = Assembler.Assemble(blocks);
        Assert.Empty(result.Failures);
        return new CompiledGroup(Assert.Single(result.Groups), ImmutableArray<byte>.Empty, null);
    }
}
