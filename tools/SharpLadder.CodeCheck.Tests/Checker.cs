namespace SharpLadder.CodeCheck.Tests;

internal static class Checker
{
    public static string RepositoryRoot { get; } = FindRoot();

    public static string SchemaFolder => Path.Combine(RepositoryRoot, "content", "schema");

    // The live install is only ever read; a case that changes it works on a stand-in copy.
    public static (int Code, string[] Lines) Run(string repositoryRoot, params string[] args) => RunWith(repositoryRoot, null, null, args);

    // The live schema and the given content, with a reference root that is absent: no subject is solved.
    public static (int Code, string[] Lines) Check(string repositoryRoot, string content)
    {
        using var parent = new TempFolder();
        return Run(repositoryRoot, SchemaFolder, content, Path.Combine(parent.Path, "reference"));
    }

    // A backend with a fault seam, or a suite deadline shorter than the checker's own.
    public static (int Code, string[] Lines) RunWith(string repositoryRoot, IRunBackend? backend, TimeSpan? suiteLimit, params string[] args)
    {
        using var output = new StringWriter();
        var code = Cli.Run(args, output, repositoryRoot, backend, suiteLimit);
        return (code, output.ToString().ReplaceLineEndings("\n").TrimEnd('\n').Split('\n'));
    }

    // A valid content root that holds no chapter: the registries and nothing else.
    public static TempFolder EmptyRoot()
    {
        var root = new TempFolder();
        root.Write("aliases.yml", "slugs: {}\nids: {}\n");
        root.Write("patterns.yml", "patterns: []\n");
        return root;
    }

    // How the content compiler shows a content root outside the current folder.
    public static string Shown(string path) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)).Replace('\\', '/');

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "SharpLadder.sln")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("SharpLadder.sln not found above the test output.");
    }
}
