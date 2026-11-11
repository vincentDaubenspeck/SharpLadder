using System.Text;
using Xunit;

namespace SharpLadder.Content.Tests;

// The retain mode: the committed alias record judged against an earlier one on standard input.
public sealed class RetentionTests
{
    private const string Empty = """{"slugs":{},"ids":{}}""";

    [Theory]
    [InlineData(Empty, Empty)]
    [InlineData(Empty, """{"slugs":{"old":"test"},"ids":{"begin":"start"}}""")]
    [InlineData("""{"slugs":{"old":"test"},"ids":{"begin":"start"}}""", """{"slugs":{"old":"test"},"ids":{"begin":"start"}}""")]
    [InlineData("""{"slugs":{"old":"test"},"ids":{"begin":"start"}}""", """{"slugs":{"ancient":"test","old":"test"},"ids":{"begin":"start","first":"start"}}""")]
    [InlineData("""{"slugs":{"old":"test"},"ids":{"begin":"start"}}""", """{"slugs":{"old":"exam","test":"exam"},"ids":{"begin":"opening","start":"opening"}}""")]
    [InlineData("""{"slugs":{},"ids":{"a":"m","b":"m","c":"n"}}""", """{"slugs":{},"ids":{"a":"z","b":"z","c":"n","m":"z"}}""")]
    [InlineData("""{"slugs":{"start":"test"},"ids":{"test":"start"}}""", """{"slugs":{"start":"test"},"ids":{"test":"start"}}""")]
    [InlineData("""{"slugs":{},"ids":{"constructor":"start"}}""", """{"slugs":{},"ids":{"constructor":"start","to-string":"start"}}""")]
    public void KeptAndHonestlyMovedNamesPass(string before, string now)
    {
        var result = Retain(before, now);

        Assert.Equal("PASS content retain\n", result.Output);
        Assert.Equal(0, result.Code);
    }

    [Theory]
    [InlineData("""{"slugs":{"old":"test"},"ids":{}}""", Empty, "slugs: the retired name \"old\" was removed; a retired name is kept for good")]
    [InlineData("""{"slugs":{},"ids":{"begin":"start"}}""", Empty, "ids: the retired name \"begin\" was removed")]
    [InlineData("""{"slugs":{},"ids":{"begin":"start"}}""", """{"slugs":{"begin":"test"},"ids":{}}""", "ids: the retired name \"begin\" was removed")]
    [InlineData("""{"slugs":{"old":"test"},"ids":{}}""", """{"slugs":{},"ids":{"old":"start"}}""", "slugs: the retired name \"old\" was removed")]
    [InlineData("""{"slugs":{},"ids":{"begin":"start"}}""", """{"slugs":{},"ids":{"begin":"other"}}""", "ids: \"begin\" ended at \"start\" and now ends at \"other\", where \"start\" does not lead")]
    [InlineData("""{"slugs":{"old":"test"},"ids":{}}""", """{"slugs":{"old":"exam"},"ids":{}}""", "slugs: \"old\" ended at \"test\" and now ends at \"exam\", where \"test\" does not lead")]
    [InlineData("""{"slugs":{},"ids":{"begin":"start"}}""", """{"slugs":{},"ids":{"begin":"other","start":"third"}}""", "ids: \"begin\" ended at \"start\" and now ends at \"other\"")]
    [InlineData("""{"slugs":{},"ids":{"begin":"start"}}""", """{"slugs":{"start":"other"},"ids":{"begin":"other"}}""", "ids: \"begin\" ended at \"start\" and now ends at \"other\"")]
    [InlineData("""{"slugs":{},"ids":{"a":"m","b":"m"}}""", """{"slugs":{},"ids":{"a":"z","b":"m"}}""", "ids: \"a\" ended at \"m\" and now ends at \"z\"")]
    [InlineData("""{"slugs":{},"ids":{"constructor":"start"}}""", Empty, "ids: the retired name \"constructor\" was removed")]
    public void RemovedOrRedirectedNameFails(string before, string now, string expected)
    {
        var result = Retain(before, now);

        Assert.Equal(1, result.Code);
        Assert.Contains("  " + expected, result.Output, StringComparison.Ordinal);
        Assert.EndsWith("FAIL content retain\n", result.Output, StringComparison.Ordinal);
    }

    [Fact]
    public void EveryBrokenNameIsReported()
    {
        var result = Retain("""{"slugs":{"a":"test","b":"test"},"ids":{"c":"start","d":"start"}}""", """{"slugs":{"b":"exam"},"ids":{"d":"other"}}""");

        Assert.Equal(1, result.Code);
        Assert.Equal(5, result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("""{"slugs":{}}""")]
    [InlineData("""{"slugs":{},"ids":{},"extra":{}}""")]
    [InlineData("""{"slugs":{},"ids":{"a":1}}""")]
    [InlineData("""{"slugs":{},"ids":{"A":"start"}}""")]
    [InlineData("""{"slugs":{},"ids":{"a":"x","a":"y"}}""")]
    [InlineData("""{"slugs":{},"ids":{}}{"slugs":{},"ids":{}}""")]
    [InlineData("""{"slugs":{},"ids":{}""")]
    [InlineData("""{"patterns":[]}""")]
    public void EarlierRecordThatIsNotAnAliasRecordFails(string before)
    {
        var result = Retain(before, Empty);

        Assert.Equal(1, result.Code);
        Assert.StartsWith("  standard input: ", result.Output, StringComparison.Ordinal);
        Assert.EndsWith("FAIL content retain\n", result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(new byte[] { 0xEF, 0xBB, 0xBF, (byte)'{', (byte)'}' }, "standard input: starts with a byte-order mark")]
    [InlineData(new byte[] { (byte)'{', 0xFF, (byte)'}' }, "standard input: not UTF-8")]
    public void EarlierRecordInRefusedBytesFails(byte[] before, string expected)
    {
        var result = Retain(before, Encoding.UTF8.GetBytes(Empty));

        Assert.Equal(1, result.Code);
        Assert.Contains(expected, result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"slugs":{},"ids":{"A":"start"}}""")]
    [InlineData("""{"patterns":[]}""")]
    public void CommittedRecordThatIsNotAnAliasRecordFails(string now)
    {
        var result = Retain(Empty, now);

        Assert.Equal(1, result.Code);
        Assert.StartsWith("  aliases.json: schema: ", result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"slugs":{},"ids":{"a":"u","t":"u","u":"t"}}""", "ids: \"a\" ends at \"u\", which is itself retired; every end must be final")]
    [InlineData("""{"slugs":{},"ids":{"a":"u","t":"u","u":"v"}}""", "ids: \"a\" ends at \"u\", which is itself retired")]
    [InlineData("""{"slugs":{"a":"a"},"ids":{}}""", "slugs: \"a\" ends at \"a\", which is itself retired")]
    [InlineData("""{"slugs":{"b":"c","c":"d"},"ids":{"t":"u"}}""", "slugs: \"b\" ends at \"c\", which is itself retired")]
    public void RecordWithAnEndThatIsItselfRetiredIsNotJudged(string chained, string expected)
    {
        var working = Retain("""{"slugs":{},"ids":{"a":"t"}}""", chained);
        var earlier = Retain(chained, Empty);

        Assert.Equal(1, working.Code);
        Assert.StartsWith($"  aliases.json: {expected}", working.Output, StringComparison.Ordinal);
        Assert.Equal(1, earlier.Code);
        Assert.StartsWith($"  standard input: {expected}", earlier.Output, StringComparison.Ordinal);
    }

    [Fact]
    public void CompiledFolderWithoutTheRecordFails()
    {
        using var folder = new TempFolder();
        File.WriteAllText(Path.Combine(folder.Path, "Aliases.json"), Empty);
        Directory.CreateDirectory(Path.Combine(folder.Path, "sub"));
        File.WriteAllText(Path.Combine(folder.Path, "sub", "aliases.json"), Empty);

        var result = PayloadWorkspace.Invoke(["retain", Repository.SchemaFolder, folder.Path], stdin: Encoding.UTF8.GetBytes(Empty));

        Assert.Equal(1, result.Code);
        Assert.Equal("  aliases.json: the compiled folder holds no such file\nFAIL content retain\n", result.Output);
    }

    [Fact]
    public void FolderNamedLikeTheRecordFails()
    {
        using var folder = new TempFolder();
        Directory.CreateDirectory(Path.Combine(folder.Path, "aliases.json"));

        var result = PayloadWorkspace.Invoke(["retain", Repository.SchemaFolder, folder.Path], stdin: Encoding.UTF8.GetBytes(Empty));

        Assert.Equal(1, result.Code);
        Assert.Contains("the compiled folder holds no such file", result.Output, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("retain")]
    [InlineData("retain", "one")]
    [InlineData("retain", "one", "two", "three")]
    public void WrongArgumentCountIsAUsageError(params string[] args)
    {
        var result = PayloadWorkspace.Invoke(args);

        Assert.Equal(2, result.Code);
        Assert.Contains("usage:", result.Output, StringComparison.Ordinal);
    }

    [Fact]
    public void RelativeFolderIsRefused()
    {
        var result = PayloadWorkspace.Invoke(["retain", Repository.SchemaFolder, "web/compiled"], stdin: Encoding.UTF8.GetBytes(Empty));

        Assert.Equal(2, result.Code);
        Assert.Contains("web/compiled: ", result.Output, StringComparison.Ordinal);
    }

    private static CliResult Retain(string before, string now) => Retain(Encoding.UTF8.GetBytes(before), Encoding.UTF8.GetBytes(now));

    private static CliResult Retain(byte[] before, byte[] now)
    {
        using var folder = new TempFolder();
        File.WriteAllBytes(Path.Combine(folder.Path, "aliases.json"), now);
        return PayloadWorkspace.Invoke(["retain", Repository.SchemaFolder, folder.Path], stdin: before);
    }
}
