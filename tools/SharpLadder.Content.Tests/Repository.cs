namespace SharpLadder.Content.Tests;

internal static class Repository
{
    private static readonly Lazy<IContentSchema> LoadedSchema = new(() =>
    {
        var (set, problems) = SchemaSet.Load(SchemaFolder);
        return set ?? throw new InvalidOperationException(string.Join("\n", problems));
    });

    public static string Root { get; } = FindRoot();

    public static string SchemaFolder => Path.Combine(Root, "content", "schema");

    public static string Fixture => Path.Combine(Root, "tools", "SharpLadder.Content.Tests", "fixtures", "content");

    public static string GoldenFile => Path.Combine(Root, "tools", "SharpLadder.Content.Tests", "fixtures", "content.sha256");

    public static IContentSchema Schema => LoadedSchema.Value;

    // A tree written by a test holds only what the test is about, so an empty registry is added
    // for each one it leaves out. CompileAsWritten compiles the tree exactly as it stands.
    public static CompileResult Compile(string contentRoot)
    {
        if (Directory.Exists(contentRoot))
        {
            AddMissing(contentRoot, "aliases.yml", "slugs: {}\nids: {}\n");
            AddMissing(contentRoot, "patterns.yml", "patterns: []\n");
        }

        return CompileAsWritten(contentRoot);
    }

    public static CompileResult CompileAsWritten(string contentRoot) => ContentCompiler.Compile(contentRoot, Schema, contentRoot);

    public static void CopyTree(string from, string to, string newline)
    {
        foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(to, Path.GetRelativePath(from, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            var text = File.ReadAllText(file).Replace("\r\n", "\n", StringComparison.Ordinal);
            File.WriteAllText(target, text.Replace("\n", newline, StringComparison.Ordinal));
        }
    }

    private static void AddMissing(string root, string name, string text)
    {
        var path = Path.Combine(root, name);
        if (!File.Exists(path) && !Directory.Exists(path))
        {
            File.WriteAllText(path, text);
        }
    }

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
