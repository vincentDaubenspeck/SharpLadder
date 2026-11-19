using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace SharpLadder.CodeCheck;

// Parses a group's blocks as they will stand in its program, each behind its #line directive,
// and reads every block's shape from that tree, never from the text.
internal static class BlockLayout
{
    public static IReadOnlyList<BlockShape> Read(IReadOnlyList<SourceBlock> blocks)
    {
        var text = new StringBuilder();
        var starts = new int[blocks.Count];
        var directives = new int[blocks.Count + 1];
        for (var i = 0; i < blocks.Count; i++)
        {
            directives[i] = text.Length;
            text.Append(ProgramText.LineDirective(blocks[i].SourceLine, blocks[i].SourceFile));
            starts[i] = text.Length;
            text.Append(ProgramText.Source(blocks[i]));
        }

        directives[^1] = text.Length;
        text.Append(ProgramText.DefaultLine);
        var root = CSharpSyntaxTree.ParseText(text.ToString(), ProgramText.ParseOptions).GetCompilationUnitRoot();

        var statements = new int?[blocks.Count];
        var declarations = new int?[blocks.Count];
        var runsPast = new bool[blocks.Count];
        var lineDirectives = new bool[blocks.Count];
        foreach (var node in root.ChildNodes())
        {
            var i = BlockAt(starts, node.SpanStart);
            runsPast[i] |= node.Span.End > directives[i + 1];
            if (node is GlobalStatementSyntax)
            {
                statements[i] ??= node.SpanStart - starts[i];
            }
            else if (node is MemberDeclarationSyntax)
            {
                declarations[i] ??= node.SpanStart - starts[i];
            }
        }

        // A directive that does not parse as one where it was written sits inside a comment,
        // string or #if region left open; only a block whose own directive still stands is blamed.
        var hidden = new bool[directives.Length];
        for (var d = 1; d < directives.Length; d++)
        {
            var trivia = root.FindTrivia(directives[d]);
            hidden[d] = trivia.SpanStart != directives[d] || trivia.GetStructure() is not LineDirectiveTriviaSyntax { IsActive: true };
            runsPast[d - 1] |= hidden[d] && !hidden[d - 1];
        }

        foreach (var trivia in root.DescendantTrivia())
        {
            if ((trivia.IsKind(SyntaxKind.LineDirectiveTrivia) || trivia.IsKind(SyntaxKind.LineSpanDirectiveTrivia))
                && Array.IndexOf(directives, trivia.SpanStart) < 0)
            {
                lineDirectives[BlockAt(starts, trivia.SpanStart)] = true;
            }
        }

        return [.. Enumerable.Range(0, blocks.Count).Select(i => new BlockShape(statements[i], declarations[i], runsPast[i], lineDirectives[i]))];
    }

    private static int BlockAt(int[] starts, int position)
    {
        var i = starts.Length - 1;
        while (i > 0 && starts[i] > position)
        {
            i--;
        }

        return i;
    }
}
