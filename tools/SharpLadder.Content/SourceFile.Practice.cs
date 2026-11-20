using System.Globalization;
using System.Text.RegularExpressions;
using Markdig.Syntax;

namespace SharpLadder.Content;

/// <content>Problems and drills: closed front matter, four fields in order, one starter and the suite beside the file.</content>
internal sealed partial class SourceFile
{
    public const string ProblemPrefix = "prob-";
    private const int MaxCheckName = 100;
    private const int MaxCount = 200;
    private const int RefusedHeading = -2;
    private const string HeadingRule = "a practice file holds the headings ## Statement, ## Examples, ## Constraints and ## Starter, in that order, and no others";
    private static readonly string[] PracticeFields = ["Statement", "Examples", "Constraints", "Starter"];
    private static readonly string[] PracticeFieldIds = ["statement", "examples", "constraints"];
    private static readonly string[] ProblemKeys = ["id", "chapter", "number", "title", "patternTags", "ladders", "tests", "reference", "paraphraseCheckedAt"];
    private static readonly string[] DrillKeys = ["id", "chapter", "rung", "title", "type", "ideas", "prerequisites", "prepares", "variationOf", "ladders", "tests", "reference"];

    // Set only when the file compiled to its record.
    public PracticeFile? Practice { get; private set; }

    public static SourceFile ParsePractice(string path, string text, RecordKind kind, string stem, (string Display, string Text) suite, List<Diagnostic> diagnostics)
    {
        var file = new SourceFile(path, diagnostics) { Entry = kind };
        if (file.Front(text) is var (yaml, start, blocks))
        {
            if (kind == RecordKind.Problem)
            {
                file.ReadProblemFile(yaml, start, blocks, stem, suite);
            }
            else
            {
                file.ReadDrillFile(yaml, start, blocks, stem, suite);
            }
        }

        return file;
    }

    [GeneratedRegex(@"^prob-[0-9]{4}\z", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex ProblemIdPattern();

    // At most 40 characters, so the starter id stays within the 48 every id has.
    [GeneratedRegex(@"^drill-[a-z0-9-]{1,34}\z", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex DrillIdPattern();

    private static Dictionary<string, int> KeyLines(string yaml, int start, string[] keys) =>
        keys.ToDictionary(k => k, k => KeyLine(yaml, start, k), StringComparer.Ordinal);

    private static string LongLine(int length) =>
        string.Create(CultureInfo.InvariantCulture, $"line is {length} characters; at most {PracticePayload.MaxCodeLine} are allowed");

    private void ReadProblemFile(string yaml, int start, List<Block> blocks, string stem, (string Display, string Text) suite)
    {
        var meta = FrontMatter<ProblemFrontMatter>(yaml, start);
        if (meta is null)
        {
            return;
        }

        var lines = KeyLines(yaml, start, ProblemKeys);
        var before = _diagnostics.Count;
        var id = PracticeId(meta.Id, RecordKind.Problem, stem, lines["id"]);
        var chapter = IdValue(meta.Chapter, "chapter", lines["chapter"]);
        ChapterId = chapter;
        var number = Whole(meta.Number, "number", lines["number"], 1, null);
        var title = Plain(meta.Title, "title", lines["title"], null);
        var tags = IdList(meta.PatternTags, "patternTags", lines["patternTags"], atLeastOne: true);
        var ladders = IdList(meta.Ladders, "ladders", lines["ladders"], atLeastOne: true);
        var tests = Suite(meta.Tests, id, suite, lines["tests"]);
        SourceName(meta.Reference, "reference", id, ".reference.cs", lines["reference"]);
        CheckedAt(meta.ParaphraseCheckedAt, lines["paraphraseCheckedAt"]);
        var body = id is null ? null : PracticeBody(blocks, id);
        if (_diagnostics.Count == before && id is not null && chapter is not null && number is int n && title is not null
            && tags is not null && ladders is not null && tests is not null && body is not null)
        {
            Model = new ProblemFile
            {
                Id = id,
                Chapter = chapter,
                Number = n,
                Title = title,
                PatternTags = tags,
                Ladders = ladders,
                Statement = body.Statement,
                Examples = body.Examples,
                Constraints = body.Constraints,
                Starter = body.Starter,
                Spoken = body.Spoken,
                Tests = tests,
            };
            Admit(RecordKind.Problem, id, lines, body.StarterLine);
        }
    }

    private void ReadDrillFile(string yaml, int start, List<Block> blocks, string stem, (string Display, string Text) suite)
    {
        var meta = FrontMatter<DrillFrontMatter>(yaml, start);
        if (meta is null)
        {
            return;
        }

        var lines = KeyLines(yaml, start, DrillKeys);
        var before = _diagnostics.Count;
        var id = PracticeId(meta.Id, RecordKind.Drill, stem, lines["id"]);
        var chapter = IdValue(meta.Chapter, "chapter", lines["chapter"]);
        ChapterId = chapter;
        var rung = PracticeRung(meta.Rung, lines["rung"]);
        var title = Plain(meta.Title, "title", lines["title"], null);
        var move = Plain(meta.Type, "type", lines["type"], null);
        var ideas = IdList(meta.Ideas, "ideas", lines["ideas"], atLeastOne: false);
        var prerequisites = IdList(meta.Prerequisites, "prerequisites", lines["prerequisites"], atLeastOne: false);
        var prepares = IdList(meta.Prepares, "prepares", lines["prepares"], atLeastOne: false);
        var variation = VariationOf(meta, lines["variationOf"]);
        var ladders = IdList(meta.Ladders, "ladders", lines["ladders"], atLeastOne: true);
        var tests = Suite(meta.Tests, id, suite, lines["tests"]);
        SourceName(meta.Reference, "reference", id, ".reference.cs", lines["reference"]);
        var body = id is null ? null : PracticeBody(blocks, id);
        if (_diagnostics.Count == before && id is not null && chapter is not null && rung is not null && title is not null && move is not null
            && ideas is not null && prerequisites is not null && prepares is not null && variation && ladders is not null && tests is not null && body is not null)
        {
            Model = new DrillFile
            {
                Id = id,
                Chapter = chapter,
                Rung = rung,
                Title = title,
                Move = move,
                Ideas = ideas,
                Prerequisites = prerequisites,
                Prepares = prepares,
                VariationOf = meta.VariationOf,
                Ladders = ladders,
                Statement = body.Statement,
                Examples = body.Examples,
                Constraints = body.Constraints,
                Starter = body.Starter,
                Spoken = body.Spoken,
                Tests = tests,
            };
            Admit(RecordKind.Drill, id, lines, body.StarterLine);
        }
    }

    // Both ids join the site-wide table only once the record exists, so a failed file adds no
    // second diagnostic through them.
    private void Admit(RecordKind kind, string id, Dictionary<string, int> lines, int starterLine)
    {
        var starterId = id + FenceReader.StarterSuffix;
        Ids.Add((id, lines["id"]));
        Ids.Add((starterId, starterLine));
        Practice = new PracticeFile(kind, id, starterId, lines);
    }

    // A subject is found by its file name, so the name and the id are the same text.
    private string? PracticeId(string? id, RecordKind kind, string stem, int line)
    {
        var problem = kind == RecordKind.Problem;
        string? refusal = null;
        if (id is null)
        {
            refusal = "front matter states no id";
        }
        else if (!(problem ? ProblemIdPattern() : DrillIdPattern()).IsMatch(id))
        {
            refusal = problem
                ? $"problem id \"{Shown(id)}\" is not prob- and four digits"
                : $"drill id \"{Shown(id)}\" is not drill- and 1 to 34 lowercase letters, digits and hyphens";
        }
        else if (!string.Equals(id, stem, StringComparison.Ordinal))
        {
            refusal = $"the file is named \"{Shown(stem)}.md\" and states the id \"{id}\"; name the file {id}.md and its suite {id}.tests.cs";
        }

        if (refusal is not null)
        {
            Error(line, refusal);
            return null;
        }

        return id;
    }

    private string? IdValue(string? value, string key, int line)
    {
        if (value is null)
        {
            Error(line, $"front matter states no {key}");
            return null;
        }

        if (!ContentIds.IsValid(value))
        {
            Error(line, $"{key} \"{Shown(value)}\" {ContentIds.FormatRule}");
            return null;
        }

        return value;
    }

    private List<string>? IdList(IList<string?>? values, string key, int line, bool atLeastOne)
    {
        if (values is null)
        {
            Error(line, atLeastOne ? $"front matter states no {key}" : $"front matter states no {key}; write {key}: [] when there are none");
            return null;
        }

        if (atLeastOne && values.Count == 0)
        {
            Error(line, $"{key} names nothing; name at least one");
            return null;
        }

        var listed = new List<string>();
        foreach (var value in values)
        {
            if (value is null || !ContentIds.IsValid(value))
            {
                Error(line, $"{key} names \"{Shown(value ?? string.Empty)}\", which {ContentIds.FormatRule}");
            }
            else
            {
                listed.Add(value);
            }
        }

        return listed.Count == values.Count ? listed : null;
    }

    private int? Whole(int? value, string key, int line, int least, int? most)
    {
        if (value is not int number)
        {
            Error(line, $"front matter states no {key}");
            return null;
        }

        if (number < least || number > most)
        {
            var range = most is int top ? string.Create(CultureInfo.InvariantCulture, $"from {least} to {top}") : string.Create(CultureInfo.InvariantCulture, $"{least} or more");
            Error(line, string.Create(CultureInfo.InvariantCulture, $"{key} is {number}; it must be {range}"));
            return null;
        }

        return number;
    }

    // The schema's rampRung, checked here so the refusal names the rungs.
    private string? PracticeRung(string? value, int line)
    {
        if (value is null)
        {
            Error(line, "front matter states no rung");
            return null;
        }

        if (!RampRungs.Contains(value, StringComparer.Ordinal))
        {
            Error(line, $"rung \"{Shown(value)}\" is not a ramp rung; write one of {string.Join(", ", RampRungs)}");
            return null;
        }

        return value;
    }

    private bool VariationOf(DrillFrontMatter meta, int line)
    {
        if (!meta.VariationOfStated)
        {
            Error(line, "front matter states no variationOf; write variationOf: null when the drill varies no other");
            return false;
        }

        if (meta.VariationOf is { } varied && !ContentIds.IsValid(varied))
        {
            Error(line, $"variationOf names \"{Shown(varied)}\", which {ContentIds.FormatRule}");
            return false;
        }

        return true;
    }

    // The source file names are fixed by the id, so a stated one only confirms it.
    private void SourceName(string? value, string key, string? id, string extension, int line)
    {
        if (value is null)
        {
            Error(line, $"front matter states no {key}");
        }
        else if (id is not null && !string.Equals(value, id + extension, StringComparison.Ordinal))
        {
            Error(line, $"{key} is \"{Shown(value)}\"; it must be \"{id}{extension}\"");
        }
    }

    // Never emitted: it records editorial work, so only its form is checked.
    private void CheckedAt(string? value, int line)
    {
        if (value is null)
        {
            Error(line, "front matter states no paraphraseCheckedAt");
        }
        else if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
        {
            Error(line, $"paraphraseCheckedAt is \"{Shown(value)}\"; write a date as YYYY-MM-DD");
        }
    }

    private PracticeSuite? Suite(SuiteFrontMatter? tests, string? id, (string Display, string Text) suite, int line)
    {
        if (tests is null)
        {
            Error(line, "front matter states no tests");
            return null;
        }

        var before = _diagnostics.Count;
        SourceName(tests.File, "tests.file", id, RootAdmission.SuiteExtension, line);
        var version = Whole(tests.Version, "tests.version", line, 1, null);
        var count = Whole(tests.Count, "tests.count", line, 1, MaxCount);
        var review = Review(tests.Review, count, line);
        if (suite.Text.Length == 0)
        {
            _diagnostics.Add(new Diagnostic(suite.Display, null, "the suite file is empty"));
        }

        foreach (var (at, length) in PracticePayload.LongLines(suite.Text))
        {
            _diagnostics.Add(new Diagnostic(suite.Display, at, LongLine(length)));
        }

        return _diagnostics.Count == before && version is int v && count is int c && review is not null
            ? new PracticeSuite { Text = suite.Text, Version = v, Hash = PracticePayload.Hash(suite.Text), Count = c, Review = review }
            : null;
    }

    // Each entry names a check the reference must record, so there are never more than the suite
    // declares; that also bounds the array the schema leaves unbounded.
    private List<ReviewEntry>? Review(IDictionary<string, ReviewFrontMatter?>? review, int? count, int line)
    {
        var before = _diagnostics.Count;
        var entries = new List<ReviewEntry>();
        if (review is not null && count is int most && review.Count > most)
        {
            Error(line, string.Create(CultureInfo.InvariantCulture, $"tests.review has {review.Count} entries; at most tests.count ({most}) are allowed"));
        }

        foreach (var (check, entry) in (review ?? new Dictionary<string, ReviewFrontMatter?>(StringComparer.Ordinal)).OrderBy(e => e.Key, StringComparer.Ordinal))
        {
            // Counted as the result-line parser counts a check name.
            if (check.Length is 0 or > MaxCheckName)
            {
                Error(line, string.Create(CultureInfo.InvariantCulture, $"tests.review names the check \"{Shown(check)}\" of {check.Length} UTF-16 code units; a check name has 1 to {MaxCheckName}"));
            }

            if (entry is null)
            {
                Error(line, $"tests.review entry \"{Shown(check)}\" states no sectionId or label");
                continue;
            }

            var section = IdValue(entry.SectionId, $"tests.review \"{Shown(check)}\" sectionId", line);
            var label = Plain(entry.Label, $"tests.review \"{Shown(check)}\" label", line, null);
            var walk = entry.WalkId is null ? null : IdValue(entry.WalkId, $"tests.review \"{Shown(check)}\" walkId", line);
            if (section is not null && label is not null)
            {
                entries.Add(new ReviewEntry { Check = check, SectionId = section, Label = label, WalkId = walk });
            }
        }

        return _diagnostics.Count == before ? entries : null;
    }

    private PracticeBodyParts? PracticeBody(List<Block> blocks, string id)
    {
        var before = _diagnostics.Count;
        List<BodyBlock>[] fields = [[], [], []];
        var numbers = new int[PracticeFieldIds.Length];
        var headingLines = new int[PracticeFields.Length];
        var starters = new List<(PracticeStarter? Starter, int Line, int CodeLine)>();
        _segments = [];
        var next = ReadPracticeFields(blocks, id, fields, numbers, headingLines, starters);
        PracticeFieldRules(id, next, numbers, headingLines, starters);

        // The starter's own checks read only the one accepted starter, so a refusal elsewhere in
        // the body does not hide them.
        if (starters is [(PracticeStarter only, var onlyLine, var firstCodeLine)])
        {
            if (only.Source.Length == 0)
            {
                Error(onlyLine, "the starter holds no code");
            }

            foreach (var (at, length) in PracticePayload.LongLines(only.Source))
            {
                Error(firstCodeLine + at - 1, LongLine(length));
            }
        }

        if (_diagnostics.Count > before || starters is not [(PracticeStarter starter, var starterLine, _)])
        {
            return null;
        }

        var spoken = new SectionSpeech { Segments = _segments, Audio = AudioSlot.Of([.. _segments.Select(s => s.Text)]) };
        return new PracticeBodyParts(fields[0], fields[1], fields[2], starter, starterLine, spoken);
    }

    // Returns how many of the four headings were found in order.
    private int ReadPracticeFields(List<Block> blocks, string id, List<BodyBlock>[] fields, int[] numbers, int[] headingLines, List<(PracticeStarter? Starter, int Line, int CodeLine)> starters)
    {
        var open = -1;
        var next = 0;
        var preambleReported = false;
        foreach (var block in blocks)
        {
            var line = block.Line + 1;
            if (block is HeadingBlock heading)
            {
                open = PracticeHeading(heading, line, ref next);
                if (open >= 0)
                {
                    headingLines[open] = line;
                }

                continue;
            }

            if (block is LinkReferenceDefinitionGroup definitions)
            {
                definitions.OfType<LinkReferenceDefinition>().ToList().ForEach(d => Target(d.Url, d.Title, d.Line + 1));
                continue;
            }

            if (open == -1)
            {
                if (!preambleReported)
                {
                    Error(line, "a practice file holds nothing before its ## Statement heading");
                    preambleReported = true;
                }

                continue;
            }

            // Blocks under a refused heading add no noise.
            if (open == RefusedHeading)
            {
                continue;
            }

            if (open == PracticeFieldIds.Length)
            {
                StarterBlock(block, id, line, starters);
                continue;
            }

            var blockId = string.Create(CultureInfo.InvariantCulture, $"{id}/{PracticeFieldIds[open]}/b{++numbers[open]}");
            if (PracticeBlock(block, PracticeFields[open], blockId, line) is { } node)
            {
                fields[open].Add(node);
                PracticeSegments(node, line);
            }
        }

        return next;
    }

    private void StarterBlock(Block block, string id, int line, List<(PracticeStarter? Starter, int Line, int CodeLine)> starters)
    {
        if (block is FencedCodeBlock fence)
        {
            var codeLine = fence.Lines.Count > 0 ? fence.Lines.Lines[0].Line + 1 : fence.Line + 2;
            starters.Add((FenceReader.ReadStarter(fence, _lines[fence.Line], id, line, Error), line, codeLine));
        }
        else
        {
            Error(line, "## Starter holds only the starter block");
        }
    }

    // Every heading present, no field empty, exactly one starter.
    private void PracticeFieldRules(string id, int next, int[] numbers, int[] headingLines, List<(PracticeStarter? Starter, int Line, int CodeLine)> starters)
    {
        for (var missing = next; missing < PracticeFields.Length; missing++)
        {
            Error(_lines.Length, $"a practice file needs the heading ## {PracticeFields[missing]}; {HeadingRule}");
        }

        for (var field = 0; field < Math.Min(next, PracticeFieldIds.Length); field++)
        {
            if (numbers[field] == 0)
            {
                Error(headingLines[field], $"## {PracticeFields[field]} holds nothing; write at least one block under it");
            }
        }

        if (next == PracticeFields.Length && starters.Count == 0)
        {
            Error(headingLines[^1], $"## Starter holds no starter; write one csharp block {{#{id}{FenceReader.StarterSuffix} starter spoken=\"...\"}}");
        }

        if (starters.Count > 1)
        {
            Error(starters[1].Line, "## Starter holds a second starter; a practice file has exactly one");
        }
    }

    // The field index of an admitted heading, or RefusedHeading after reporting.
    private int PracticeHeading(HeadingBlock heading, int line, ref int next)
    {
        var raw = _lines[heading.Line];
        var groups = AttributeGroup.Trailing(raw);
        if (groups.Count > 0)
        {
            var named = groups.Any(g => g.IdCount > 0);
            Error(line, named ? "a practice heading takes no {#id}; the record names the four fields" : "a practice heading takes no attribute");
            return RefusedHeading;
        }

        var at = Array.FindIndex(PracticeFields, f => string.Equals(raw.TrimEnd(), "## " + f, StringComparison.Ordinal));
        if (at < 0)
        {
            Error(line, $"\"{Shown(raw.Trim())}\" is not a practice heading; {HeadingRule}");
            return RefusedHeading;
        }

        if (at != next)
        {
            Error(line, $"## {PracticeFields[at]} is out of order; {HeadingRule}");
            return RefusedHeading;
        }

        next++;
        return at;
    }

    // Statement and Constraints hold prose, Examples text blocks; the starter is the only csharp.
    private BodyBlock? PracticeBlock(Block block, string field, string blockId, int line)
    {
        if (block is FencedCodeBlock { Info: "csharp" })
        {
            Error(line, "a csharp block stands in a practice file only as the starter, under ## Starter");
            return null;
        }

        var examples = string.Equals(field, PracticeFields[1], StringComparison.Ordinal);
        if (examples ? block is not FencedCodeBlock { Info: "text" } : block is not (ParagraphBlock or ListBlock))
        {
            Error(line, examples ? "## Examples holds only text blocks" : $"## {field} holds only paragraphs and lists");
            return null;
        }

        // No csharp block reaches Body from here, so the container is never reported.
        return Body(block, blockId, line, ContainerKind.Section);
    }

    // A paragraph is one segment, a list one per item, a text block its gloss.
    private void PracticeSegments(BodyBlock node, int line)
    {
        switch (node)
        {
            case ParagraphNode paragraph:
                Spans(new BlockTarget { BlockId = paragraph.BlockId }, paragraph.Content, line);
                break;
            case ListNode list:
                foreach (var item in list.Items)
                {
                    Spans(new BlockTarget { BlockId = item.BlockId }, item.Content, _constructLines.GetValueOrDefault(item, line));
                }

                break;
            case TextNode text:
                Segment(new BlockTarget { BlockId = text.BlockId }, text.Spoken, line);
                break;

            // PracticeBlock admits only the kinds above; this keeps a kind added later from passing silently.
            default:
                Error(line, "this block has no spoken form");
                break;
        }
    }

    private sealed record PracticeBodyParts(
        List<BodyBlock> Statement,
        List<BodyBlock> Examples,
        List<BodyBlock> Constraints,
        PracticeStarter Starter,
        int StarterLine,
        SectionSpeech Spoken);
}
