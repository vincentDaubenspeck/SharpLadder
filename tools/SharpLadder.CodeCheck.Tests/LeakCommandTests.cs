using System.Text.Json;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The leak scan through its command over the content fixture pair: seeded leaks it must find, near
// misses it must pass and inputs it must refuse.
public sealed class LeakCommandTests
{
    // Lines 7 and 9 of prob-9001's reference: consecutive once the short line between them is left out.
    private const string Loop = "foreach (var word in words)";
    private const string Test = "if (word.Length > 0 && word[0] == word[^1])";

    // Shared with drill-fix-pair-scores's suite (and starter), then its reference lines 9 and 10.
    private const string Shared = "using System.Collections.Generic;";
    private const string Pairs = "var pairs = new Dictionary<string, int>(StringComparer.Ordinal);";
    private const string Count = "for (var i = 0; i < Math.Min(names.Length, scores.Length); i++)";

    private static readonly string Pair = Path.Combine(Checker.RepositoryRoot, "tools", "SharpLadder.Content.Tests", "fixtures");

    private static string Reference => Path.Combine(Pair, "reference");

    private static string ProblemReference => Checker.Shown(Path.Combine(Reference, "prob-9001.reference.cs"));

    [Fact]
    public void ReferenceFileCopiedIntoDistFails()
    {
        using var dist = new TempFolder();
        var copied = Checker.Shown(dist.Write("assets/solution.cs", File.ReadAllText(Path.Combine(Reference, "prob-9001.reference.cs"))));

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, dist.Path);

        Assert.Equal(1, code);
        Assert.Equal(
            [
                $"  {copied}: raw view: holds the marker \"// reference: prob-9001\" of {ProblemReference}",
                $"  {copied}: raw view: holds lines 1 and 4 of {ProblemReference} in a row",
                "FAIL leak",
            ],
            lines);
    }

    [Fact]
    public void TwoReferenceLinesEscapedInCompiledJsonFail()
    {
        using var compiled = new TempFolder();
        var path = compiled.Write("practice/problems/prob-9001.json", $"{{\"statement\":{JsonSerializer.Serialize($"{Loop}\n{{\n    {Test}")}}}\n");
        Assert.DoesNotContain("&&", File.ReadAllText(path), StringComparison.Ordinal);

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, compiled.Path);

        Assert.Equal(1, code);
        Assert.Equal([$"  {Checker.Shown(path)}: JSON string view: holds lines 7 and 9 of {ProblemReference} in a row", "FAIL leak"], lines);
    }

    [Theory]
    [InlineData("// reference: prob-9001", "prob-9001.reference.cs")]
    [InlineData("// wrong: prob-9001 empty-input", "prob-9001.empty-input.wrong.cs")]
    public void MarkerLineAloneFails(string marker, string file)
    {
        using var dist = new TempFolder();
        var path = dist.Write("index.html", $"<p>Count the words.</p>\n{marker}\n");

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, dist.Path);

        Assert.Equal(1, code);
        Assert.Equal([$"  {Checker.Shown(path)}: raw view: holds the marker \"{marker}\" of {Checker.Shown(Path.Combine(Reference, file))}", "FAIL leak"], lines);
    }

    // Neither is in the raw text: one is behind JSON's \n and \/, the other behind C#'s \x.
    [Theory]
    [InlineData("data.json", "{\"note\":\"intro\\n\\/\\/ reference: prob-9001\"}\n")]
    [InlineData("bundle.js", "const note = \"\\x002f\\x002f reference: prob-9001\";\n")]
    public void EscapedMarkerFails(string name, string text)
    {
        using var dist = new TempFolder();
        var path = dist.Write(name, text);

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, dist.Path);

        Assert.Equal(1, code);
        Assert.Equal([$"  {Checker.Shown(path)}: decoded view: holds the marker \"// reference: prob-9001\" of {ProblemReference}", "FAIL leak"], lines);
    }

    [Fact]
    public void OnlyExcludedAndSuiteSharedLinesPass()
    {
        using var root = StandIn($"# Generic.\n\n# A map with ordinal keys.\n{Pairs}\n# A loop over two lists.\n{Count}\n");
        using var dist = new TempFolder();
        dist.Write("notes.txt", $"{Shared}\n{Pairs}\n{Count}\n");

        var (code, lines) = Scan(root.Path, Reference, dist.Path);

        Assert.Equal(0, code);
        Assert.Equal(["1 file scanned", "PASS leak"], lines);
    }

    [Theory]
    [InlineData(Loop)]
    [InlineData($"{Loop}\nvar unrelated = words.Distinct().Count();\n{Test}")]
    public void ReferenceLinesOutsideARunPass(string text)
    {
        using var dist = new TempFolder();
        dist.Write("notes.txt", text);

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, dist.Path);

        Assert.Equal(0, code);
        Assert.Equal(["1 file scanned", "PASS leak"], lines);
    }

    // A character outside the BMP is one code point and two UTF-16 units.
    [Theory]
    [InlineData(20, 0)]
    [InlineData(21, 1)]
    public void OnlyLinesOverTwentyCodePointsQualify(int length, int expected)
    {
        var first = "x" + new string('a', length - 2) + "\U0001F600";
        var second = "x" + new string('b', length - 2) + "\U0001F600";
        using var reference = new TempFolder();
        foreach (var file in Directory.GetFiles(Reference))
        {
            File.Copy(file, Path.Combine(reference.Path, Path.GetFileName(file)));
        }

        reference.Write("prob-9001.reference.cs", $"// reference: prob-9001\n{first}\n{second}\n");
        using var dist = new TempFolder();
        dist.Write("notes.txt", $"{first}\n{second}\n");

        var (code, _) = Scan(Checker.RepositoryRoot, reference.Path, dist.Path);

        Assert.Equal(expected, code);
    }

    // CRLF and other whitespace; a short line and a line shared with the starter inside the run.
    [Theory]
    [InlineData("\t\tforeach  (var   word in words)\r\n{\r\n    if (word.Length > 0 &&\tword[0] == word[^1])   \r\n")]
    [InlineData($"{Loop}\n}}\npublic static class Solution\n{Test}\n")]
    public void RunIsFoundThroughLineVariance(string text)
    {
        using var dist = new TempFolder();
        var path = dist.Write("notes.txt", text);

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, dist.Path);

        Assert.Equal(1, code);
        Assert.Equal([$"  {Checker.Shown(path)}: raw view: holds lines 7 and 9 of {ProblemReference} in a row", "FAIL leak"], lines);
    }

    [Fact]
    public void MissingTargetCannotBeScanned()
    {
        using var parent = new TempFolder();
        var target = Path.Combine(parent.Path, "dist");

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, target);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(target)}: missing or unreadable; a target must be a folder or a file", "FAIL leak"], lines);
    }

    // The count is summed over the targets, so a pass must not rest on another target's files.
    [Fact]
    public void EmptyFolderTargetBesideAScannedOneCannotBeScanned()
    {
        using var dist = new TempFolder();
        dist.Write("notes.txt", Loop);
        using var empty = new TempFolder();

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, dist.Path, empty.Path);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(empty.Path)}: holds no file to scan; a target must yield at least one", "FAIL leak"], lines);
    }

    [Fact]
    public void FolderTargetThatIsALinkCannotBeScanned()
    {
        using var dist = new TempFolder();
        dist.Write("notes.txt", Loop);
        using var parent = new TempFolder();
        var target = Path.Combine(parent.Path, "dist");
        using var link = new FolderLink(target, dist.Path);

        var (code, lines) = Scan(Checker.RepositoryRoot, Reference, target);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(target)}: links and reparse points are not accepted as a target or below one", "FAIL leak"], lines);
    }

    // A lowered bound stands in for 64 MiB. The read's own refusal shows the bytes were never read:
    // the later whole-file check would pass a file this small.
    [Fact]
    public void FileOverTheBoundInANestedFolderIsRefusedAtItsRead()
    {
        using var dist = new TempFolder();
        var path = dist.Write("assets/deep/bundle.js", new string('x', 17));

        using var output = new StringWriter();
        var code = Leak.Run([Checker.SchemaFolder, Path.Combine(Pair, "content"), Reference, dist.Path], output, Checker.RepositoryRoot, fileLimit: 16);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Checker.Shown(path)}: 17 bytes; at most 16 are read of one file", "FAIL leak"], output.ToString().ReplaceLineEndings("\n").TrimEnd('\n').Split('\n'));
    }

    [Fact]
    public void ExclusionEntryWithoutItsCommentCannotBeScanned()
    {
        using var root = StandIn($"# Generic.\n\n{Pairs}\n");
        using var dist = new TempFolder();

        var (code, lines) = Scan(root.Path, Reference, dist.Path);

        Assert.Equal(2, code);
        Assert.Equal([$"  {Leak.ExclusionsShown}:3: an entry needs a comment line directly above it saying why the line is generic", "FAIL leak"], lines);
    }

    private static (int Code, string[] Lines) Scan(string repositoryRoot, string reference, params string[] targets) =>
        Checker.Run(repositoryRoot, ["leak", Checker.SchemaFolder, Path.Combine(Pair, "content"), reference, .. targets]);

    // A repository root that holds only the given exclusion list.
    private static TempFolder StandIn(string exclusions)
    {
        var root = new TempFolder();
        root.Write(Path.Combine("tools", "SharpLadder.CodeCheck", "leak-exclusions.txt"), exclusions);
        return root;
    }
}
