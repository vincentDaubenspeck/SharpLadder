using System.Text.RegularExpressions;
using SharpLadder.Content;

namespace SharpLadder.CodeCheck;

/// <summary>
/// The two guards of the leak scan over the views of one scanned file. The marker guard looks at
/// every line of every view. The run guard looks for two consecutive qualifying lines of one
/// reference, consecutive among the scanned lines that the same filter keeps, so a short or skipped
/// line never breaks a run and one generic line shared by chance never fails the scan.
/// </summary>
internal sealed partial class LeakScanner
{
    // A line of this many code points or fewer is too generic to compare.
    private const int Floor = 20;

    private readonly List<Subject> _subjects = [];
    private readonly HashSet<string> _exclusions;
    private readonly List<(string Line, string File)> _firstLines;
    private readonly Dictionary<string, string> _markerFiles = new(StringComparer.Ordinal);
    private readonly HashSet<string> _reported = new(StringComparer.Ordinal);
    private readonly List<string> _findings;

    // Exclusions are global; starter and suite lines filter their own subject's reference only.
    // Wrong solutions feed the marker guard alone.
    public LeakScanner(IReadOnlyList<SuitePlan> suites, SolutionSet solutions, HashSet<string> exclusions, List<string> findings)
    {
        _exclusions = exclusions;
        _findings = findings;
        _firstLines = [.. solutions.Files.Select(f => (LeakText.Lines(f.Text)[0], f.Display))];
        foreach (var file in solutions.Files)
        {
            _markerFiles[file.Kind is { } kind ? $"// wrong: {file.Subject} {kind}" : $"// reference: {file.Subject}"] = file.Display;
        }

        foreach (var suite in suites)
        {
            var skipped = LeakText.Lines(suite.Starter).Concat(LeakText.Lines(suite.Suite)).ToHashSet(StringComparer.Ordinal);
            var reference = solutions.Reference(suite.Subject);
            var pairs = new Dictionary<(string, string), (int First, int Second)>();
            (string Line, int Number)? previous = null;
            foreach (var (line, index) in LeakText.Lines(reference.Text).Select((l, i) => (l, i)))
            {
                if (Kept(line, skipped))
                {
                    if (previous is { } first)
                    {
                        pairs.TryAdd((first.Line, line), (first.Number, index + 1));
                    }

                    previous = (line, index + 1);
                }
            }

            _subjects.Add(new Subject(reference.Display, skipped, pairs));
        }
    }

    public void Scan(string display, IReadOnlyList<(string View, string Text)> views)
    {
        foreach (var (view, text) in views)
        {
            var lines = LeakText.Lines(text);
            Markers(display, view, lines);
            var kept = lines.Where(l => Kept(l, null)).ToList();
            foreach (var subject in _subjects)
            {
                Runs(display, view, kept, subject);
            }
        }
    }

    // A minified bundle can be one line of many megabytes.
    [GeneratedRegex(@"// (?:reference: (?:prob-[0-9]{4}|drill-[a-z0-9-]+)|wrong: (?:prob-[0-9]{4}|drill-[a-z0-9-]+) )", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 10000)]
    private static partial Regex MarkerPattern();

    // A wrong marker names one of the fixed kinds right after its id.
    private static string? Marker(string line, Match match)
    {
        if (match.Value.StartsWith("// reference: ", StringComparison.Ordinal))
        {
            return match.Value;
        }

        var after = match.Index + match.Length;
        return SolutionRoot.Kinds.FirstOrDefault(k => line.AsSpan(after).StartsWith(k, StringComparison.Ordinal)) is { } kind ? match.Value + kind : null;
    }

    private bool Kept(string line, HashSet<string>? skipped) =>
        line.Length > Floor && ContentIds.SpokenLength(line) > Floor && !_exclusions.Contains(line) && skipped?.Contains(line) != true;

    private void Markers(string display, string view, List<string> lines)
    {
        foreach (var line in lines)
        {
            foreach (Match match in MarkerPattern().Matches(line))
            {
                if (Marker(line, match) is { } marker)
                {
                    var file = _markerFiles.GetValueOrDefault(marker);
                    var of = file is null ? string.Empty : $" of {file}";
                    Report($"{display}\0{file ?? marker}", $"{display}: {view} view: holds the marker \"{marker}\"{of}");
                }
            }

            foreach (var (first, file) in _firstLines.Where(f => line.Contains(f.Line, StringComparison.Ordinal)))
            {
                Report($"{display}\0{file}", $"{display}: {view} view: holds the first line of {file}");
            }
        }
    }

    private void Runs(string display, string view, List<string> kept, Subject subject)
    {
        string? previous = null;
        foreach (var line in kept.Where(l => !subject.Skipped.Contains(l)))
        {
            if (previous is not null && subject.Pairs.TryGetValue((previous, line), out var at))
            {
                Report($"{display}\0run\0{subject.Reference}", $"{display}: {view} view: holds lines {at.First} and {at.Second} of {subject.Reference} in a row");
                return;
            }

            previous = line;
        }
    }

    // One finding per scanned file and reference file for each guard, whichever view saw it first.
    private void Report(string key, string finding)
    {
        if (_reported.Add(key))
        {
            _findings.Add(finding);
        }
    }

    // A reference's consecutive qualifying lines, each pair with its two line numbers.
    private sealed record Subject(string Reference, HashSet<string> Skipped, Dictionary<(string, string), (int First, int Second)> Pairs);
}
