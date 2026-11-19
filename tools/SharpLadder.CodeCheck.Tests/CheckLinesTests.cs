using System.Text;
using System.Text.Json;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The result-line parser through its committed case table; each case's chunks are fed as given.
public sealed class CheckLinesTests
{
    private static readonly IReadOnlyList<JsonElement> Table = Load();

    public static TheoryData<string> Cases { get; } = [.. Table.Select(c => c.GetProperty("name").GetString()!)];

    [Theory]
    [MemberData(nameof(Cases))]
    public void CaseHolds(string name)
    {
        var item = Table.Single(c => string.Equals(c.GetProperty("name").GetString(), name, StringComparison.Ordinal));
        var lines = new CheckLines(item.GetProperty("declared").GetInt32());

        foreach (var chunk in Items(item.GetProperty("chunks")))
        {
            lines.Append(Bytes(chunk));
        }

        lines.End();

        var expected = Items(item.GetProperty("checks"))
            .Select(c => new CheckLines.Check(Encoding.UTF8.GetString(Bytes(c.GetProperty("name"))), c.GetProperty("pass").GetBoolean()));
        Assert.Equal(expected, lines.Checks);
        Assert.Equal(item.GetProperty("unrecorded").GetInt32(), lines.Unrecorded);
    }

    private static List<JsonElement> Load()
    {
        var path = Path.Combine(Checker.RepositoryRoot, "tools", "SharpLadder.CodeCheck.Tests", "check-lines.cases.json");
        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        return [.. Items(document.RootElement.GetProperty("cases")).Select(c => c.Clone())];
    }

    // By index: an array enumerator is disposable, and these are read in one expression.
    private static IEnumerable<JsonElement> Items(JsonElement array) =>
        Enumerable.Range(0, array.GetArrayLength()).Select(i => array[i]);

    // A string is its UTF-8 bytes; a list joins its pieces, each text or hex, repeated as given.
    private static byte[] Bytes(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String)
        {
            return Encoding.UTF8.GetBytes(value.GetString()!);
        }

        var bytes = new List<byte>();
        foreach (var piece in Items(value))
        {
            var one = piece.TryGetProperty("hex", out var hex) ? Convert.FromHexString(hex.GetString()!) : Encoding.UTF8.GetBytes(piece.GetProperty("text").GetString()!);
            var repeat = piece.TryGetProperty("repeat", out var count) ? count.GetInt32() : 1;
            for (var i = 0; i < repeat; i++)
            {
                bytes.AddRange(one);
            }
        }

        return [.. bytes];
    }
}
