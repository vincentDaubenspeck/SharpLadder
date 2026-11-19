namespace SharpLadder.CodeCheck;

// The implicit usings of a net10.0 console project, which content is written against, as a tree of
// their own.
internal static class GlobalUsingsSource
{
    public const string FileName = "SharpLadderGlobalUsings.cs";

    public static IReadOnlyList<string> Namespaces { get; } =
    [
        "System",
        "System.Collections.Generic",
        "System.IO",
        "System.Linq",
        "System.Net.Http",
        "System.Threading",
        "System.Threading.Tasks",
    ];

    public static string Text { get; } = string.Concat(Namespaces.Select(n => "global using global::" + n + ";\n"));
}
