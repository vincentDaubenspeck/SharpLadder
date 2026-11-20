namespace SharpLadder.Content;

// What a practice record names exists as the kind it names, and the drill parts and the drill
// files agree: each drill of a chapter listed once, in its own chapter, under its own rung.
internal static class PracticeChecks
{
    private const string Foundations = "foundations";

    public static void Check(IReadOnlyList<ContentCompiler.Parsed> parsed, IEnumerable<string> patterns, List<Diagnostic> diagnostics)
    {
        var known = new Known(
            parsed.Where(p => ContentCompiler.IsChapter(p.Relative)).Select(p => p.File.ChapterId).OfType<string>().ToHashSet(StringComparer.Ordinal),
            patterns.ToHashSet(StringComparer.Ordinal),
            parsed.SelectMany(p => p.File.Ladders).GroupBy(l => l.Ladder.Id, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First().Ladder.Approach, StringComparer.Ordinal),
            parsed.Select(p => p.File.Model).OfType<GlossaryFile>().Select(g => g.Id).ToHashSet(StringComparer.Ordinal),
            Stems(parsed, RecordKind.Problem),
            Stems(parsed, RecordKind.Drill),
            parsed.Where(p => p.File.Model is DrillFile).GroupBy(p => ((DrillFile)p.File.Model!).Id, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal),
            parsed.SelectMany(p => p.File.SectionIds).ToHashSet(StringComparer.Ordinal),
            parsed.SelectMany(p => p.File.SectionWalks).ToHashSet());
        foreach (var file in parsed.Where(p => p.File.Practice is not null))
        {
            var report = new Report(file.Display, file.File.Practice!.KeyLines, diagnostics);
            if (file.File.Model is ProblemFile problem)
            {
                Shared(report, problem.Chapter, problem.Ladders, problem.Tests, known);
                Names(report, "patternTags", problem.PatternTags, known.Patterns.Contains, "pattern in patterns.yml");
            }
            else if (file.File.Model is DrillFile drill)
            {
                Shared(report, drill.Chapter, drill.Ladders, drill.Tests, known);
                Names(report, "ideas", drill.Ideas, known.Terms.Contains, "glossary entry");
                Names(report, "prerequisites", drill.Prerequisites, known.DrillNames.Contains, "drill file");
                Names(report, "prepares", drill.Prepares, known.Problems.Contains, "problem file");
                Names(report, "variationOf", drill.VariationOf is { } varied ? [varied] : [], known.DrillNames.Contains, "drill file");
                if (drill.Prepares.Count == 0 && !string.Equals(drill.Rung, Foundations, StringComparison.Ordinal))
                {
                    report.Add("prepares", $"prepares names nothing; a {drill.Rung} drill prepares at least one problem, and only a {Foundations} drill may prepare none");
                }
            }
        }

        Cycles(known, diagnostics);
        DrillLinks(parsed, known, diagnostics);
    }

    private static void Shared(Report report, string chapter, IReadOnlyList<string> ladders, PracticeSuite tests, Known known)
    {
        Names(report, "chapter", [chapter], known.Chapters.Contains, "chapter");
        Names(report, "ladders", ladders, known.Ladders.ContainsKey, "ladder");

        // The labels are what a learner picks an approach by, so two that read alike are one.
        var labels = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var ladder in ladders.Where(known.Ladders.ContainsKey))
        {
            var label = known.Ladders[ladder].Trim();
            if (label.Length == 0)
            {
                report.Add("ladders", $"ladder \"{ladder}\" has no approach label");
            }
            else if (!labels.TryAdd(label, ladder))
            {
                report.Add("ladders", $"ladders \"{labels[label]}\" and \"{ladder}\" share the approach label {PlainYaml.Shown(label)}; each ladder of a subject needs its own");
            }
        }

        foreach (var entry in tests.Review)
        {
            if (!known.Sections.Contains(entry.SectionId))
            {
                report.Add("tests", $"tests.review {PlainYaml.Shown(entry.Check)} sectionId \"{entry.SectionId}\" names no section");
            }
            else if (entry.WalkId is { } walk && !known.Walks.Contains((entry.SectionId, walk)))
            {
                report.Add("tests", $"tests.review {PlainYaml.Shown(entry.Check)} walkId \"{walk}\" names no walk-it inside the section \"{entry.SectionId}\"");
            }
        }
    }

    // A subject file's name is its id, so one that failed to compile still counts as present and
    // adds no second diagnostic here.
    private static HashSet<string> Stems(IReadOnlyList<ContentCompiler.Parsed> parsed, RecordKind kind) =>
        parsed.Where(p => p.File.Entry == kind).Select(p => Path.GetFileNameWithoutExtension(p.Relative)).ToHashSet(StringComparer.Ordinal);

    private static void Names(Report report, string key, IEnumerable<string> ids, Func<string, bool> exists, string kind)
    {
        foreach (var id in ids.Where(i => !exists(i)))
        {
            report.Add(key, $"{key} names \"{id}\", which is no {kind}");
        }
    }

    // Each cycle is reported once, at its first drill in ordinal order: the search from a drill
    // passes only through drills that sort after it.
    private static void Cycles(Known known, List<Diagnostic> diagnostics)
    {
        foreach (var (start, file) in known.Drills.OrderBy(d => d.Key, StringComparer.Ordinal))
        {
            var parents = new Dictionary<string, string>(StringComparer.Ordinal);
            var queue = new Queue<string>([start]);
            while (queue.Count > 0)
            {
                var at = queue.Dequeue();
                var through = ((DrillFile)known.Drills[at].File.Model!).Prerequisites;
                if (through.Contains(start, StringComparer.Ordinal))
                {
                    var path = new List<string>();
                    for (var step = at; !string.Equals(step, start, StringComparison.Ordinal); step = parents[step])
                    {
                        path.Add(step);
                    }

                    var cycle = string.Join(" -> ", path.Append(start).Reverse().Append(start));
                    new Report(file.Display, file.File.Practice!.KeyLines, diagnostics).Add("prerequisites", $"prerequisites form a cycle: {cycle}");
                    break;
                }

                foreach (var next in through.Where(n => known.Drills.ContainsKey(n) && string.CompareOrdinal(n, start) > 0 && parents.TryAdd(n, at)))
                {
                    queue.Enqueue(next);
                }
            }
        }
    }

    private static void DrillLinks(IReadOnlyList<ContentCompiler.Parsed> parsed, Known known, List<Diagnostic> diagnostics)
    {
        var linked = new Dictionary<string, (string Display, int Line)>(StringComparer.Ordinal);
        foreach (var part in parsed)
        {
            foreach (var (id, rung, line) in part.File.DrillTargets)
            {
                if (!known.DrillNames.Contains(id))
                {
                    diagnostics.Add(new Diagnostic(part.Display, line, $"drill link target \"#{id}\" names no drill file"));
                    continue;
                }

                // A drill file that failed is reported on its own.
                if (!known.Drills.TryGetValue(id, out var source))
                {
                    continue;
                }

                // A drill whose own chapter is no chapter is reported by that chapter check alone.
                var drill = (DrillFile)source.File.Model!;
                if (!known.Chapters.Contains(drill.Chapter))
                {
                    continue;
                }

                if (!string.Equals(drill.Chapter, part.File.ChapterId, StringComparison.Ordinal))
                {
                    diagnostics.Add(new Diagnostic(part.Display, line, $"drill \"{id}\" belongs to the chapter \"{drill.Chapter}\", not \"{part.File.ChapterId}\""));
                    continue;
                }

                if (!string.Equals(drill.Rung, rung, StringComparison.Ordinal))
                {
                    diagnostics.Add(new Diagnostic(part.Display, line, $"drill \"{id}\" is a {drill.Rung} drill, listed under the rung {rung}"));
                }

                if (!linked.TryAdd(id, (part.Display, line)))
                {
                    var first = linked[id];
                    diagnostics.Add(new Diagnostic(part.Display, line, $"drill \"{id}\" is listed twice in its chapter (first at {first.Display}:{first.Line})"));
                }
            }
        }

        foreach (var (id, source) in known.Drills.Where(d => !linked.ContainsKey(d.Key)))
        {
            var drill = (DrillFile)source.File.Model!;
            if (known.Chapters.Contains(drill.Chapter))
            {
                new Report(source.Display, source.File.Practice!.KeyLines, diagnostics).Add("chapter", $"drill \"{id}\" is listed in no drill part of the chapter \"{drill.Chapter}\"; list it once under the rung {drill.Rung}");
            }
        }
    }

    private sealed record Known(
        HashSet<string> Chapters,
        HashSet<string> Patterns,
        Dictionary<string, string> Ladders,
        HashSet<string> Terms,
        HashSet<string> Problems,
        HashSet<string> DrillNames,
        Dictionary<string, ContentCompiler.Parsed> Drills,
        HashSet<string> Sections,
        HashSet<(string Section, string Walk)> Walks);

    private sealed record Report(string Display, IReadOnlyDictionary<string, int> Lines, List<Diagnostic> Diagnostics)
    {
        public void Add(string key, string message) => Diagnostics.Add(new Diagnostic(Display, Lines[key], message));
    }
}
