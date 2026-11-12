using System.Globalization;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace SharpLadder.Content;

/// <content>Drill: each section is one ramp rung, its prose, then the ordered links to its drills.</content>
internal sealed partial class SourceFile
{
    public const string DrillPrefix = "drill-";

    private const string DrillForm = "a drill section is its ## heading, at least one paragraph of prose, then one ordered list of drill links";

    private const string RungAttributeForm = "a drill section heading is written ## Title {#id rung=name}, with nothing else beside the id";

    private const string DrillItemForm = "a drill list item is one link and nothing else: 1. [label](#drill-id)";

    // The ramp's rungs in the order a learner climbs them.
    private static readonly string[] RampRungs = ["foundations", "warm-up", "easy", "medium", "hard"];

    private readonly HashSet<string> _rungs = new(StringComparer.Ordinal);
    private readonly HashSet<string> _drills = new(StringComparer.Ordinal);
    private int _lastRung = -1;

    private bool ReadDrill(List<Block> blocks, List<Section> sections, int? partOrder)
    {
        var before = _diagnostics.Count;
        HeadingBlock? heading = null;
        var parts = new List<Block>();
        foreach (var block in blocks)
        {
            if (block is HeadingBlock next)
            {
                if (heading is not null)
                {
                    ReadRung(heading, parts, sections, partOrder);
                }

                (heading, parts) = (next, []);
            }
            else if (heading is null)
            {
                Error(block.Line + 1, "a part file holds nothing before its first ## heading");
            }
            else
            {
                parts.Add(block);
            }
        }

        if (heading is not null)
        {
            ReadRung(heading, parts, sections, partOrder);
        }

        return _diagnostics.Count == before;
    }

    private void ReadRung(HeadingBlock heading, List<Block> parts, List<Section> sections, int? partOrder)
    {
        var line = heading.Line + 1;
        var groups = AttributeGroup.Trailing(_lines[heading.Line]);
        var id = groups.Count == 1 ? groups[0].Attributes.Id : null;
        var rung = HeadingProblem(heading, groups, id) is { } problem ? Refuse(line, problem) : RungOf(groups[0], line);
        var title = rung is null ? null : Title(heading, line);
        if (rung is null || title is null)
        {
            return;
        }

        if (!Registries.ShowsSomething(SpokenText.Flatten(title)))
        {
            Error(line, "a drill section title holds text");
            return;
        }

        Ids.Add((id!, line));
        Anchors.Add(id!);
        SectionIds.Add(id!);
        var intro = parts.Take(Math.Max(0, parts.Count - 1)).ToList();
        if (parts.Count == 0 || parts[^1] is not ListBlock { IsOrdered: true } list || !intro.Any(b => b is ParagraphBlock))
        {
            Error(parts.Count > 0 ? parts[^1].Line + 1 : line, DrillForm);
            return;
        }

        var body = new List<BodyBlock>();
        var section = new Section
        {
            Id = id!,
            Number = partOrder is int order ? string.Create(CultureInfo.InvariantCulture, $"{order}.{sections.Count + 1}") : null,
            Title = title,
            Rung = rung,
            Body = body,
        };
        Open(section, line, sections);
        var number = 0;
        foreach (var block in intro)
        {
            var blockLine = block.Line + 1;
            var node = Body(block, string.Create(CultureInfo.InvariantCulture, $"{id}/b{++number}"), blockLine);
            if (node is not null)
            {
                body.Add(node);
                Segments(node, blockLine);
            }
        }

        section.Drills = DrillList(list, string.Create(CultureInfo.InvariantCulture, $"{id}/b{++number}"));
        Speak();
    }

    // Each rung appears once, and in ramp order, so the part reads as one climb.
    private string? RungOf(AttributeGroup group, int line)
    {
        string[] only = ["rung"];
        var parsed = group.Properties.ToList();
        var rung = parsed.Count == 1 ? parsed[0].Value : null;
        if (!group.PropertyNames.SequenceEqual(only, StringComparer.Ordinal) || !parsed.Select(p => p.Key).SequenceEqual(only, StringComparer.Ordinal) || rung is null)
        {
            return Refuse(line, RungAttributeForm);
        }

        var at = Array.IndexOf(RampRungs, rung);
        if (at < 0)
        {
            return Refuse(line, $"rung \"{Shown(rung)}\" is not a ramp rung; write one of {string.Join(", ", RampRungs)}");
        }

        if (!_rungs.Add(rung))
        {
            return Refuse(line, $"rung \"{rung}\" is used twice in this drill part");
        }

        if (at < _lastRung)
        {
            return Refuse(line, $"rung \"{rung}\" comes after \"{RampRungs[_lastRung]}\"; rungs follow the ramp order {string.Join(", ", RampRungs)}");
        }

        _lastRung = at;
        return rung;
    }

    private DrillList? DrillList(ListBlock list, string blockId)
    {
        var line = list.Line + 1;
        if (!NoAttributes(list, line))
        {
            return null;
        }

        if (list.OrderedStart is not (null or "1"))
        {
            Error(line, "a drill list starts at 1");
            return null;
        }

        var items = new List<DrillReference>();
        var position = 0;
        var ok = true;
        foreach (var child in list)
        {
            var itemLine = child.Line + 1;
            var itemId = string.Create(CultureInfo.InvariantCulture, $"{blockId}.i{++position}");
            DrillReference? reference = null;
            if (child is ListItemBlock { Count: 1 } item && item[0] is ParagraphBlock paragraph)
            {
                reference = DrillItem(item, paragraph, itemId, itemLine);
            }
            else
            {
                Error(itemLine, DrillItemForm);
            }

            ok = reference is not null && ok;
            if (reference is not null)
            {
                items.Add(reference);
            }
        }

        return ok ? new DrillList { BlockId = blockId, Items = items } : null;
    }

    // The label is the learner's only view of a drill until the drill files exist, so it is
    // plain text, and the target is kept as written for a later stage to resolve.
    private DrillReference? DrillItem(ListItemBlock item, ParagraphBlock paragraph, string blockId, int line)
    {
        if (!NoAttributes(item, line) || !NoAttributes(paragraph, line))
        {
            return null;
        }

        if (paragraph.Inline is not { FirstChild: LinkInline { IsImage: false } link } || link.NextSibling is not null)
        {
            Error(line, DrillItemForm);
            return null;
        }

        if (NestedLink(_path, line, link) is { } nested)
        {
            _diagnostics.Add(nested);
            return null;
        }

        var target = Target(link.Url, link.Title, line);
        var content = Inlines(link, line);
        if (target is null || content is null)
        {
            return null;
        }

        if (target.Chapter is not null || !target.Id.StartsWith(DrillPrefix, StringComparison.Ordinal) || target.Id.Length == DrillPrefix.Length)
        {
            Error(line, $"drill link target \"{Shown(target.Target)}\" names no drill; write [label](#drill-id)");
            return null;
        }

        var label = SpokenText.Flatten(content).Trim();
        if (!content.All(s => s is TextSpan) || !Registries.ShowsSomething(label))
        {
            Error(line, "a drill label is plain text");
            return null;
        }

        if (!_drills.Add(target.Id))
        {
            Error(line, $"drill \"{target.Id}\" is listed twice in this drill part");
            return null;
        }

        Segment(new BlockTarget { BlockId = blockId }, label, line);
        return new DrillReference { BlockId = blockId, Id = target.Id, Label = label };
    }
}
