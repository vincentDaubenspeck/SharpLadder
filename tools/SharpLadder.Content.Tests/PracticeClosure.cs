namespace SharpLadder.Content.Tests;

// What a drill or problem of the chapter ch-test resolves against: the pattern pat-a, the ladder
// ladder-a, the glossary entry term-a, and the problem prob-0001 with the index that lists it.
internal static class PracticeClosure
{
    public const string Suite = "using System;\n\nConsole.WriteLine(\"#check pass one\");\n";

    public const string Patterns = "patterns:\n  - id: pat-a\n    title: Count, then read\n    summary: Count everything first.\n";

    public const string Hints = "---\nkind: hints\nchapter: ch-test\norder: 9\n---\n\n## Count every word first {#ladder-a}\n\n"
        + "cue: You want the first word that no other word repeats.\npattern: pat-a\napproach: tally first\n\n1. {#r1} What must you know about a word first?\n";

    public const string Term = "---\nid: term-a\nterm: tally\nshort: A running count.\n---\n\nA tally counts as it goes.\n";

    public const string IndexPath = "practice/problems.yml";

    public static string Index => ProblemsIndex.Header + "\nproblems:\n  - id: prob-0001\n    number: 1\n"
        + "    title: Vowel words\n    chapter: ch-test\n    ladders:\n      - ladder-a\n";

    public static (string Path, string Text)[] Support => [("aliases.yml", "slugs: {}\nids: {}\n"), ("patterns.yml", Patterns), ("chapters/c/hints.md", Hints), ("glossary/term-a.md", Term)];

    public static (string Path, string Text)[] WithProblem =>
    [
        .. Support,
        ("practice/problems/prob-0001.md", Front("prob-0001", "number: 1\ntitle: Vowel words\npatternTags: [pat-a]\nladders: [ladder-a]", "paraphraseCheckedAt: 2026-11-01\n")),
        ("practice/problems/prob-0001.tests.cs", Suite),
        (IndexPath, Index),
    ];

    // A drill that resolves against WithProblem; its drill part must still list it under its rung.
    public static (string Path, string Text)[] Drill(string id, string rung) =>
    [
        ($"practice/drills/{id}.md", Front(id, $"rung: {rung}\ntitle: Practise one move\ntype: One move\nideas: [term-a]\nprerequisites: []\nprepares: [prob-0001]\nvariationOf: null\nladders: [ladder-a]", string.Empty)),
        ($"practice/drills/{id}.tests.cs", Suite),
    ];

    private static string Front(string id, string fields, string tail) =>
        $"---\nid: {id}\nchapter: ch-test\n{fields}\ntests:\n  file: {id}.tests.cs\n  version: 1\n  count: 1\nreference: {id}.reference.cs\n{tail}---\n"
        + "\n## Statement\n\nCount the words.\n\n## Examples\n\n```text {spoken=\"One example\"}\n[a, b] gives 2\n```\n\n## Constraints\n\nAt most ten words.\n\n## Starter\n\n"
        + $"```csharp {{#{id}-starter starter spoken=\"The starting method\"}}\nstatic int Count(string[] words) => throw new NotImplementedException();\n```\n";
}
