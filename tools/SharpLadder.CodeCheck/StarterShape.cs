using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace SharpLadder.CodeCheck;

// A starter is a stub (PD 4.7): it declares what the learner fills in and runs nothing of its own.
// So the tree holds only using directives, namespaces and types; every member with a body throws
// System.NotImplementedException and does nothing else; nothing runs at load or construction.
internal static class StarterShape
{
    private const string Stub = "throw new NotImplementedException()";

    // Each place where the starter is more than a stub, by its 1-based line in the starter; empty
    // when it is one. The model is the starter's tree in the starter and suite compilation, so the
    // thrown type is bound, never matched by name.
    public static IReadOnlyList<(int Line, string Reason)> Problems(SemanticModel model)
    {
        var expected = model.Compilation.GetTypeByMetadataName("System.NotImplementedException")
            ?? throw new ToolProblem("System.NotImplementedException is not in the reference set");
        var problems = new List<(int Line, string Reason)>();
        var root = (CompilationUnitSyntax)model.SyntaxTree.GetRoot();
        foreach (var alias in root.Externs)
        {
            Add(problems, alias, "an extern alias is not accepted in a starter");
        }

        foreach (var attributes in root.AttributeLists)
        {
            Add(problems, attributes, "an assembly or module attribute is not accepted in a starter");
        }

        foreach (var member in root.Members)
        {
            Member(model, expected, member, problems);
        }

        return problems;
    }

    private static void Member(SemanticModel model, INamedTypeSymbol expected, MemberDeclarationSyntax member, List<(int Line, string Reason)> problems)
    {
        switch (member)
        {
            case BaseNamespaceDeclarationSyntax space:
                foreach (var inner in space.Members)
                {
                    Member(model, expected, inner, problems);
                }

                break;
            case TypeDeclarationSyntax type:
                // A base type's arguments run when an instance is made.
                if (type.BaseList?.Types.OfType<PrimaryConstructorBaseTypeSyntax>().FirstOrDefault() is { } call)
                {
                    Add(problems, call, $"{Name(model, type)} passes arguments to its base type; a starter runs nothing");
                }

                foreach (var inner in type.Members)
                {
                    Member(model, expected, inner, problems);
                }

                break;
            case EnumDeclarationSyntax values:
                foreach (var value in values.Members.Where(v => v.EqualsValue is not null))
                {
                    Initializer(model, value, problems);
                }

                break;
            case DelegateDeclarationSyntax:
                break;
            case BaseFieldDeclarationSyntax field:
                foreach (var variable in field.Declaration.Variables.Where(v => v.Initializer is not null))
                {
                    Initializer(model, variable, problems);
                }

                break;
            case BasePropertyDeclarationSyntax property:
                Property(model, expected, property, problems);
                break;
            case BaseMethodDeclarationSyntax method:
                if (method is ConstructorDeclarationSyntax { Initializer: { } chained })
                {
                    Add(problems, chained, $"{Name(model, method)} calls another constructor; a starter runs nothing");
                }

                Body(model, expected, method, method.Body, method.ExpressionBody, problems);
                break;
            case GlobalStatementSyntax:
                Add(problems, member, "a statement outside a type is not accepted in a starter");
                break;
            default:
                Add(problems, member, $"a {member.Kind()} is not accepted in a starter");
                break;
        }
    }

    private static void Property(SemanticModel model, INamedTypeSymbol expected, BasePropertyDeclarationSyntax property, List<(int Line, string Reason)> problems)
    {
        switch (property)
        {
            case PropertyDeclarationSyntax { Initializer: not null } initialized:
                Initializer(model, initialized, problems);
                break;
            case PropertyDeclarationSyntax { ExpressionBody: { } arrow }:
                Body(model, expected, property, null, arrow, problems);
                break;
            case IndexerDeclarationSyntax { ExpressionBody: { } arrow }:
                Body(model, expected, property, null, arrow, problems);
                break;
        }

        foreach (var accessor in property.AccessorList?.Accessors ?? default)
        {
            Body(model, expected, accessor, accessor.Body, accessor.ExpressionBody, problems);
        }
    }

    // A bodiless member passes; a body must be exactly the stub's throw, with literal arguments only.
    private static void Body(SemanticModel model, INamedTypeSymbol expected, SyntaxNode owner, BlockSyntax? block, ArrowExpressionClauseSyntax? arrow, List<(int Line, string Reason)> problems)
    {
        if (block is null && arrow is null)
        {
            return;
        }

        var thrown = (block, arrow) switch
        {
            ({ Statements: [ThrowStatementSyntax { Expression: { } statement }] }, null) => statement,
            (null, { Expression: ThrowExpressionSyntax { Expression: var expression } }) => expression,
            _ => null,
        };
        if (thrown is not ObjectCreationExpressionSyntax { Initializer: null } creation
            || creation.ArgumentList?.Arguments.Any(a => a.NameColon is not null || a.RefKindKeyword.IsKind(SyntaxKind.None) is false || a.Expression is not LiteralExpressionSyntax) is true)
        {
            Add(problems, owner, $"{Name(model, owner)} must have only {Stub} as its body");
            return;
        }

        if (model.GetTypeInfo(creation).Type is var type && !SymbolEqualityComparer.Default.Equals(type, expected))
        {
            Add(problems, owner, $"{Name(model, owner)} throws {type?.ToDisplayString() ?? "an unknown type"}, not System.NotImplementedException");
        }
    }

    private static void Initializer(SemanticModel model, SyntaxNode declared, List<(int Line, string Reason)> problems) =>
        Add(problems, declared, $"{Name(model, declared)} has an initializer; a starter runs nothing");

    private static string Name(SemanticModel model, SyntaxNode node) =>
        model.GetDeclaredSymbol(node)?.ToDisplayString() ?? node.Kind().ToString();

    private static void Add(List<(int Line, string Reason)> problems, SyntaxNode node, string reason) =>
        problems.Add((node.GetLocation().GetLineSpan().StartLinePosition.Line + 1, reason));
}
