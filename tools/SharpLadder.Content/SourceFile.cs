using System.Globalization;
using System.Text.RegularExpressions;
using Markdig;
using Markdig.Extensions.Tables;
using Markdig.Extensions.Yaml;
using Markdig.Renderers.Html;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using YamlDotNet.Core;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace SharpLadder.Content;

/// <summary>
/// One Markdown source compiled to its model. Only the constructs the content model names are
/// accepted; anything else Markdig recognises is reported, never passed through.
/// </summary>
internal sealed partial class SourceFile
{
    // Generic attributes stay last, as Markdig requires. Inline positions are kept so a pipe
    // can be placed inside or outside a code span.
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseYamlFrontMatter()
        .UsePipeTables()
        .UsePreciseSourceLocation()
        .UseGenericAttributes()
        .Build();

    private static readonly IDeserializer Yaml = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .WithDuplicateKeyChecking()
        .Build();

    // Markdown parsed from the file itself counts its lines from 0 at the file's first line.
    private static readonly LineOrigin InFile = new(1, Fixed: false);

    private readonly List<Diagnostic> _diagnostics;
    private readonly string _path;

    // Compiler-only provenance: the source line each span's text came from, by offset in the
    // span, and the line of each construct that is spoken on its own. Nothing here is emitted.
    private readonly Dictionary<Span, List<(int Offset, int Line)>> _spanLines = new(ReferenceEqualityComparer.Instance);
    private readonly Dictionary<object, int> _constructLines = new(ReferenceEqualityComparer.Instance);
    private readonly Dictionary<TableNode, int[]> _rowLines = new(ReferenceEqualityComparer.Instance);

    private string[] _lines = [];
    private int[] _lineStarts = [];
    private Section? _current;
    private List<Segment> _segments = [];
    private int _headingLine;
    private string? _spokenPrefix;
    private int _spokenPrefixLine;

    private SourceFile(string path, List<Diagnostic> diagnostics)
    {
        _path = path;
        _diagnostics = diagnostics;
    }

    public object? Model { get; private set; }

    public List<(string Id, int Line)> Ids { get; } = [];

    // Each csharp block with what only parsing knows, its lines and owner, for the code check.
    public List<CodeSite> CodeSites { get; } = [];

    // The IDs the renderer writes as id attributes for this file: sections and code or text blocks.
    public List<string> Anchors { get; } = [];

    public List<string> SectionIds { get; } = [];

    public List<LinkTarget> Links { get; } = [];

    // The chapter ID a chapter file declares, or the one a part file names.
    public string? ChapterId { get; private set; }

    public static SourceFile Parse(string path, string text, bool isChapter, List<Diagnostic> diagnostics)
    {
        var file = new SourceFile(path, diagnostics);
        file.Compile(text, isChapter);
        return file;
    }

    [GeneratedRegex(@"^\(Line: \d+, Col: \d+, Idx: \d+\) - \(Line: \d+, Col: \d+, Idx: \d+\): ", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    internal static partial Regex YamlLocation();

    // CommonMark never builds a link inside a link, so this guards the parser, not the author.
    internal static Diagnostic? NestedLink(string path, int line, LinkInline link) =>
        link.Descendants<LinkInline>().Any(l => !l.IsImage)
            ? new Diagnostic(path, line, "a link cannot hold another link")
            : null;

    private static bool HoldsTerm(IEnumerable<Span> spans) =>
        spans.Any(span => span switch
        {
            TermSpan => true,
            EmphasisSpan emphasis => HoldsTerm(emphasis.Content),
            StrongSpan strong => HoldsTerm(strong.Content),
            _ => false,
        });

    // The first span in source order, containers before their content, that matches.
    private static Span? FirstSpan(IEnumerable<Span> spans, Func<Span, bool> match)
    {
        foreach (var span in spans)
        {
            var found = match(span)
                ? span
                : span switch
                {
                    EmphasisSpan emphasis => FirstSpan(emphasis.Content, match),
                    StrongSpan strong => FirstSpan(strong.Content, match),
                    LinkSpan link => FirstSpan(link.Content, match),
                    TermSpan term => FirstSpan(term.Content, match),
                    _ => null,
                };
            if (found is not null)
            {
                return found;
            }
        }

        return null;
    }

    private static string Shown(string text) =>
        string.Concat(text.Select(c => char.IsControl(c) ? $"\\u{(int)c:x4}" : c.ToString()));

    private static bool IsChapterRef(string text) =>
        ContentIds.IsValid(text) && text.StartsWith(ContentIds.ChapterPrefix, StringComparison.Ordinal);

    private static string Describe(IMarkdownObject node) => node switch
    {
        QuoteBlock => "block quote",
        ThematicBreakBlock => "thematic break",
        FencedCodeBlock => "code fence",
        CodeBlock => "indented code block",
        LinkInline { IsImage: true } => "image",
        AutolinkInline => "autolink",
        LineBreakInline => "hard line break",
        EmphasisInline => "emphasis other than *em* or **strong**",
        _ => node.GetType().Name,
    };

    // The source offset each line starts at, as the parser counts offsets.
    private static int[] LineStarts(string[] lines)
    {
        var starts = new int[lines.Length];
        for (var i = 1; i < lines.Length; i++)
        {
            starts[i] = starts[i - 1] + lines[i - 1].Length + 1;
        }

        return starts;
    }

    private static string? HeadingProblem(HeadingBlock heading, List<AttributeGroup> groups, string? id, int level = 2)
    {
        if (heading.IsSetext || heading.Level != level)
        {
            return "only ## headings are supported";
        }

        if (groups.Count == 0)
        {
            return "heading has no {#id}; write exactly one at the end of the heading";
        }

        if (groups.Count > 1 || groups[0].IdCount > 1)
        {
            return "heading has more than one {#id}; write exactly one at the end of the heading";
        }

        if (id is null || groups[0].ClassCount > 0)
        {
            return "heading attributes other than one {#id} are not supported";
        }

        if (!string.Equals(heading.TryGetAttributes()?.Id, id, StringComparison.Ordinal))
        {
            return "the heading {#id} must follow the heading text after a space";
        }

        if (!ContentIds.IsValid(id))
        {
            return $"heading id \"{id}\" {ContentIds.FormatRule}";
        }

        return string.Equals(id, ContentIds.IntroPrefix, StringComparison.Ordinal)
            ? "\"intro\" is reserved for the chapter intro and cannot be a heading id"
            : null;
    }

    // speech=skip and spoken="..." are admitted only together; any other property is refused.
    private static List<string> HeadingSpeech(AttributeGroup group, out bool skip, out string? spoken)
    {
        skip = false;
        spoken = null;

        // The parsed properties decide what is read, so they are held to the same rules as the raw
        // names: the two readers split a group differently where a quote meets a name.
        var parsed = group.Properties.Select(p => p.Key).ToList();
        var problems = NameProblems(group.PropertyNames);
        problems = problems.Count > 0 ? problems : NameProblems(parsed);
        if (problems.Count == 0 && !group.PropertyNames.SequenceEqual(parsed, StringComparer.Ordinal))
        {
            problems.Add("heading attributes must be separated by spaces");
        }

        var values = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var (name, value) in problems.Count > 0 ? [] : group.Properties)
        {
            values[name] = value;
            if (value is null)
            {
                problems.Add($"heading attribute \"{name}\" needs a value");
            }
        }

        if (problems.Count > 0)
        {
            return problems;
        }

        var rule = SpeechRule(values);
        if (rule is not null)
        {
            problems.Add(rule);
        }

        if (problems.Count == 0 && values.ContainsKey("speech"))
        {
            skip = true;
            spoken = values["spoken"];
        }

        return problems;
    }

    private static List<string> NameProblems(IEnumerable<string> names)
    {
        var problems = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in names)
        {
            if (name is not ("speech" or "spoken"))
            {
                problems.Add($"unknown heading attribute \"{name}\"; only speech=skip and spoken=\"...\" are supported");
            }
            else if (!seen.Add(name))
            {
                problems.Add($"heading attribute \"{name}\" is given twice");
            }
        }

        return problems;
    }

    private static string? SpeechRule(Dictionary<string, string?> values)
    {
        var hasSpeech = values.TryGetValue("speech", out var speech);
        var hasSpoken = values.TryGetValue("spoken", out var gloss);
        if (hasSpeech && !string.Equals(speech, "skip", StringComparison.Ordinal))
        {
            return "heading attribute speech must be skip";
        }

        if (hasSpeech != hasSpoken)
        {
            return hasSpeech
                ? "speech=skip needs a spoken summary (spoken=\"...\")"
                : "spoken is allowed on a heading only with speech=skip";
        }

        if (!hasSpoken)
        {
            return null;
        }

        if (gloss!.Trim().Length == 0)
        {
            return "heading spoken summary must not be empty";
        }

        return ContentIds.SpokenLength(gloss) > ContentIds.MaxSpokenLength
            ? $"spoken summary is {ContentIds.SpokenLength(gloss).ToString(CultureInfo.InvariantCulture)} characters; at most 200 are allowed"
            : null;
    }

    private void Compile(string text, bool isChapter)
    {
        if (Front(text) is not var (yaml, start, blocks))
        {
            return;
        }

        var sections = new List<Section>();
        var intro = new List<BodyBlock>();
        if (isChapter)
        {
            var meta = FrontMatter<ChapterFrontMatter>(yaml, start);
            if (meta is null || !FrontMatterId(meta.Id, "id", "chapter id", yaml, start))
            {
                return;
            }

            ChapterId = meta.Id;
            if (meta.Id is not null)
            {
                Ids.Add((meta.Id, 1));
            }

            if (!ReadBody(blocks, intro, sections, null))
            {
                return;
            }

            Model = new ChapterFile
            {
                Id = meta.Id,
                Slug = meta.Slug,
                Title = meta.Title,
                Order = meta.Order,
                Targets = meta.Targets is null ? null : new Targets { Csharp = meta.Targets.Csharp, Dotnet = meta.Targets.Dotnet },
                Intro = intro,
                Sections = sections,
            };
        }
        else
        {
            var meta = FrontMatter<PartFrontMatter>(yaml, start);
            if (meta is null || !FrontMatterId(meta.Chapter, "chapter", "chapter reference", yaml, start))
            {
                return;
            }

            ChapterId = meta.Chapter;
            if (PartKind(meta.Kind, yaml, start))
            {
                CompilePart(meta, blocks, sections);
            }
        }
    }

    private void CompilePart(PartFrontMatter meta, List<Block> blocks, List<Section> sections)
    {
        _build = string.Equals(meta.Kind, PartKinds.Build, StringComparison.Ordinal);
        if (string.Equals(meta.Kind, PartKinds.Hints, StringComparison.Ordinal))
        {
            if (ReadHints(blocks))
            {
                Model = new HintsPartFile { Chapter = meta.Chapter, Order = meta.Order, Sections = [.. Ladders.Select(l => l.Ladder)] };
                BuildCatalogue(meta.Chapter, meta.Order);
            }
        }
        else if (meta.Kind switch
        {
            PartKinds.Cards => ReadCards(blocks, sections, meta.Order),
            PartKinds.Drill => ReadDrill(blocks, sections, meta.Order),
            _ => ReadBody(blocks, null, sections, meta.Order),
        })
        {
            Model = new PartFile { Kind = meta.Kind, Chapter = meta.Chapter, Order = meta.Order, Sections = sections };
        }
    }

    // The compiler dispatches on the part kind, so it names a missing or unread one itself.
    private bool PartKind(string? kind, string yaml, int yamlStart)
    {
        if (PartKinds.IsAdmitted(kind))
        {
            return true;
        }

        var index = Array.FindIndex(yaml.Split('\n'), l => l.StartsWith("kind:", StringComparison.Ordinal));
        var stated = kind is null ? "front matter states no part kind" : $"part kind \"{Shown(kind)}\" is not admitted";
        Error(yamlStart + 1 + Math.Max(0, index), $"{stated}; write kind as one of {PartKinds.Listed()}");
        return false;
    }

    // A missing value is left for the schema to name. A present one meets the heading id grammar,
    // which a quoted YAML string could otherwise pass with an embedded line break.
    private bool FrontMatterId(string? id, string key, string what, string yaml, int yamlStart)
    {
        if (id is null || ContentIds.IsValid(id))
        {
            return true;
        }

        var index = Array.FindIndex(yaml.Split('\n'), l => l.StartsWith(key + ":", StringComparison.Ordinal));
        Error(yamlStart + 1 + Math.Max(0, index), $"{what} \"{Shown(id)}\" {ContentIds.FormatRule}");
        return false;
    }

    // Returns null after reporting; yamlStart is the line number of the opening ---.
    private T? FrontMatter<T>(string yaml, int yamlStart)
        where T : class
    {
        try
        {
            var meta = Yaml.Deserialize<T>(yaml);
            if (meta is null)
            {
                Error(yamlStart + 1, "front matter is empty");
            }

            return meta;
        }
        catch (YamlException e)
        {
            var message = YamlLocation().Replace((e.InnerException ?? e).Message, string.Empty);
            Error(yamlStart + (int)Math.Max(1, e.Start.Line), "front matter: " + message);
            return null;
        }
    }

    // intro is null for a part file, where nothing may precede the first heading.
    private bool ReadBody(List<Block> blocks, List<BodyBlock>? intro, List<Section> sections, int? partOrder)
    {
        var before = _diagnostics.Count;
        var inSection = false;
        var number = 0;
        var preambleReported = false;
        foreach (var block in blocks)
        {
            var line = block.Line + 1;
            if (block is HeadingBlock heading)
            {
                if (!ApproachHeading(heading, inSection))
                {
                    CloseApproaches();
                    Open(Heading(heading, partOrder, sections.Count + 1), line, sections);
                    inSection = true;
                    number = 0;
                }

                continue;
            }

            // Definitions render nothing, so they take no block position; their targets meet the
            // same form rule as inline links even when no link uses them.
            if (block is LinkReferenceDefinitionGroup definitions)
            {
                definitions.OfType<LinkReferenceDefinition>().ToList().ForEach(d => Target(d.Url, d.Title, d.Line + 1));
                continue;
            }

            // A section or approach whose heading failed is not compiled, so its blocks add no noise.
            if (inSection && (_current is null || _approachFailed))
            {
                continue;
            }

            var body = inSection ? _approachBody ?? (List<BodyBlock>)_current!.Body! : intro;
            if (body is null)
            {
                if (!preambleReported)
                {
                    Error(line, "a part file holds nothing before its first ## heading");
                    preambleReported = true;
                }

                continue;
            }

            var prefix = inSection ? _current!.Id : ContentIds.IntroPrefix;
            var container = !inSection ? ContainerKind.Intro : _approachBody is null ? ContainerKind.Section : ContainerKind.Approach;
            BodyBlockOf(body, block, string.Create(CultureInfo.InvariantCulture, $"{prefix}/b{++number}"), line, container);
        }

        CloseApproaches();
        return _diagnostics.Count == before;
    }

    private void BodyBlockOf(List<BodyBlock> body, Block block, string blockId, int line, ContainerKind container)
    {
        var reported = _diagnostics.Count;
        var node = Body(block, blockId, line, container);
        if (node is not null)
        {
            body.Add(node);
            Segments(node, line);
        }

        _approachRefused |= _approachBody is not null && _diagnostics.Count > reported;
    }

    private void Open(Section? section, int line, List<Section> sections)
    {
        _current = section;
        _segments = [];
        _headingLine = line;
        if (section is not null)
        {
            sections.Add(section);
        }
    }

    // One segment per paragraph and per list item; a fence is spoken as its gloss. A walk-it speaks
    // its title, then each sequence's intro and notes as written, each on its own hook, so every
    // step is spoken whichever one is shown. The chapter intro is never spoken, and a skipped
    // section speaks only its summary.
    private void Segments(BodyBlock node, int line)
    {
        if (_current is not { Summary: null })
        {
            return;
        }

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
            case CodeNode code:
                Segment(new BlockTarget { BlockId = code.BlockId }, code.Spoken, line);
                break;
            case TextNode text:
                Segment(new BlockTarget { BlockId = text.BlockId }, text.Spoken, line);
                break;
            case TableNode table:
                Segment(new BlockTarget { BlockId = table.BlockId }, SpokenText.Table(table), line, _ => TableLine(table, line));
                break;
            case WalkItNode walk:
                Spans(new BlockTarget { BlockId = walk.BlockId }, walk.Title, _constructLines.GetValueOrDefault(walk.Title, line));
                foreach (var sequence in walk.Sequences)
                {
                    Spans(new BlockTarget { BlockId = sequence.IntroBlockId }, sequence.Intro, _constructLines.GetValueOrDefault(sequence.Intro, line));
                    foreach (var step in sequence.Steps)
                    {
                        Spans(new BlockTarget { BlockId = step.BlockId }, step.Note, _constructLines.GetValueOrDefault(step.Note, line));
                    }
                }

                break;

            // Every body block kind has a case above; this keeps a kind added later from passing silently.
            default:
                Error(line, "this block has no spoken form");
                break;
        }
    }

    private void Spans(SegmentTarget target, IReadOnlyList<Span> spans, int line) =>
        Segment(target, SpokenText.Flatten(spans), line, index => LineAt(spans, index, line));

    // line is the construct's own; lineAt names the source of a refused character in raw.
    private void Segment(SegmentTarget target, string raw, int line, Func<int, int>? lineAt = null)
    {
        string text;
        try
        {
            text = AudioSlot.Normalise(raw);
        }
        catch (ArgumentException)
        {
            var index = AudioSlot.FirstNotStorable(raw);
            Error(index >= 0 && lineAt is not null ? lineAt(index) : line, "spoken text holds a character that cannot be stored (a lone surrogate or a noncharacter)");
            return;
        }

        if (string.IsNullOrWhiteSpace(text))
        {
            Error(line, "spoken text is empty");
            return;
        }

        // A label is no text of its own, so it joins only a segment that already has some.
        if (_spokenPrefix is { } prefix)
        {
            _spokenPrefix = null;
            if (!AudioSlot.IsStorable(prefix))
            {
                Error(_spokenPrefixLine, "spoken text holds a character that cannot be stored (a lone surrogate or a noncharacter)");
                return;
            }

            text = AudioSlot.Normalise(prefix + raw);
        }

        _segments.Add(new Segment { Target = target, Text = text });
    }

    // Closes the open section: a skipped one speaks its summary alone, targeting the section.
    private void Speak()
    {
        if (_current is not { } section)
        {
            return;
        }

        var before = _diagnostics.Count;
        if (section.Summary is not null)
        {
            _segments = [];
            Segment(new SectionTarget { SectionId = section.Id }, section.Summary, _headingLine);
        }

        var targets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var segment in _segments)
        {
            var key = segment.Target is BlockTarget block ? "block " + block.BlockId : "section " + section.Id;
            if (!targets.Add(key))
            {
                Error(_headingLine, $"two spoken segments share the target {key}");
            }
        }

        if (_diagnostics.Count == before)
        {
            section.Spoken = new SectionSpeech { Segments = _segments, Audio = AudioSlot.Of([.. _segments.Select(s => s.Text)]) };
        }

        _current = null;
    }

    private Section? Heading(HeadingBlock heading, int? partOrder, int position, List<Card>? cards = null)
    {
        var line = heading.Line + 1;
        var id = HeadingId(heading, line, out var skip, out var spoken);
        var title = id is null ? null : Title(heading, line);
        if (id is null || title is null)
        {
            return null;
        }

        Ids.Add((id, line));
        Anchors.Add(id);
        SectionIds.Add(id);
        return new Section
        {
            Id = id,
            Number = partOrder is int order ? string.Create(CultureInfo.InvariantCulture, $"{order}.{position}") : null,
            Title = title,
            Body = cards is null ? new List<BodyBlock>() : null,
            Cards = cards,
            Summary = skip ? spoken : null,
        };
    }

    // The one terminal {#id}; the groups are counted on the raw line because Markdig merges them.
    private string? HeadingId(HeadingBlock heading, int line, out bool skip, out string? spoken)
    {
        skip = false;
        spoken = null;
        var groups = AttributeGroup.Trailing(_lines[heading.Line]);
        var id = groups.Count == 1 ? groups[0].Attributes.Id : null;
        var problem = HeadingProblem(heading, groups, id);
        if (problem is not null)
        {
            Error(line, problem);
            return null;
        }

        var speechProblems = HeadingSpeech(groups[0], out skip, out spoken);
        speechProblems.ForEach(p => Error(line, p));
        if (speechProblems.Count > 0)
        {
            return null;
        }

        return id;
    }

    private BodyBlock? Body(Block block, string blockId, int line, ContainerKind container)
    {
        switch (block)
        {
            case ParagraphBlock paragraph:
                if (!NoAttributes(paragraph, line) || !NoReservedPipe(paragraph))
                {
                    return null;
                }

                var content = Inlines(paragraph.Inline, InFile);
                return content is null ? null : new ParagraphNode { BlockId = blockId, Content = content };
            case ListBlock list:
                return List(list, blockId, line);
            case Table table:
                return Table(table, blockId, line);
            case FencedCodeBlock { Info: WalkLanguage } walk:
                return WalkIt(walk, blockId, line);
            case FencedCodeBlock fence:
                var node = FenceReader.Read(fence, _lines[fence.Line], blockId, line, Error);
                var fenceId = node switch
                {
                    CodeNode code => code.Id,
                    TextNode text => text.Id,
                    _ => null,
                };
                if (node is CodeNode grouped)
                {
                    var owner = CodeOwner();
                    OwnGroup(grouped.Group, owner, line);
                    var firstCodeLine = fence.Lines.Count > 0 ? fence.Lines.Lines[0].Line + 1 : fence.Line + 2;
                    CodeSites.Add(new CodeSite(grouped, fence.Line + 1, firstCodeLine, owner, container));
                }

                if (fenceId is not null)
                {
                    Ids.Add((fenceId, line));
                    Anchors.Add(fenceId);
                }

                return node;
            case HtmlBlock:
                Error(line, "raw HTML is not allowed");
                return null;
            default:
                Error(line, "unsupported Markdown: " + Describe(block));
                return null;
        }
    }

    private ListNode? List(ListBlock list, string blockId, int line)
    {
        if (!NoAttributes(list, line))
        {
            return null;
        }

        var items = new List<ListItemNode>();
        var ok = true;
        foreach (var child in list)
        {
            var itemLine = child.Line + 1;
            if (child is not ListItemBlock item || item.Count != 1 || item[0] is not ParagraphBlock paragraph)
            {
                Error(itemLine, "a list item holds one paragraph only");
                ok = false;
                continue;
            }

            var plain = NoAttributes(item, itemLine) && NoAttributes(paragraph, paragraph.Line + 1) && NoReservedPipe(paragraph);
            var content = plain ? Inlines(paragraph.Inline, InFile) : null;
            if (content is null)
            {
                ok = false;
                continue;
            }

            var listItem = new ListItemNode { BlockId = string.Create(CultureInfo.InvariantCulture, $"{blockId}.i{items.Count + 1}"), Content = content };
            _constructLines[listItem] = itemLine;
            items.Add(listItem);
        }

        if (!ok)
        {
            return null;
        }

        int? start = null;
        if (list.IsOrdered)
        {
            start = int.Parse(list.OrderedStart ?? "1", NumberStyles.None, CultureInfo.InvariantCulture);
        }

        return new ListNode { BlockId = blockId, Ordered = list.IsOrdered, Start = start, Items = items };
    }

    // A heading is a landmark read before its definitions, so a title never opens one.
    private List<Span>? Title(HeadingBlock heading, int line)
    {
        var title = Inlines(heading.Inline, InFile);
        if (title is not null && HoldsTerm(title))
        {
            Error(line, "a heading title may not hold a Term; link the term in the text below it");
            return null;
        }

        return title;
    }

    private void AddText(List<Span> spans, string text, int line)
    {
        if (spans.Count > 0 && spans[^1] is TextSpan last)
        {
            var merged = new TextSpan { Text = last.Text + text };
            var parts = _spanLines.Remove(last, out var earlier) ? earlier : [(0, line)];
            parts.Add((last.Text.Length, line));
            _spanLines[merged] = parts;
            spans[^1] = merged;
        }
        else
        {
            spans.Add(Located(new TextSpan { Text = text }, line));
        }
    }

    // Records the line of a block spoken on its own, apart from its container's line.
    private BodyBlock Placed(BodyBlock node, int line)
    {
        _constructLines[node] = line;
        return node;
    }

    private T Located<T>(T span, int line)
        where T : Span
    {
        _spanLines[span] = [(0, line)];
        return span;
    }

    // The line a span starts on; a span built after parsing has none and takes the fallback.
    private int SpanLine(Span span, int fallback) => _spanLines.TryGetValue(span, out var parts) ? parts[0].Line : fallback;

    // The source line of the character at index in SpokenText.Flatten(spans), whose order and
    // concatenation this follows.
    private int LineAt(IReadOnlyList<Span> spans, int index, int fallback)
    {
        var start = 0;
        foreach (var (text, line) in Runs(spans, fallback))
        {
            if (index < start + text.Length)
            {
                return line;
            }

            start += text.Length;
        }

        return fallback;
    }

    private IEnumerable<(string Text, int Line)> Runs(IReadOnlyList<Span> spans, int fallback)
    {
        foreach (var span in spans)
        {
            var line = SpanLine(span, fallback);
            IEnumerable<(string Text, int Line)> runs = span switch
            {
                TextSpan text => TextRuns(text, line),
                CodeSpan code => [(code.Text, line)],
                EmphasisSpan emphasis => Runs(emphasis.Content, line),
                StrongSpan strong => Runs(strong.Content, line),
                LinkSpan link => Runs(link.Content, line),
                TermSpan term => Runs(term.Content, line),
                _ => [],
            };
            foreach (var run in runs)
            {
                yield return run;
            }
        }
    }

    private IEnumerable<(string Text, int Line)> TextRuns(TextSpan span, int line)
    {
        if (!_spanLines.TryGetValue(span, out var parts))
        {
            yield return (span.Text, line);
            yield break;
        }

        for (var i = 0; i < parts.Count; i++)
        {
            var end = i + 1 < parts.Count ? parts[i + 1].Offset : span.Text.Length;
            yield return (span.Text[parts[i].Offset..end], parts[i].Line);
        }
    }

    // Each node is reported on its own mapped line; children map through the same origin.
    private List<Span>? Inlines(ContainerInline? container, LineOrigin origin)
    {
        var spans = new List<Span>();
        var ok = true;
        foreach (var inline in container ?? Enumerable.Empty<Inline>())
        {
            var line = origin.Of(inline.Line);
            if (!NoAttributes(inline, line))
            {
                ok = false;
                continue;
            }

            switch (inline)
            {
                case LiteralInline literal:
                    AddText(spans, literal.Content.ToString(), line);
                    break;
                case HtmlEntityInline entity:
                    AddText(spans, entity.Transcoded.ToString(), line);
                    break;
                case LineBreakInline { IsHard: false }:
                    AddText(spans, " ", line);
                    break;
                case CodeInline code:
                    spans.Add(Located(new CodeSpan { Text = code.Content }, line));
                    break;
                case EmphasisInline { DelimiterCount: 1 or 2 } emphasis when emphasis.DelimiterChar is '*' or '_':
                    var inner = Inlines(emphasis, origin);
                    if (inner is null)
                    {
                        ok = false;
                    }
                    else
                    {
                        spans.Add(Located<Span>(emphasis.DelimiterCount == 1 ? new EmphasisSpan { Content = inner } : new StrongSpan { Content = inner }, line));
                    }

                    break;
                case LinkInline { IsImage: false } link:
                    ok = Link(spans, link, origin) && ok;
                    break;
                case HtmlInline:
                    Error(line, "raw HTML is not allowed");
                    ok = false;
                    break;
                default:
                    Error(line, "unsupported Markdown: " + Describe(inline));
                    ok = false;
                    break;
            }
        }

        return ok ? spans : null;
    }

    private bool Link(List<Span> spans, LinkInline link, LineOrigin origin)
    {
        var line = origin.Of(link.Line);
        if (NestedLink(_path, line, link) is { } nested)
        {
            _diagnostics.Add(nested);
            return false;
        }

        var target = Target(link.Url, link.Title, line);
        if (link.FirstChild is null)
        {
            Error(line, "link text is empty");
            return false;
        }

        var content = Inlines(link, origin);
        if (target is null || content is null)
        {
            return false;
        }

        // The term- prefix is reserved for glossary entries, so it alone tells a Term from a link.
        if (target.Id.StartsWith(TermPrefix, StringComparison.Ordinal))
        {
            if (target.Chapter is not null)
            {
                Error(line, $"link target \"{target.Target}\" names a glossary entry, which belongs to no chapter; write [text](#{target.Id})");
                return false;
            }

            var term = new TermSpan { Id = target.Id, Content = content };
            Links.Add(target with { Term = term });
            spans.Add(Located(term, line));
            return true;
        }

        var span = new LinkSpan { Id = target.Id, Chapter = target.Chapter, Content = content };
        Links.Add(target with { Span = span });
        spans.Add(Located(span, line));
        return true;
    }

    // Only #id and ch-chapter#id are admitted, checked by the ID grammar alone, so a URL in any
    // spelling fails by form without ever being parsed as one.
    private LinkTarget? Target(string? url, string? title, int line)
    {
        var target = url ?? string.Empty;
        var hash = target.IndexOf('#', StringComparison.Ordinal);
        var chapter = hash < 0 ? target : target[..hash];
        var id = hash < 0 ? null : target[(hash + 1)..];
        string? problem = null;
        if (id is null && IsChapterRef(chapter))
        {
            problem = "names a chapter but no #id; link to a section or block id in it";
        }
        else if (id is null || (chapter.Length > 0 && !IsChapterRef(chapter)) || !ContentIds.IsValid(id))
        {
            problem = "is not an internal target; write [text](#id) or [text](ch-chapter#id)";
        }
        else if (string.Equals(id, ContentIds.IntroPrefix, StringComparison.Ordinal))
        {
            problem = "names \"intro\", which is not a link target";
        }
        else if (!string.IsNullOrEmpty(title))
        {
            problem = "has a title, which links do not take";
        }

        if (problem is not null)
        {
            Error(line, $"link target \"{Shown(target)}\" {problem}");
            return null;
        }

        return new LinkTarget(target, id!, chapter.Length > 0 ? chapter : null, line);
    }

    private bool NoAttributes(IMarkdownObject node, int line)
    {
        var attributes = node.TryGetAttributes();
        if (attributes is null || (attributes.Id is null && attributes.Classes is not { Count: > 0 } && attributes.Properties is not { Count: > 0 }))
        {
            return true;
        }

        Error(line, "attributes are allowed only as a heading's {#id} and on code fences");
        return false;
    }

    private void Error(int line, string message) => _diagnostics.Add(new Diagnostic(_path, line, message));

    // Maps a line of parsed text, counted from 0, to the source line a diagnostic names. A fixed
    // origin names its one line for every node of text with no proven line-for-line map.
    private readonly record struct LineOrigin(int Base, bool Fixed)
    {
        public int Of(int parsed) => Fixed ? Base : Base + parsed;
    }
}
