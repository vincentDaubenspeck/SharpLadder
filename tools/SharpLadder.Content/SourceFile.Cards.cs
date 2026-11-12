using System.Globalization;
using Markdig.Syntax;

namespace SharpLadder.Content;

/// <content>Cards: the sections of a cards part hold cards alone, each a ### heading and its fields.</content>
internal sealed partial class SourceFile
{
    private const string OnlyCards = "a cards section holds cards only: a ### heading with a {#card-id} and one bullet list of its fields";

    private static readonly string[] CardLabels = ["reach", "build", "why", "traps", "also"];

    private static readonly Dictionary<string, string> CardSpoken = new(StringComparer.Ordinal)
    {
        ["reach"] = "Reach for: ",
        ["build"] = "Build: ",
        ["why"] = "Why: ",
        ["traps"] = "Traps: ",
        ["also"] = "Also: ",
    };

    private List<Card> _cards = [];
    private (string Id, List<Span> Title, int Line)? _card;
    private bool _cardFailed;
    private int _cardBlocks;
    private int _sectionStart;

    // The card IDs this file declares; only these may carry the card prefix.
    public List<string> CardIds { get; } = [];

    private bool ReadCards(List<Block> blocks, List<Section> sections, int? partOrder)
    {
        var before = _diagnostics.Count;
        var inSection = false;
        foreach (var block in blocks)
        {
            var line = block.Line + 1;
            switch (block)
            {
                case LinkReferenceDefinitionGroup definitions:
                    definitions.OfType<LinkReferenceDefinition>().ToList().ForEach(d => Target(d.Url, d.Title, d.Line + 1));
                    break;
                case HeadingBlock { Level: 3, IsSetext: false } heading when inSection:
                    CloseCard();
                    _card = _current is null ? null : CardHeading(heading);
                    _cardFailed = _card is null;
                    break;
                case HeadingBlock heading:
                    CloseCards();
                    _cards = [];
                    _cardBlocks = 0;
                    _sectionStart = _diagnostics.Count;
                    Open(Heading(heading, partOrder, sections.Count + 1, _cards), line, sections);
                    inSection = true;
                    break;

                // A section or card whose heading failed is not compiled, so its blocks add no noise.
                case var _ when inSection && (_current is null || _cardFailed):
                    break;
                case ListBlock list when _card is not null:
                    ReadCard(list);
                    break;
                default:
                    Error(line, inSection ? OnlyCards : "a part file holds nothing before its first ## heading");
                    break;
            }
        }

        CloseCards();
        return _diagnostics.Count == before;
    }

    private void CloseCard()
    {
        if (_card is var (id, _, line))
        {
            Error(line, $"card \"{id}\" has no fields; write one bullet list below its heading");
        }

        _card = null;
        _cardFailed = false;
    }

    private void CloseCards()
    {
        CloseCard();
        if (_current is not null && _cards.Count == 0 && _diagnostics.Count == _sectionStart)
        {
            Error(_headingLine, "a cards section holds at least one card");
        }

        Speak();
    }

    // A card heading carries its id alone: the section, not the card, decides what is spoken.
    private (string Id, List<Span> Title, int Line)? CardHeading(HeadingBlock heading)
    {
        var line = heading.Line + 1;
        var groups = AttributeGroup.Trailing(_lines[heading.Line]);
        var id = groups.Count == 1 ? groups[0].Attributes.Id : null;
        var problem = HeadingProblem(heading, groups, id, 3);
        if (problem is null && groups[0].PropertyNames.Count > 0)
        {
            problem = "a card heading takes its {#id} and nothing else";
        }
        else if (problem is null && !id!.StartsWith(ContentIds.CardPrefix, StringComparison.Ordinal))
        {
            problem = $"card id \"{id}\" must start with {ContentIds.CardPrefix}";
        }

        if (problem is not null)
        {
            Error(line, problem);
            return null;
        }

        var title = Title(heading, line);
        if (title is null)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(SpokenText.Flatten(title)))
        {
            Error(line, "a card title holds text");
            return null;
        }

        Ids.Add((id!, line));
        Anchors.Add(id!);
        CardIds.Add(id!);
        return (id!, title, line);
    }

    private void ReadCard(ListBlock list)
    {
        var (id, title, line) = _card!.Value;
        _card = null;
        var section = _current!.Id;
        var fields = Fields(list, CardLabels, () => string.Create(CultureInfo.InvariantCulture, $"{section}/b{++_cardBlocks}"));
        if (fields is null)
        {
            return;
        }

        var before = _diagnostics.Count;
        foreach (var label in CardLabels.Take(3).Where(l => !fields.ContainsKey(l)))
        {
            Error(line, $"card \"{id}\" has no {label} field; reach, build and why are required");
        }

        if (fields.TryGetValue("reach", out var reach) && reach is not [ParagraphNode])
        {
            Error(line, $"the reach field of card \"{id}\" is one paragraph");
        }

        if (fields.TryGetValue("build", out var build) && build is not ([ParagraphNode] or [CodeNode] or [TextNode { Id: not null }]))
        {
            Error(line, $"the build field of card \"{id}\" is one paragraph or one code block with an id");
        }

        foreach (var label in CardLabels.Skip(3))
        {
            if (fields.TryGetValue(label, out var items) && items is not [ListNode { Ordered: false, Items.Count: 1 or 2 }])
            {
                Error(line, $"the {label} field of card \"{id}\" is \"{label}:\" with a bullet list of one or two items below it");
            }
        }

        if (_diagnostics.Count != before)
        {
            return;
        }

        _cards.Add(new Card
        {
            Id = id,
            Title = title,
            Reach = fields["reach"][0],
            Build = fields["build"][0],
            Why = fields["why"],
            Traps = fields.GetValueOrDefault("traps")?[0],
            Also = fields.GetValueOrDefault("also")?[0],
        });
        CardSpeech(SpokenText.Flatten(title).Trim(), fields, line);
    }

    // Each present field is announced once, on its first segment; the title rides on the first
    // segment of the card and has no target of its own.
    private void CardSpeech(string title, Dictionary<string, List<BodyBlock>> fields, int line)
    {
        foreach (var label in CardLabels)
        {
            if (!fields.TryGetValue(label, out var blocks))
            {
                continue;
            }

            _spokenPrefix = string.Equals(label, "reach", StringComparison.Ordinal) ? $"Card: {title}. {CardSpoken[label]}" : CardSpoken[label];
            blocks.ForEach(block => Segments(block, line));
            _spokenPrefix = null;
        }
    }
}
