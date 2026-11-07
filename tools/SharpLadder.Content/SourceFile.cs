using System.Globalization;
using System.Text.RegularExpressions;
using Markdig;
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
    // Generic attributes stay last, as Markdig requires.
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseYamlFrontMatter()
        .UseGenericAttributes()
        .Build();

    private static readonly IDeserializer Yaml = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .WithDuplicateKeyChecking()
        .Build();

    private readonly List<Diagnostic> _diagnostics;
    private readonly string _path;
    private string[] _lines = [];

    private SourceFile(string path, List<Diagnostic> diagnostics)
    {
        _path = path;
        _diagnostics = diagnostics;
    }

    public object? Model { get; private set; }

    public List<(string Id, int Line)> Ids { get; } = [];

    // The chapter ID a chapter file declares, or the one a part file names.
    public string? ChapterId { get; private set; }

    public static SourceFile Parse(string path, string text, bool isChapter, List<Diagnostic> diagnostics)
    {
        var file = new SourceFile(path, diagnostics);
        file.Compile(text.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n'), isChapter);
        return file;
    }

    private static void AddText(List<Span> spans, string text)
    {
        if (spans.Count > 0 && spans[^1] is TextSpan last)
        {
            spans[^1] = new TextSpan { Text = last.Text + text };
        }
        else
        {
            spans.Add(new TextSpan { Text = text });
        }
    }

    private static string Describe(IMarkdownObject node) => node switch
    {
        QuoteBlock => "block quote",
        ThematicBreakBlock => "thematic break",
        FencedCodeBlock => "code fence",
        CodeBlock => "indented code block",
        LinkReferenceDefinitionGroup => "link reference definition",
        LinkInline { IsImage: true } => "image",
        LinkInline => "link",
        AutolinkInline => "autolink",
        LineBreakInline => "hard line break",
        EmphasisInline => "emphasis other than *em* or **strong**",
        _ => node.GetType().Name,
    };

    [GeneratedRegex(@"^\(Line: \d+, Col: \d+, Idx: \d+\) - \(Line: \d+, Col: \d+, Idx: \d+\): ", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex YamlLocation();

    private static string? HeadingProblem(HeadingBlock heading, List<AttributeGroup> groups, string? id)
    {
        if (heading.IsSetext || heading.Level != 2)
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

        if (id is null || groups[0].ClassCount > 0 || groups[0].Properties.Count > 0)
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

    private void Compile(string text, bool isChapter)
    {
        _lines = text.Split('\n');
        var document = Markdown.Parse(text, Pipeline);
        if (document.Count == 0 || document[0] is not YamlFrontMatterBlock front)
        {
            Error(1, "file must start with YAML front matter between --- lines");
            return;
        }

        var yaml = string.Join('\n', front.Lines.Lines.Take(front.Lines.Count).Select(l => l.Slice.ToString()));
        var sections = new List<Section>();
        var intro = new List<BodyBlock>();
        var blocks = document.Skip(1).ToList();
        if (isChapter)
        {
            var meta = FrontMatter<ChapterFrontMatter>(yaml, front.Line + 1);
            if (meta is null || !FrontMatterId(meta.Id, "id", "chapter id", yaml, front.Line + 1))
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
            var meta = FrontMatter<PartFrontMatter>(yaml, front.Line + 1);
            if (meta is null || !FrontMatterId(meta.Chapter, "chapter", "chapter reference", yaml, front.Line + 1))
            {
                return;
            }

            ChapterId = meta.Chapter;
            if (ReadBody(blocks, null, sections, meta.Order))
            {
                Model = new PartFile { Kind = meta.Kind, Chapter = meta.Chapter, Order = meta.Order, Sections = sections };
            }
        }
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
        var shown = string.Concat(id.Select(c => char.IsControl(c) ? $"\\u{(int)c:x4}" : c.ToString()));
        Error(yamlStart + 1 + Math.Max(0, index), $"{what} \"{shown}\" {ContentIds.FormatRule}");
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
        List<BodyBlock>? body = intro;
        var prefix = ContentIds.IntroPrefix;
        var skipping = false;
        var preambleReported = false;
        foreach (var block in blocks)
        {
            var line = block.Line + 1;
            if (block is HeadingBlock heading)
            {
                var section = Heading(heading, partOrder, sections.Count + 1);
                skipping = section is null;
                if (section is not null)
                {
                    sections.Add(section);
                    body = (List<BodyBlock>)section.Body;
                    prefix = section.Id;
                }

                continue;
            }

            // A section whose heading failed is not compiled, so its blocks add no noise.
            if (skipping)
            {
                continue;
            }

            if (body is null)
            {
                if (!preambleReported)
                {
                    Error(line, "a part file holds nothing before its first ## heading");
                    preambleReported = true;
                }

                continue;
            }

            var blockId = string.Create(CultureInfo.InvariantCulture, $"{prefix}/b{body.Count + 1}");
            var node = Body(block, blockId, line);
            if (node is not null)
            {
                body.Add(node);
            }
        }

        return _diagnostics.Count == before;
    }

    private Section? Heading(HeadingBlock heading, int? partOrder, int position)
    {
        var line = heading.Line + 1;
        var id = HeadingId(heading, line);
        var title = id is null ? null : Inlines(heading.Inline, line);
        if (id is null || title is null)
        {
            return null;
        }

        Ids.Add((id, line));
        return new Section
        {
            Id = id,
            Number = partOrder is int order ? string.Create(CultureInfo.InvariantCulture, $"{order}.{position}") : null,
            Title = title,
            Body = new List<BodyBlock>(),
        };
    }

    // The one terminal {#id}; the groups are counted on the raw line because Markdig merges them.
    private string? HeadingId(HeadingBlock heading, int line)
    {
        var groups = AttributeGroup.Trailing(_lines[heading.Line]);
        var id = groups.Count == 1 ? groups[0].Attributes.Id : null;
        var problem = HeadingProblem(heading, groups, id);
        if (problem is not null)
        {
            Error(line, problem);
            return null;
        }

        return id;
    }

    private BodyBlock? Body(Block block, string blockId, int line)
    {
        switch (block)
        {
            case ParagraphBlock paragraph:
                if (!NoAttributes(paragraph, line))
                {
                    return null;
                }

                var content = Inlines(paragraph.Inline, line);
                return content is null ? null : new ParagraphNode { BlockId = blockId, Content = content };
            case ListBlock list:
                return List(list, blockId, line);
            case FencedCodeBlock fence:
                var node = FenceReader.Read(fence, _lines[fence.Line], blockId, line, Error);
                var fenceId = node switch
                {
                    CodeNode code => code.Id,
                    TextNode text => text.Id,
                    _ => null,
                };
                if (fenceId is not null)
                {
                    Ids.Add((fenceId, line));
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

            var content = NoAttributes(item, itemLine) && NoAttributes(paragraph, itemLine) ? Inlines(paragraph.Inline, itemLine) : null;
            if (content is null)
            {
                ok = false;
                continue;
            }

            items.Add(new ListItemNode { BlockId = string.Create(CultureInfo.InvariantCulture, $"{blockId}.i{items.Count + 1}"), Content = content });
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

    private List<Span>? Inlines(ContainerInline? container, int line)
    {
        var spans = new List<Span>();
        var ok = true;
        foreach (var inline in container ?? Enumerable.Empty<Inline>())
        {
            if (!NoAttributes(inline, line))
            {
                ok = false;
                continue;
            }

            switch (inline)
            {
                case LiteralInline literal:
                    AddText(spans, literal.Content.ToString());
                    break;
                case HtmlEntityInline entity:
                    AddText(spans, entity.Transcoded.ToString());
                    break;
                case LineBreakInline { IsHard: false }:
                    AddText(spans, " ");
                    break;
                case CodeInline code:
                    spans.Add(new CodeSpan { Text = code.Content });
                    break;
                case EmphasisInline { DelimiterCount: 1 or 2 } emphasis when emphasis.DelimiterChar is '*' or '_':
                    var inner = Inlines(emphasis, line);
                    if (inner is null)
                    {
                        ok = false;
                    }
                    else
                    {
                        spans.Add(emphasis.DelimiterCount == 1 ? new EmphasisSpan { Content = inner } : new StrongSpan { Content = inner });
                    }

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
}
