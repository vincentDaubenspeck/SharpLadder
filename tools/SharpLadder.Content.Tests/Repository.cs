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

    public static CompileResult Compile(string contentRoot) => ContentCompiler.Compile(contentRoot, Schema, contentRoot);

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
