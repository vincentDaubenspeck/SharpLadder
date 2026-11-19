using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace SharpLadder.CodeCheck;

// Writes one group's Program.cs: its blocks as top-level statements in document order, nothing
// hoisted, wrapped or moved to another scope, a #line directive before each block and each check,
// and the marker, check and end-record calls at positions read from the parsed group. A fail group
// holds its one block behind its #line directive and nothing generated.
internal sealed class ProgramGenerator
{
    private const string Call = "global::" + GeneratedNames.Harness + ".";

    private readonly StringBuilder _text = new();
    private readonly List<ProgramSpan> _spans = [];
    private readonly List<Placed> _placed = [];

    private ProgramGenerator()
    {
    }

    // Null when a rule is broken; every broken rule is added to failures.
    public static GroupProgram? Generate(GroupKey key, IReadOnlyList<SourceBlock> blocks, List<CodeFailure> failures)
    {
        var shapes = BlockLayout.Read(blocks);
        var before = failures.Count;
        GroupRules.Check(key, blocks, shapes, failures);
        if (failures.Count > before)
        {
            return null;
        }

        var writer = new ProgramGenerator();
        if (blocks[0].Fail is null)
        {
            writer.Write(blocks, shapes);
        }
        else
        {
            writer.WriteCompileOnly(blocks[0]);
        }

        var text = writer._text.ToString();
        var tree = CSharpSyntaxTree.ParseText(text, ProgramText.ParseOptions);
        var root = tree.GetCompilationUnitRoot();
        writer.VerifyContentText(root, failures);
        if (failures.Count > before)
        {
            return null;
        }

        // A misplaced call is the generator's fault, never the content's.
        if (writer._placed.Exists(p => Statement(root, p) is null))
        {
            throw new ToolProblem($"group \"{key.Group}\" of {key.DocumentId}: a generated call is not a top-level statement where it was placed");
        }

        writer.VerifyMapping(key, tree);
        return new GroupProgram(
            key,
            blocks[0].Approach,
            text,
            blocks,
            writer._spans,
            [.. blocks.Where(b => b.Check is not null).Select(b => b.BlockId)],
            blocks[^1].Throws is null ? null : blocks[^1]);
    }

    // The top-level statement that starts and ends exactly where the generator put it, or null.
    private static GlobalStatementSyntax? Statement(CompilationUnitSyntax root, Placed placed)
    {
        var statement = root.FindToken(placed.Start).Parent?.FirstAncestorOrSelf<GlobalStatementSyntax>();
        return statement is not null && statement.Parent == root && statement.Span.Start == placed.Start && statement.Span.End == placed.End
            ? statement
            : null;
    }

    private static bool Encloses(SyntaxToken open, SyntaxToken close, Placed placed) =>
        !open.IsMissing && !close.IsMissing && open.Span.End == placed.InnerStart && close.SpanStart == placed.InnerEnd;

    private void Write(IReadOnlyList<SourceBlock> blocks, IReadOnlyList<BlockShape> shapes)
    {
        var declaring = Enumerable.Range(0, shapes.Count).FirstOrDefault(i => shapes[i].Declares, -1);
        for (var i = 0; i < blocks.Count; i++)
        {
            var block = blocks[i];
            var shape = shapes[i];
            var source = ProgramText.Source(block);
            Add(SpanKind.Directive, block, ProgramText.LineDirective(block.SourceLine, block.SourceFile));

            // No marker after a type declaration: there only the type-only tail may follow.
            var marker = shape.FirstStatement is int first && (declaring < 0 || i < declaring || (i == declaring && first < shape.FirstDeclaration))
                ? first
                : (int?)null;
            var end = i == declaring ? shape.FirstDeclaration : null;
            var cut = 0;
            if (marker is int at)
            {
                Add(SpanKind.Source, block, source[cut..at]);
                Marker(block);
                cut = at;
            }

            if (end is int endAt)
            {
                Add(SpanKind.Source, block, source[cut..endAt]);
                EndRecord(" ");
                cut = endAt;
            }

            Add(SpanKind.Source, block, source[cut..]);
            if (block.Check is { } check)
            {
                Add(SpanKind.Directive, block, ProgramText.LineDirective(block.FenceLine, block.SourceFile));

                // A block without a statement still owns its check.
                if (marker is null)
                {
                    Marker(block);
                }

                CheckLine(block, check);
            }
        }

        Add(SpanKind.Directive, null, ProgramText.DefaultLine);
        if (declaring < 0)
        {
            EndRecord("\n");
        }
    }

    // A fail group never runs: with nothing generated after its source, code it leaves open can only
    // reach the end of the file, so every error it gives is its own.
    private void WriteCompileOnly(SourceBlock block)
    {
        Add(SpanKind.Directive, block, ProgramText.LineDirective(block.SourceLine, block.SourceFile));
        Add(SpanKind.Source, block, block.Source);
    }

    private void Marker(SourceBlock block)
    {
        var start = _text.Length;
        Add(SpanKind.Marker, block, Call + GeneratedNames.Enter + "(" + ProgramText.Literal(block.BlockId));
        var (inner, innerEnd) = (-1, -1);
        if (block.Throws is { } type)
        {
            Add(SpanKind.Marker, block, ", typeof(");
            inner = _text.Length;
            Add(SpanKind.ExpectedType, block, type);
            innerEnd = _text.Length;
            Add(SpanKind.Marker, block, ")");
        }

        Add(SpanKind.Marker, block, ");");
        _placed.Add(new Placed(SpanKind.Marker, start, _text.Length, block, inner, innerEnd));
        Add(SpanKind.Marker, block, " ");
    }

    private void CheckLine(SourceBlock block, string check)
    {
        var id = ProgramText.Literal(block.BlockId);
        var start = _text.Length;
        Add(SpanKind.CheckWrapper, block, "if (!(");
        var inner = _text.Length;
        Add(SpanKind.Check, block, check);
        var innerEnd = _text.Length;
        Add(SpanKind.CheckWrapper, block, ")) " + Call + GeneratedNames.CheckFailed + "(" + id + ");");
        _placed.Add(new Placed(SpanKind.Check, start, _text.Length, block, inner, innerEnd));
        Add(SpanKind.CheckWrapper, block, " ");
        var passed = _text.Length;
        Add(SpanKind.CheckWrapper, block, Call + GeneratedNames.CheckPassed + "(" + id + ");");
        _placed.Add(new Placed(SpanKind.CheckWrapper, passed, _text.Length, block, -1, -1));
        Add(SpanKind.CheckWrapper, block, "\n");
    }

    private void EndRecord(string after)
    {
        var start = _text.Length;
        Add(SpanKind.EndRecord, null, Call + GeneratedNames.End + "();");
        _placed.Add(new Placed(SpanKind.EndRecord, start, _text.Length, null, -1, -1));
        Add(SpanKind.EndRecord, null, after);
    }

    private void Add(SpanKind kind, SourceBlock? block, string text)
    {
        if (text.Length > 0)
        {
            _spans.Add(new ProgramSpan(_text.Length, text.Length, kind, block));
            _text.Append(text);
        }
    }

    // A check or throws text that does not stay inside its parentheses is the block's fault.
    private void VerifyContentText(CompilationUnitSyntax root, List<CodeFailure> failures)
    {
        foreach (var placed in _placed.Where(p => p.InnerStart >= 0))
        {
            var statement = Statement(root, placed);
            if (placed.Kind == SpanKind.Check)
            {
                if (statement?.Statement is not IfStatementSyntax { Else: null, Condition: PrefixUnaryExpressionSyntax { Operand: ParenthesizedExpressionSyntax inner } }
                    || !Encloses(inner.OpenParenToken, inner.CloseParenToken, placed))
                {
                    failures.Add(CodeFailure.At(placed.Block!, "has a check that is not one C# expression"));
                }
            }
            else if (statement is null
                || root.FindToken(placed.InnerStart - 1).Parent is not TypeOfExpressionSyntax typeOf
                || !Encloses(typeOf.OpenParenToken, typeOf.CloseParenToken, placed))
            {
                failures.Add(CodeFailure.At(placed.Block!, "has a throws value that is not one type name"));
            }
        }
    }

    // Each copied line maps to its block's file and line, each check line to the block's fence.
    private void VerifyMapping(GroupKey key, SyntaxTree tree)
    {
        var root = tree.GetCompilationUnitRoot();
        var lines = tree.GetText().Lines;
        var firstLines = new Dictionary<SourceBlock, int>();
        foreach (var span in _spans.Where(s => s.Kind is SpanKind.Source or SpanKind.CheckWrapper))
        {
            var block = span.Block!;
            if (span.Kind == SpanKind.Source)
            {
                firstLines.TryAdd(block, lines.GetLineFromPosition(span.Start).LineNumber);
            }

            var token = root.FindToken(span.Start);
            if (token.SpanStart < span.Start || token.SpanStart >= span.Start + span.Length)
            {
                continue;
            }

            var expected = span.Kind == SpanKind.CheckWrapper
                ? block.FenceLine
                : block.SourceLine + lines.GetLineFromPosition(token.SpanStart).LineNumber - firstLines[block];
            var mapped = tree.GetMappedLineSpan(token.Span);
            if (!mapped.HasMappedPath || !string.Equals(mapped.Path, block.SourceFile, StringComparison.Ordinal) || mapped.StartLinePosition.Line + 1 != expected)
            {
                throw new ToolProblem($"group \"{key.Group}\" of {key.DocumentId}: the generated program does not map a line to its block's source");
            }
        }
    }

    // A generated statement's exact span; Inner is the check or throws text inside it, if any.
    private sealed record Placed(SpanKind Kind, int Start, int End, SourceBlock? Block, int InnerStart, int InnerEnd);
}
