using System.Collections.Immutable;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Emit;
using Microsoft.CodeAnalysis.Text;

namespace SharpLadder.CodeCheck;

// One compilation per suite run: the suite, one solution and the suite start-up, at C# 14 against
// the pinned reference set only. Suites and solutions write their own using directives, so no global
// usings are added; no analyzer or source generator is ever loaded.
internal sealed class SuiteCompiler
{
    // The name the run folder gives the image, so the runtime finds the assembly it expects.
    private const string AssemblyName = "SharpLadderCodeGroup";
    private const string ModuleInitializer = "global::System.Runtime.CompilerServices.ModuleInitializerAttribute";

    // The start-up names these from the global namespace down.
    private static readonly string[] ReservedRoots = [GeneratedNames.Harness, "System"];

    private static readonly EmitOptions Embedded = new(debugInformationFormat: DebugInformationFormat.Embedded);

    private readonly ImmutableArray<MetadataReference> _references;

    public SuiteCompiler(ImmutableArray<MetadataReference> references)
    {
        // Without the pinned set nothing is compiled, never against the running framework instead.
        if (references.IsDefaultOrEmpty)
        {
            throw new ToolProblem("no reference set is loaded, so no suite can be compiled");
        }

        _references = references;
    }

    public SuiteBuild Compile(SuitePlan plan, SuiteSolution solution)
    {
        var suite = Parse(plan.Suite, plan.SuiteFile);
        var code = Parse(solution.Text, solution.Name);
        var start = Parse(SuiteStartSource.Text, SuiteStartSource.FileName);
        var compilation = CSharpCompilation.Create(AssemblyName, [suite, code, start], _references, GroupCompiler.Options);
        using var image = new MemoryStream();
        var emitted = compilation.Emit(image, options: Embedded);
        var model = compilation.GetSemanticModel(code);

        var failures = new List<string>();
        Diagnostic? generated = null;
        foreach (var error in Errors(emitted, suite, code))
        {
            var reason = $"error {error.Id}: {error.GetMessage(CultureInfo.InvariantCulture)}";
            if (error.Location.SourceTree == code)
            {
                failures.Add($"{solution.Place(Line(error))}: {reason}");
            }
            else if (error.Location.SourceTree == suite)
            {
                failures.Add($"{plan.SuiteFile}:{Line(error).ToString(CultureInfo.InvariantCulture)}: {reason} (compiled with {solution.Name})");
            }
            else if (error.Location.SourceTree is null)
            {
                // An entry point missing or doubled is the content's, which is two whole files.
                failures.Add($"{plan.SuiteFile}: {reason} (compiled with {solution.Name})");
            }
            else
            {
                generated ??= error;
            }
        }

        if (generated is not null)
        {
            failures.AddRange(CollisionsOrToolProblem(plan, solution, suite, code, generated));
        }

        failures.AddRange(ModuleInitializers(plan, solution, compilation, suite, code));
        if (failures.Count > 0)
        {
            return new SuiteBuild([.. failures.Distinct(StringComparer.Ordinal)], default, model);
        }

        if (!emitted.Success)
        {
            throw new ToolProblem($"{solution.Name}: no assembly was emitted, yet no error was reported");
        }

        return new SuiteBuild([], ImmutableCollectionsMarshal.AsImmutableArray(image.ToArray()), model);
    }

    private static SyntaxTree Parse(string text, string path) =>
        CSharpSyntaxTree.ParseText(SourceText.From(text, Encoding.UTF8), ProgramText.ParseOptions, path);

    private static int Line(Diagnostic error) => error.Location.GetLineSpan().StartLinePosition.Line + 1;

    // A fixed order, so the same run always names the same errors in the same order.
    private static List<Diagnostic> Errors(EmitResult emitted, SyntaxTree suite, SyntaxTree code) =>
    [
        .. emitted.Diagnostics
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .OrderBy(d => d.Location.SourceTree == suite ? 0 : d.Location.SourceTree == code ? 1 : 2)
            .ThenBy(d => d.Location.SourceSpan.Start)
            .ThenBy(d => d.Id, StringComparer.Ordinal),
    ];

    // An error in the start-up is a content collision when one is found, else the tool's fault.
    private static List<string> CollisionsOrToolProblem(SuitePlan plan, SuiteSolution solution, SyntaxTree suite, SyntaxTree code, Diagnostic first)
    {
        List<string> collisions =
        [
            .. Collisions(suite, line => $"{plan.SuiteFile}:{line.ToString(CultureInfo.InvariantCulture)}"),
            .. Collisions(code, solution.Place),
        ];
        if (collisions.Count == 0)
        {
            throw new ToolProblem($"{solution.Name}: the checker's generated code does not compile ({first.Id}: {first.GetMessage(CultureInfo.InvariantCulture)})");
        }

        return collisions;
    }

    private static IEnumerable<string> Collisions(SyntaxTree tree, Func<int, string> place)
    {
        foreach (var member in tree.GetCompilationUnitRoot().Members)
        {
            var name = member switch
            {
                BaseNamespaceDeclarationSyntax space => space.Name.DescendantNodesAndSelf().OfType<IdentifierNameSyntax>().First().Identifier.ValueText,
                BaseTypeDeclarationSyntax type => type.Identifier.ValueText,
                DelegateDeclarationSyntax type => type.Identifier.ValueText,
                _ => null,
            };
            if (name is not null && ReservedRoots.Contains(name, StringComparer.Ordinal))
            {
                var line = tree.GetLineSpan(member.Span).StartLinePosition.Line + 1;
                yield return $"{place(line)}: declares {name} in the global namespace, which the checker's generated code uses";
            }
        }
    }

    // Resolved, not matched by text: an alias or a qualified name is refused the same way.
    private static List<string> ModuleInitializers(SuitePlan plan, SuiteSolution solution, CSharpCompilation compilation, SyntaxTree suite, SyntaxTree code)
    {
        var failures = new List<string>();
        foreach (var (tree, place) in new (SyntaxTree, Func<int, string>)[] { (suite, line => $"{plan.SuiteFile}:{line.ToString(CultureInfo.InvariantCulture)}"), (code, solution.Place) })
        {
            var model = compilation.GetSemanticModel(tree);
            foreach (var attribute in tree.GetCompilationUnitRoot().DescendantNodes().OfType<AttributeSyntax>())
            {
                var info = model.GetSymbolInfo(attribute);
                var type = (info.Symbol ?? info.CandidateSymbols.FirstOrDefault())?.ContainingType;
                if (type is not null && string.Equals(type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat), ModuleInitializer, StringComparison.Ordinal))
                {
                    var line = tree.GetLineSpan(attribute.Span).StartLinePosition.Line + 1;
                    failures.Add($"{place(line)}: applies ModuleInitializerAttribute, which the code check refuses: the checker's start-up must run before any content");
                }
            }
        }

        return failures;
    }
}
