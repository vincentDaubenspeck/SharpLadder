using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

// Tables: the one admitted written form, what is refused beside it, and the spoken sentence rule.
public sealed class TableTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n";
    private const string PartHead = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n";
    private const string Rule = "write a table as one header row, one row of dashes and one or more data rows, each line starting and ending with |, with a blank line or a heading above it and a blank line or the end of the file below it";

    [Fact]
    public void ASimpleTableCompilesToHeadersAndRows()
    {
        var block = Section("| Type | Size |\n|---|---|\n| `int` | 4 *bytes* |\n| long | |\n")["body"]![0]!;

        Assert.Equal(
            """{"type":"table","blockId":"syn-a/b1","headers":[[{"type":"text","text":"Type"}],[{"type":"text","text":"Size"}]],"rows":[[[{"type":"code","text":"int"}],[{"type":"text","text":"4 "},{"type":"em","content":[{"type":"text","text":"bytes"}]}]],[[{"type":"text","text":"long"}],[]]]}""",
            block.ToJsonString());
    }

    [Fact]
    public void TheWorkedExampleIsSpokenAsOneSegmentOnTheTable()
    {
        var speech = Section("| Type | Size |\n|---|---|\n| int | 4 bytes |\n| long | |\n")["spoken"]!;

        Assert.Equal(
            """[{"target":{"type":"block","blockId":"syn-a/b1"},"text":"Columns: Type, Size. Row 1. Type: int; Size: 4 bytes. Row 2. Type: long; Size: blank."}]""",
            speech["segments"]!.ToJsonString(new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        Assert.Equal(AudioSlot.Of(["Columns: Type, Size. Row 1. Type: int; Size: 4 bytes. Row 2. Type: long; Size: blank."]), (string?)speech["audio"]);
    }

    [Theory]
    [InlineData("| | B |\n|---|---|\n| 1 | 2 |\n", "Columns: Column 1, B. Row 1. Column 1: 1; B: 2.")]
    [InlineData("| A | |\n|---|---|\n| | |\n", "Columns: A, Column 2. Row 1. A: blank; Column 2: blank.")]
    [InlineData("| A |\n|---|\n| Done. |\n| Stop! |\n| Why? |\n| More… |\n| plain |\n", "Columns: A. Row 1. A: Done. Row 2. A: Stop! Row 3. A: Why? Row 4. A: More… Row 5. A: plain.")]
    [InlineData("| Really? |\n|---|\n| yes |\n", "Columns: Really? Row 1. Really?: yes.")]
    [InlineData("| A | B |\n|---|---|\n| *em* **strong** | [link](#syn-a) `code` |\n", "Columns: A, B. Row 1. A: em strong; B: link code.")]
    [InlineData("| A |\n|---|\n| a \\| b |\n", "Columns: A. Row 1. A: a | b.")]
    [InlineData("| A |\n|---|\n| `a|b` |\n", "Columns: A. Row 1. A: a|b.")]
    [InlineData("|  A  |\n| --- |\n|   padded   |\n", "Columns: A. Row 1. A: padded.")]
    [InlineData("Before.\n\n| A |\n|---|\n| 1 |\n\nAfter.\n", "Before.|Columns: A. Row 1. A: 1.|After.")]
    public void TablesAreSpokenByTheSentenceRule(string body, string expected) =>
        Assert.Equal(expected, string.Join('|', Section(body)["spoken"]!["segments"]!.AsArray().Select(s => (string)s!["text"]!)));

    [Theory]
    [InlineData("Use a | b or c | d here.\n")]
    [InlineData("\\| starts with a shown pipe.\n")]
    [InlineData("A `|` in code and a | outside.\n")]
    [InlineData("- an item with a | b\n- `| code first`\n")]
    [InlineData("Two lines\nwith a | inside.\n")]
    public void ProseWithPipesStaysProse(string body)
    {
        var blocks = Section(body)["body"]!.AsArray();

        Assert.DoesNotContain(blocks, b => string.Equals((string?)b!["type"], "table", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("| A | B |\n|:--|--:|\n| 1 | 2 |\n", "column alignment markers are not supported; " + Rule)]
    [InlineData("| A | B |\n|---|---|\n| 1 |\n", Rule)]
    [InlineData("| A | B |\n|---|---|\n| 1 | 2 | 3 |\n", Rule)]
    [InlineData("| A |\n|---|\n", Rule)]
    [InlineData("A | B\n--|--\n1 | 2\n", Rule)]
    [InlineData("| A | B\n|---|---\n| 1 | 2\n", Rule)]
    [InlineData("A | B |\n---|---|\n1 | 2 |\n", Rule)]
    [InlineData("| A | B |\n| 1 | 2 |\n", "a line that starts with | is read as a table and this one is not a table; " + Rule)]
    [InlineData("| A |\n| 1 |\n|---|\n", Rule)]
    [InlineData("| A |\n|===|\n| 1 |\n", Rule)]
    [InlineData("Text first\n| more text\n", "chapters/c/part.md:10: a line that starts with | is read as a table and this one is not a table; " + Rule)]
    [InlineData("Text first\n   | indented\n", "chapters/c/part.md:10: a line that starts with | is read as a table")]
    [InlineData("- item\n  | more\n", "a line that starts with | is read as a table")]
    [InlineData("Text first\n| A |\n|---|\n| 1 |\n", Rule)]
    [InlineData("| A |\n|---|\n| 1 |\ntrailing text\n", Rule)]
    [InlineData("+---+\n| A |\n+===+\n| 1 |\n+---+\n", Rule)]
    [InlineData("- | A |\n  |---|\n  | 1 |\n", "a list item holds one paragraph only")]
    [InlineData("> | A |\n> |---|\n> | 1 |\n", "unsupported Markdown: block quote")]
    [InlineData("<table><tr><td>x</td></tr></table>\n", "raw HTML is not allowed")]
    [InlineData("| A |\n|---|\n| a<br>b |\n", "raw HTML is not allowed")]
    [InlineData("| A |\n|---|\n| *x*{.c} |\n", "chapters/c/part.md:11: attributes are not supported in a table cell")]
    [InlineData("| A |\n|---|\n| x {#syn-b} |\n", "chapters/c/part.md:9: attributes are allowed only")]
    [InlineData("| A {key=v} |\n|---|\n| x |\n", "chapters/c/part.md:9: attributes are allowed only")]
    [InlineData("| A |\n|---|\n| ![i](a.png) |\n", "chapters/c/part.md:11: unsupported Markdown: image")]
    [InlineData("| A |\n|---|\n| [x](https://example.com) |\n", "chapters/c/part.md:11: link target")]
    public void AnythingElseWrittenAsATableIsRefused(string body, string expected)
    {
        var result = Run(Part("## Title {#syn-a}\n\n" + body));

        Assert.Contains(expected, string.Join('\n', result.Diagnostics.Select(d => d.ToString())), StringComparison.Ordinal);
        Assert.Empty(result.Files);
    }

    [Theory]
    [InlineData("| a | b |", 3)]
    [InlineData("  | a |\t", 2)]
    [InlineData("| a \\| b |", 2)]
    [InlineData("| `a|b` |", 2)]
    [InlineData("| ``a`|b`` | c |", 3)]
    [InlineData("| `a | b |", 3)]
    [InlineData("| a | b", -1)]
    [InlineData("a | b |", -1)]
    [InlineData("| a \\|", -1)]
    [InlineData("| `a |`", -1)]
    [InlineData("|", -1)]
    [InlineData("", -1)]
    public void PipesAreCountedOutsideEscapesAndCodeSpans(string line, int expected) =>
        Assert.Equal(expected, SourceFile.Pipes(line));

    private static JsonNode Section(string body)
    {
        var result = Run(Part("## Title {#syn-a}\n\n" + body));
        Assert.Empty(result.Diagnostics);
        return JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/part.json", StringComparison.Ordinal)).Bytes)!["sections"]![0]!;
    }

    private static (string Path, string Text)[] Part(string body) =>
        [("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", PartHead + body)];

    private static CompileResult Run((string Path, string Text)[] files)
    {
        using var folder = new TempFolder();
        foreach (var (path, text) in files)
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return Repository.Compile(folder.Path);
    }
}
