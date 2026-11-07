using System.Globalization;

namespace SharpLadder.Content;

// Line is 1-based; it is absent when the problem belongs to a whole folder.
internal sealed record Diagnostic(string Path, int? Line, string Message)
{
    public override string ToString() => Line is int line
        ? string.Create(CultureInfo.InvariantCulture, $"{Path}:{line}: {Message}")
        : $"{Path}: {Message}";
}
