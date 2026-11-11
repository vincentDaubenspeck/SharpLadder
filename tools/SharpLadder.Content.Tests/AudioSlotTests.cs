using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// The expected bytes in the vector file were written out from RFC 8785, never by this writer or
// the Node one; both runtimes read the same file, so agreeing with it is agreeing with each other.
public sealed class AudioSlotTests
{
    private static readonly string VectorFile = Path.Combine(Repository.Root, "tools", "SharpLadder.Content.Tests", "fixtures", "slot", "vectors.json");

    public static TheoryData<string> Accepted() => [.. Names("accepted")];

    public static TheoryData<string> Rejected() => [.. Names("rejected")];

    [Theory]
    [MemberData(nameof(Accepted))]
    public void WriterGivesTheExpectedBytes(string name)
    {
        var vector = Vector("accepted", name);

        var bytes = AudioSlot.Serialise(Texts(vector));

        Assert.Equal((string?)vector["canonical"], Convert.ToHexStringLower(bytes));
    }

    [Theory]
    [MemberData(nameof(Rejected))]
    public void LoneSurrogateIsRefusedByEveryEntryPoint(string name)
    {
        var texts = Texts(Vector("rejected", name));

        Assert.Throws<ArgumentException>(() => AudioSlot.Serialise(texts));
        Assert.Throws<ArgumentException>(() => AudioSlot.Of(texts));
        Assert.Contains(texts, t => Throws(() => AudioSlot.Normalise(t)));
    }

    [Fact]
    public void VectorFileHoldsBothKinds()
    {
        Assert.True(Names("accepted").Count >= 14);
        Assert.True(Names("rejected").Count >= 8);
    }

    [Theory]
    [MemberData(nameof(Accepted))]
    public void SlotOfStoredFormTextMatchesTheVector(string name)
    {
        var vector = Vector("accepted", name);
        var texts = Texts(vector);
        if (!(bool)vector["stored"]!)
        {
            Assert.Contains(texts, t => Throws(() => AudioSlot.Normalise(t)) || !string.Equals(AudioSlot.Normalise(t), t, StringComparison.Ordinal));
            Assert.Throws<ArgumentException>(() => AudioSlot.Of(texts));
            return;
        }

        Assert.Equal((string?)vector["slot"], AudioSlot.Of(texts));
    }

    [Fact]
    public void SlotHasTheSchemaForm() =>
        Assert.Matches("^sha256:[0-9a-f]{64}$", AudioSlot.Of(["Some text.", "More."]));

    [Fact]
    public void SegmentOrderChangesTheSlot() =>
        Assert.NotEqual(AudioSlot.Of(["a", "b"]), AudioSlot.Of(["b", "a"]), StringComparer.Ordinal);

    [Fact]
    public void SplittingOneTextIntoTwoChangesTheSlot() =>
        Assert.NotEqual(AudioSlot.Of(["a\",\"b"]), AudioSlot.Of(["a", "b"]), StringComparer.Ordinal);

    [Theory]
    [InlineData("a\r\nb", "a\nb")]
    [InlineData("a\rb", "a\nb")]
    [InlineData("a\r\r\nb", "a\n\nb")]
    [InlineData("é", "é")]
    [InlineData("Å", "Å")]
    [InlineData("plain", "plain")]
    public void NormaliseGivesLineFeedsAndComposedForm(string raw, string stored)
    {
        Assert.Equal(stored, AudioSlot.Normalise(raw));
        Assert.Equal(AudioSlot.Of([stored]), AudioSlot.Of([AudioSlot.Normalise(raw)]));
    }

    [Theory]
    [InlineData("a\rb")]
    [InlineData("a\r\nb")]
    [InlineData("é")]
    public void SlotRefusesTextThatIsNotInStoredForm(string raw) =>
        Assert.Throws<ArgumentException>(() => AudioSlot.Of(["fine", raw]));

    [Theory]
    [InlineData(0xFFFE)]
    [InlineData(0xFFFF)]
    [InlineData(0xFDD0)]
    [InlineData(0xFDEF)]
    [InlineData(0x1FFFE)]
    [InlineData(0x10FFFF)]
    public void NoncharacterIsRefusedInStoredText(int codePoint)
    {
        var text = "a" + char.ConvertFromUtf32(codePoint);

        Assert.Throws<ArgumentException>(() => AudioSlot.Normalise(text));
        Assert.Throws<ArgumentException>(() => AudioSlot.Of([text]));
    }

    [Theory]
    [InlineData(0xFDCF)]
    [InlineData(0xFDF0)]
    [InlineData(0xFFFD)]
    [InlineData(0x10000)]
    [InlineData(0x10FFFD)]
    public void NeighbourOfANoncharacterIsAdmitted(int codePoint)
    {
        var text = char.ConvertFromUtf32(codePoint);

        Assert.Matches("^sha256:[0-9a-f]{64}$", AudioSlot.Of([AudioSlot.Normalise(text)]));
    }

    [Fact]
    public void MissingInputIsRefused()
    {
        Assert.Throws<ArgumentNullException>(() => AudioSlot.Serialise(null!));
        Assert.Throws<ArgumentException>(() => AudioSlot.Serialise(["a", null!]));
        Assert.Throws<ArgumentNullException>(() => AudioSlot.Of(null!));
        Assert.Throws<ArgumentException>(() => AudioSlot.Of([null!]));
    }

    private static bool Throws(Action action)
    {
        try
        {
            action();
            return false;
        }
        catch (ArgumentException)
        {
            return true;
        }
    }

    private static JsonArray Vectors(string kind) => JsonNode.Parse(File.ReadAllBytes(VectorFile))![kind]!.AsArray();

    private static List<string> Names(string kind) => [.. Vectors(kind).Select(v => (string)v!["name"]!)];

    private static JsonNode Vector(string kind, string name) =>
        Vectors(kind).Single(v => string.Equals((string?)v!["name"], name, StringComparison.Ordinal))!;

    // Texts are stored as UTF-16 code units, so a lone surrogate survives the file format.
    private static List<string> Texts(JsonNode vector) =>
        [.. vector["texts"]!.AsArray().Select(t => new string([.. t!.AsArray().Select(u => (char)(int)u!)]))];
}
