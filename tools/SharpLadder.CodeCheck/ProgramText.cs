using System.Buffers;
using System.Globalization;
using Microsoft.CodeAnalysis.CSharp;

namespace SharpLadder.CodeCheck;

internal static class ProgramText
{
    public const string DefaultLine = "#line default\n";

    // A #line file name has no escapes: a quote or any C# line break would end it early.
    private static readonly SearchValues<char> Unwritable = SearchValues.Create(['"', '\r', '\n', (char)0x85, (char)0x2028, (char)0x2029]);

    public static CSharpParseOptions ParseOptions { get; } = new(LanguageVersion.CSharp14);

    // A name the directive cannot hold is refused, never altered.
    public static string LineDirective(int line, string file)
    {
        if (file.Length == 0 || file.AsSpan().ContainsAny(Unwritable))
        {
            throw new ToolProblem($"{file}: this path cannot be written in a #line directive");
        }

        return string.Create(CultureInfo.InvariantCulture, $"#line {line} \"{file}\"\n");
    }

    public static string Source(SourceBlock block) =>
        block.Source.Length == 0 || block.Source.EndsWith('\n') ? block.Source : block.Source + "\n";

    public static string Literal(string value) => SyntaxFactory.Literal(value).Text;
}
