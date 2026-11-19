using System.Text;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace SharpLadder.Content;

// practice/problems.yml lists every problem by number. It is generated, so the compiler only
// compares it with what the index mode prints and never reads its content.
internal static class ProblemsIndex
{
    public const string Header = "# Generated from the problem files by the content compiler's index mode; never edit it by hand.";

    private const string Command = "SharpLadder.Content index <schema folder> <content root>";

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // No problems, no file: the index mode then prints nothing.
    public static byte[] Write(IEnumerable<ProblemFile> problems)
    {
        var rows = problems.OrderBy(p => p.Number).Select(p => new Row(p.Id, p.Number, p.Link, p.Title, p.Chapter, p.Ladders)).ToList();
        if (rows.Count == 0)
        {
            return [];
        }

        var serializer = new SerializerBuilder()
            .WithNamingConvention(CamelCaseNamingConvention.Instance)
            .WithIndentedSequences()
            .WithNewLine("\n")
            .Build();
        var yaml = serializer.Serialize(new IndexFile(rows));
        return StrictUtf8.GetBytes(Header + "\n" + (yaml.EndsWith('\n') ? yaml : yaml + "\n"));
    }

    public static void Check(InputTree tree, IEnumerable<ProblemFile> problems, List<Diagnostic> diagnostics)
    {
        var practice = tree.Children(string.Empty).FirstOrDefault(e => e.IsFolder && string.Equals(e.Name, RootAdmission.PracticeFolder, StringComparison.Ordinal));
        if (practice is null)
        {
            return;
        }

        var expected = Write(problems);
        var entry = tree.Children(practice.Relative).FirstOrDefault(e => !e.IsFolder && string.Equals(e.Name, RootAdmission.ProblemsIndex, StringComparison.Ordinal));
        var display = entry?.Display ?? practice.Display + "/" + RootAdmission.ProblemsIndex;
        if (entry is null && expected.Length > 0)
        {
            diagnostics.Add(new Diagnostic(display, null, $"the problem index is missing; write the output of {Command} to it"));
        }
        else if (entry is not null && expected.Length == 0)
        {
            diagnostics.Add(new Diagnostic(display, null, $"no problem file exists, so {Command} prints nothing; delete this file"));
        }
        else if (entry is not null && !entry.Bytes!.AsSpan().SequenceEqual(expected))
        {
            diagnostics.Add(new Diagnostic(display, null, $"the problem index differs from the problem files; write the output of {Command} to it"));
        }
    }

    private sealed record IndexFile(IReadOnlyList<Row> Problems);

    private sealed record Row(
        [property: YamlMember(Order = 0)] string Id,
        [property: YamlMember(Order = 1)] int Number,
        [property: YamlMember(Order = 2)] string Link,
        [property: YamlMember(Order = 3)] string Title,
        [property: YamlMember(Order = 4)] string Chapter,
        [property: YamlMember(Order = 5)] IReadOnlyList<string> Ladders);
}
