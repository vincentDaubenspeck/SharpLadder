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

// One compilation per group: its Program.cs, the global usings and, for a group that runs, the
// harness, at C# 14 against the pinned reference set only. No analyzer and no source generator is
// ever loaded, so a snippet that needs a generator fails to compile like any other broken block.
internal sealed class GroupCompiler
{
    private const string AssemblyName = "SharpLadderCodeGroup";
    private const string ModuleInitializer = "global::System.Runtime.CompilerServices.ModuleInitializerAttribute";

    // The generated trees name these from the global namespace down.
    private static readonly string[] ReservedRoots = [GeneratedNames.Harness, "System"];

    // A fail group compiles without the harness, so only the global usings can meet a content name.
    private static readonly string[] CompileOnlyRoots = ["System"];

    private static readonly EmitOptions Embedded = new(debugInformationFormat: DebugInformationFormat.Embedded);

    private readonly ImmutableArray<MetadataReference> _references;
    private readonly string _harness;

    public GroupCompiler(ImmutableArray<MetadataReference> references)
        : this(references, HarnessSource.Text)
    {
    }

    // Tests reach the harness variant here, through InternalsVisibleTo only.
    internal GroupCompiler(ImmutableArray<MetadataReference> references, string harness)
    {
        // Without the pinned set nothing is compiled, never against the running framework instead.
        if (references.IsDefaultOrEmpty)
        {
            throw new ToolProblem("no reference set is loaded, so no code group can be compiled");
        }

        _references = references;
        _harness = harness;
    }

    public static CSharpCompilationOptions Options { get; } = new(
        OutputKind.ConsoleApplication,
        optimizationLevel: OptimizationLevel.Debug,
        warningLevel: 10,
        deterministic: true,
        nullableContextOptions: NullableContextOptions.Enable);

    // The group's three trees; the checker always parses them with ProgramText.ParseOptions.
    public static ImmutableArray<SyntaxTree> Trees(string programText, CSharpParseOptions options, string? harness = null) =>
    [
        Parse(programText, GeneratedNames.ProgramFile, options),
        Parse(GlobalUsingsSource.Text, GlobalUsingsSource.FileName, options),
        Parse(harness ?? HarnessSource.Text, HarnessSource.FileName, options),
    ];

    public CompileOutcome Compile(GroupProgram program)
    {
        if (program.Blocks[0].Fail is { } expected)
        {
            return CompileOnly(program, expected);
        }

        var trees = Trees(program.Text, ProgramText.ParseOptions, _harness);
        var root = trees[0].GetCompilationUnitRoot();
        var compilation = CSharpCompilation.Create(AssemblyName, trees, _references, Options);
        using var image = new MemoryStream();
        var emitted = compilation.Emit(image, options: Embedded);
        var errors = Errors(emitted, root.SyntaxTree);

        var failures = new List<CodeFailure>();
        var generated = new List<Diagnostic>();
        foreach (var error in errors)
        {
            if (ContentError(program, root, error) is { } failure)
            {
                failures.Add(failure);
            }
            else
            {
                generated.Add(error);
            }
        }

        if (generated.Count > 0)
        {
            failures.AddRange(CollisionsOrToolProblem(program, root, generated[0], ReservedRoots));
        }

        var model = compilation.GetSemanticModel(root.SyntaxTree);
        failures.AddRange(ModuleInitializers(program, root, model));
        if (failures.Count > 0)
        {
            return new CompileOutcome([.. failures.Distinct()], null);
        }

        if (!emitted.Success)
        {
            throw new ToolProblem($"group \"{program.Key.Group}\" of {program.Key.DocumentId}: no assembly was emitted, yet no error was reported");
        }

        return new CompileOutcome([], new CompiledGroup(program, ImmutableCollectionsMarshal.AsImmutableArray(image.ToArray()), Expectation(program, root, model)));
    }

    private static SyntaxTree Parse(string text, string path, CSharpParseOptions options) =>
        CSharpSyntaxTree.ParseText(SourceText.From(text, Encoding.UTF8), options, path);

    // A fixed order, so the same group always names the same first error.
    private static List<Diagnostic> Errors(EmitResult emitted, SyntaxTree program) =>
    [
        .. emitted.Diagnostics
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .OrderBy(d => d.Location.SourceTree == program ? 0 : 1)
            .ThenBy(d => d.Location.SourceSpan.Start)
            .ThenBy(d => d.Id, StringComparer.Ordinal),
    ];

    // An error in generated code is a content collision when one is found, else the tool's fault.
    private static List<CodeFailure> CollisionsOrToolProblem(GroupProgram program, CompilationUnitSyntax root, Diagnostic first, string[] roots)
    {
        var collisions = Collisions(program, root, roots);
        if (collisions.Count == 0)
        {
            throw new ToolProblem($"group \"{program.Key.Group}\" of {program.Key.DocumentId}: the checker's generated code does not compile ({first.Id}: {first.GetMessage(CultureInfo.InvariantCulture)})");
        }

        return collisions;
    }

    private static CompileOutcome FailVerdict(SourceBlock block, string expected, List<Diagnostic> errors)
    {
        var ids = errors.Select(e => e.Id).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
        if (ids.Count == 1 && string.Equals(ids[0], expected, StringComparison.Ordinal))
        {
            return new CompileOutcome([], null);
        }

        var reason = ids.Count == 0
            ? $"has fail={expected}, but it compiles without an error"
            : $"has fail={expected}, but its errors are {string.Join(", ", ids)}";
        return new CompileOutcome([CodeFailure.At(block, reason)], null);
    }

    // Null when the error lies in generated code: a tool failure unless content collides with it.
    private static CodeFailure? ContentError(GroupProgram program, CompilationUnitSyntax root, Diagnostic error)
    {
        if (error.Location.SourceTree != root.SyntaxTree)
        {
            return null;
        }

        var position = error.Location.SourceSpan.Start;
        var span = SpanAt(program, position);
        if (span.Block is not { } block)
        {
            return null;
        }

        var reason = $"error {error.Id}: {error.GetMessage(CultureInfo.InvariantCulture)}";
        return span.Kind switch
        {
            SpanKind.Source => new CodeFailure(block.SourceFile, error.Location.GetMappedLineSpan().StartLinePosition.Line + 1, block.BlockId, reason),
            SpanKind.Check or SpanKind.ExpectedType => CodeFailure.At(block, reason),
            SpanKind.Marker or SpanKind.CheckWrapper when InCheckOrType(root, position) => CodeFailure.At(block, reason),
            _ => null,
        };
    }

    // A check's condition and a throws type sit inside generated calls; an error there is the block's.
    private static bool InCheckOrType(CompilationUnitSyntax root, int position) =>
        root.FindToken(position).Parent?.AncestorsAndSelf().Any(n => n is TypeOfExpressionSyntax || (n.Parent is IfStatementSyntax s && s.Condition == n)) == true;

    private static List<CodeFailure> Collisions(GroupProgram program, CompilationUnitSyntax root, string[] roots)
    {
        var failures = new List<CodeFailure>();
        foreach (var member in root.Members)
        {
            var name = member switch
            {
                BaseNamespaceDeclarationSyntax space => space.Name.DescendantNodesAndSelf().OfType<IdentifierNameSyntax>().First().Identifier.ValueText,
                BaseTypeDeclarationSyntax type => type.Identifier.ValueText,
                DelegateDeclarationSyntax type => type.Identifier.ValueText,
                _ => null,
            };
            if (name is not null && roots.Contains(name, StringComparer.Ordinal) && SpanAt(program, member.SpanStart) is { Kind: SpanKind.Source, Block: { } block })
            {
                var line = root.SyntaxTree.GetMappedLineSpan(member.Span).StartLinePosition.Line + 1;
                failures.Add(new CodeFailure(block.SourceFile, line, block.BlockId, $"declares {name} in the global namespace, which the checker's generated code uses"));
            }
        }

        return failures;
    }

    // Resolved, not matched by text: an alias or a qualified name is refused the same way.
    private static List<CodeFailure> ModuleInitializers(GroupProgram program, CompilationUnitSyntax root, SemanticModel model)
    {
        var failures = new List<CodeFailure>();
        foreach (var attribute in root.DescendantNodes().OfType<AttributeSyntax>())
        {
            var info = model.GetSymbolInfo(attribute);
            var type = (info.Symbol ?? info.CandidateSymbols.FirstOrDefault())?.ContainingType;
            if (type is not null
                && string.Equals(type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat), ModuleInitializer, StringComparison.Ordinal)
                && SpanAt(program, attribute.SpanStart).Block is { } block)
            {
                failures.Add(CodeFailure.At(block, "applies ModuleInitializerAttribute, which the code check refuses: the checker's start-up must run before any content"));
            }
        }

        return failures;
    }

    private static ThrowsExpectation? Expectation(GroupProgram program, CompilationUnitSyntax root, SemanticModel model)
    {
        if (program.ThrowsBlock is not { } block)
        {
            return null;
        }

        // A block with no statement and no check gets no marker; it cannot throw, so its run fails.
        var written = program.Spans.FirstOrDefault(s => s.Kind == SpanKind.ExpectedType && s.Block == block);
        if (written is null)
        {
            return new ThrowsExpectation(block, block.Throws ?? string.Empty, null);
        }

        var typeOf = root.FindNode(new TextSpan(written.Start, written.Length)).FirstAncestorOrSelf<TypeOfExpressionSyntax>();
        var type = typeOf is null ? null : model.GetTypeInfo(typeOf.Type).Type;
        if (type is null || type.TypeKind == TypeKind.Error)
        {
            throw new ToolProblem($"group \"{program.Key.Group}\" of {program.Key.DocumentId}: the throws type compiled, yet it does not resolve");
        }

        return new ThrowsExpectation(block, type.ToDisplayString(), type.ContainingAssembly?.Name);
    }

    private static ProgramSpan SpanAt(GroupProgram program, int position) => program.Spans.Last(s => s.Start <= position);

    // A fail group never runs, so it compiles once without the harness: no generated code can add an
    // error to it or take one in. Statements make it a program and types alone a library, read from
    // the parsed tree, so a block is never given an entry-point error that is not its own.
    private CompileOutcome CompileOnly(GroupProgram program, string expected)
    {
        var source = Parse(program.Text, GeneratedNames.ProgramFile, ProgramText.ParseOptions);
        var root = source.GetCompilationUnitRoot();
        var kind = root.Members.Any(m => m is GlobalStatementSyntax) ? OutputKind.ConsoleApplication : OutputKind.DynamicallyLinkedLibrary;
        var usings = Parse(GlobalUsingsSource.Text, GlobalUsingsSource.FileName, ProgramText.ParseOptions);
        var compilation = CSharpCompilation.Create(AssemblyName, [source, usings], _references, Options.WithOutputKind(kind));
        using var image = new MemoryStream();
        var errors = Errors(compilation.Emit(image, options: Embedded), source);

        // Only an error in the block's own source can meet its fail; any other one fails the group.
        if (errors.Find(e => e.Location.SourceTree is null) is { } unplaced)
        {
            throw new ToolProblem($"group \"{program.Key.Group}\" of {program.Key.DocumentId}: the compiler reported an error with no source location ({unplaced.Id}: {unplaced.GetMessage(CultureInfo.InvariantCulture)})");
        }

        // A collision fails the group whatever it names, so the block's own errors are reported with it.
        if (errors.Find(e => e.Location.SourceTree != source) is { } outside)
        {
            var collisions = CollisionsOrToolProblem(program, root, outside, CompileOnlyRoots);
            var block = program.Blocks[0];
            List<CodeFailure> failures =
            [
                .. errors
                    .Where(e => e.Location.SourceTree == source)
                    .Select(e => ContentError(program, root, e) ?? CodeFailure.At(block, $"error {e.Id}: {e.GetMessage(CultureInfo.InvariantCulture)}")),
                .. collisions,
            ];
            return new CompileOutcome([.. failures.Distinct()], null);
        }

        return FailVerdict(program.Blocks[0], expected, errors);
    }
}
