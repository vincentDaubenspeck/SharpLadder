using System.Globalization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;

namespace SharpLadder.Policy;

// Every pragma and suppression attribute must carry an AnalyzerPolicy record for its own ID.
// Files are read through the projects' own compilations, and anything the check cannot
// read or bind fails rather than being skipped.
internal static class SuppressionCheck
{
    private const string RecordDelimiter = "// ";

    private static readonly string[] AttributeTypes =
    [
        "System.Diagnostics.CodeAnalysis.SuppressMessageAttribute",
        "System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessageAttribute",
    ];

    internal static async Task<IReadOnlyList<string>> RunAsync(string host, string solutionPath, IReadOnlyList<string> tracked)
    {
        var root = Path.GetDirectoryName(solutionPath)!;
        var problems = new List<string>();
        var loadFailures = new System.Collections.Concurrent.ConcurrentQueue<string>();
        using var workspace = MSBuildWorkspace.Create();
        using var handler = workspace.RegisterWorkspaceFailedHandler(e =>
        {
            if (e.Diagnostic.Kind == WorkspaceDiagnosticKind.Failure)
            {
                loadFailures.Enqueue("project load failed: " + e.Diagnostic.Message);
            }
        });
        Solution solution;
        try
        {
            solution = await workspace.OpenSolutionAsync(solutionPath).ConfigureAwait(false);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException)
        {
            problems.AddRange(loadFailures);
            problems.Add(Relative(root, solutionPath) + ": does not load: " + e.Message);
            return problems;
        }

        if (!solution.Projects.Any())
        {
            problems.Add(Relative(root, solutionPath) + ": no projects loaded");
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var restore = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var project in solution.Projects)
        {
            var name = Relative(root, project.FilePath ?? project.Name);
            if (Unrestored(host, project, name, restore) is { } unrestored)
            {
                // Its files belong to a project, so they fail through this line, not as unseen.
                problems.Add(unrestored);
                seen.UnionWith(project.Documents.Select(d => d.FilePath).OfType<string>().Select(Path.GetFullPath));
                continue;
            }

            if (await project.GetCompilationAsync().ConfigureAwait(false) is not CSharpCompilation compilation)
            {
                problems.Add(name + ": no C# compilation");
                continue;
            }

            Scan(root, project, compilation, seen, problems);
        }

        problems.InsertRange(0, loadFailures);
        problems.AddRange(tracked
            .Where(t => !seen.Contains(Path.GetFullPath(Path.Combine(root, t))))
            .Select(t => t + ": in no project of " + Path.GetFileName(solutionPath) + "; the check cannot read it"));
        return problems.Distinct(StringComparer.Ordinal).ToList();
    }

    // Each target framework is its own project, so one project file is evaluated once.
    private static string? Unrestored(string host, Project project, string name, Dictionary<string, string?> restore)
    {
        if (project.FilePath is not { } file)
        {
            return null;
        }

        if (!restore.TryGetValue(file, out var problem))
        {
            problem = ProjectAssets.Problem(name, ProjectAssets.Evaluate(host, file), File.Exists);
            restore[file] = problem;
        }

        return problem;
    }

    private static void Scan(
        string root,
        Project project,
        CSharpCompilation compilation,
        HashSet<string> seen,
        List<string> problems)
    {
        var name = Relative(root, project.FilePath ?? project.Name);

        // An error can hide an attribute's meaning, so nothing in a broken project counts as checked.
        problems.AddRange(compilation.GetDiagnostics()
            .Where(d => d.Severity == DiagnosticSeverity.Error && !d.IsSuppressed)
            .Select(d => Where(root, d.Location, name) + "does not compile: " + d.Id + " "
                + d.GetMessage(CultureInfo.InvariantCulture)));
        var types = new List<INamedTypeSymbol>();
        foreach (var type in AttributeTypes)
        {
            if (compilation.GetTypeByMetadataName(type) is { } symbol)
            {
                types.Add(symbol);
            }
            else
            {
                problems.Add(name + ": " + type + " does not resolve");
            }
        }

        var generated = Path.Combine(Path.GetDirectoryName(project.FilePath) ?? root, "obj") + Path.DirectorySeparatorChar;
        foreach (var tree in compilation.SyntaxTrees)
        {
            var path = tree.FilePath;
            if (path.Length == 0 || path.StartsWith(generated, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            seen.Add(Path.GetFullPath(path));
            var node = tree.GetRoot();
            Inactive(root, node, problems);
            Pragmas(root, node, problems);
            Attributes(root, node, compilation.GetSemanticModel(tree), types, problems);
        }
    }

    private static string Relative(string root, string path) => Path.GetRelativePath(root, path).Replace('\\', '/');

    private static string Where(string root, Location location, string fallback)
    {
        if (!location.IsInSource)
        {
            return fallback + ": ";
        }

        var span = location.GetLineSpan();
        return Relative(root, span.Path) + ":"
            + (span.StartLinePosition.Line + 1).ToString(CultureInfo.InvariantCulture) + ": ";
    }

    private static string At(string root, SyntaxNode node) => Where(root, node.GetLocation(), string.Empty);

    private static string At(string root, SyntaxTrivia trivia) => Where(root, trivia.GetLocation(), string.Empty);

    private static void Inactive(string root, SyntaxNode node, List<string> problems)
    {
        foreach (var trivia in node.DescendantTrivia(descendIntoTrivia: true))
        {
            if (trivia.IsKind(SyntaxKind.DisabledTextTrivia))
            {
                problems.Add(At(root, trivia) + "inactive conditional text; code under #if must stay compiled");
            }
        }
    }

    private static string NormaliseId(ExpressionSyntax code) => code switch
    {
        LiteralExpressionSyntax { Token.Value: int number } => "CS" + number.ToString("D4", CultureInfo.InvariantCulture),
        IdentifierNameSyntax name => name.Identifier.ValueText,
        _ => code.ToString(),
    };

    private static void Pragmas(string root, SyntaxNode node, List<string> problems)
    {
        var open = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var trivia in node.DescendantTrivia(descendIntoTrivia: true))
        {
            if (trivia.GetStructure() is not PragmaWarningDirectiveTriviaSyntax pragma)
            {
                continue;
            }

            var at = At(root, pragma);
            var ids = pragma.ErrorCodes.Select(NormaliseId).ToList();
            var disable = pragma.DisableOrRestoreKeyword.IsKind(SyntaxKind.DisableKeyword);
            if (ids.Count == 0)
            {
                problems.Add(at + (disable ? "bare pragma disable" : "bare pragma restore") + "; name exactly one ID");
            }
            else if (disable && ids.Count > 1)
            {
                problems.Add(at + "pragma disable must name exactly one ID");
            }
            else if (disable)
            {
                CheckRecord(at, ids[0], PragmaRecordText(pragma), problems);
                if (!open.TryAdd(ids[0], at))
                {
                    problems.Add(at + "second disable of " + ids[0] + " while it is already disabled");
                }
            }
            else
            {
                problems.AddRange(ids.Where(id => !open.Remove(id)).Select(id => at + "restore of " + id + " with no open disable"));
            }
        }

        problems.AddRange(open.Select(o => o.Value + "disable of " + o.Key + " has no later restore"));
    }

    private static string? PragmaRecordText(PragmaWarningDirectiveTriviaSyntax pragma)
    {
        var comment = pragma.DescendantTrivia().FirstOrDefault(t => t.IsKind(SyntaxKind.SingleLineCommentTrivia));
        if (!comment.IsKind(SyntaxKind.SingleLineCommentTrivia))
        {
            return null;
        }

        var text = comment.ToString();
        return text.StartsWith(RecordDelimiter, StringComparison.Ordinal) ? text[RecordDelimiter.Length..] : string.Empty;
    }

    private static void CheckRecord(string at, string id, string? text, List<string> problems)
    {
        if (text is null)
        {
            problems.Add(at + "suppression of " + id + " needs an AnalyzerPolicy record");
        }
        else if (!AnalyzerPolicyRecord.TryParse(text, out var record, out var problem))
        {
            problems.Add(at + "malformed record: " + problem);
        }
        else if (!string.Equals(record.Id, id, StringComparison.Ordinal))
        {
            problems.Add(at + "record ID " + record.Id + " does not match " + id);
        }
    }

    private static void Attributes(
        string root,
        SyntaxNode node,
        SemanticModel model,
        List<INamedTypeSymbol> types,
        List<string> problems)
    {
        foreach (var attribute in node.DescendantNodes().OfType<AttributeSyntax>())
        {
            var at = At(root, attribute);
            var info = model.GetSymbolInfo(attribute);
            if (info.Symbol is not IMethodSymbol constructor)
            {
                // An unbound attribute could be a suppression the check cannot see.
                problems.Add(at + "attribute " + attribute.Name + " does not bind, so the check cannot tell what it suppresses");
                continue;
            }

            if (!types.Contains(constructor.ContainingType, SymbolEqualityComparer.Default))
            {
                continue;
            }

            var arguments = attribute.ArgumentList?.Arguments.ToList() ?? [];
            var positional = arguments.Where(a => a.NameEquals is null && a.NameColon is null).ToList();
            var checkId = positional.Count > 1 ? model.GetConstantValue(positional[1].Expression).Value as string : null;
            var justification = arguments.FirstOrDefault(a =>
                string.Equals(a.NameEquals?.Name.Identifier.ValueText, "Justification", StringComparison.Ordinal));
            if (checkId is null)
            {
                problems.Add(at + "suppression attribute needs a constant check ID");
            }
            else if (justification is null)
            {
                problems.Add(at + "suppression attribute needs a Justification holding an AnalyzerPolicy record");
            }
            else if (model.GetConstantValue(justification.Expression).Value is not string text)
            {
                problems.Add(at + "Justification must be a constant string");
            }
            else
            {
                var colon = checkId.IndexOf(':', StringComparison.Ordinal);
                CheckRecord(at, colon < 0 ? checkId : checkId[..colon], text, problems);
            }
        }
    }
}
