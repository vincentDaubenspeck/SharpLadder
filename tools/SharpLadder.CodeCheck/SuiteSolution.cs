using System.Globalization;

namespace SharpLadder.CodeCheck;

// The second content unit of a suite run. Display is the solution's file, or for the starter the
// subject's Markdown file, whose starter is then placed by its own line.
internal sealed record SuiteSolution(SuiteRunKind Kind, string Display, string Text)
{
    public string Name => Kind == SuiteRunKind.Starter ? Display + " starter" : Display;

    public string Place(int line) => Kind == SuiteRunKind.Starter
        ? string.Create(CultureInfo.InvariantCulture, $"{Display}: starter line {line}")
        : string.Create(CultureInfo.InvariantCulture, $"{Display}:{line}");
}
