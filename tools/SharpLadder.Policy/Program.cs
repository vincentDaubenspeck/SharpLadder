using SharpLadder.Policy;

// Usage: SharpLadder.Policy [solution]; with no solution, SharpLadder.sln in the working
// directory, and every tracked C# file must then belong to one of its projects.
const string Stage = "C# suppression reasons";
var solution = Path.GetFullPath(args.Length > 0 ? args[0] : "SharpLadder.sln");
IReadOnlyList<string>? tracked = [];
if (args.Length == 0)
{
    tracked = GitFiles.List(Environment.CurrentDirectory, "*.cs");
}

var problems = tracked is null ? ["git ls-files failed"] : PinnedSdk.Register(solution);
if (problems.Count == 0)
{
    problems = await SuppressionCheck.RunAsync(Environment.ProcessPath!, solution, tracked!).ConfigureAwait(false);
}

foreach (var problem in problems)
{
    Console.WriteLine("  " + problem);
}

Console.WriteLine((problems.Count == 0 ? "PASS " : "FAIL ") + Stage);
return problems.Count == 0 ? 0 : 1;
