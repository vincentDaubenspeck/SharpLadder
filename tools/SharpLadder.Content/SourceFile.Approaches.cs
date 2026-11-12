using Markdig.Syntax;

namespace SharpLadder.Content;

/// <content>Build approaches: alternative ways through one build section, each under a ### heading.</content>
internal sealed partial class SourceFile
{
    private const string ApproachForm = "an approach heading is written ### Title {#id approach=\"label\"}, with one line of shown text as the label and nothing else";

    private readonly Dictionary<string, (string Owner, int Line)> _groups = new(StringComparer.Ordinal);
    private bool _build;
    private List<Approach> _approaches = [];
    private List<BodyBlock>? _approachBody;
    private string _approachId = string.Empty;
    private int _approachLine;
    private int _approachSegments;
    private bool _approachFailed;

    // True when the heading opened an approach, or tried to: a section heading is never read as one.
    private bool ApproachHeading(HeadingBlock heading, bool inSection)
    {
        if (!_build || !inSection || heading is not { Level: 3, IsSetext: false })
        {
            return false;
        }

        EndApproach();
        _approachFailed = true;
        if (_current is null)
        {
            return true;
        }

        var line = heading.Line + 1;
        var groups = AttributeGroup.Trailing(_lines[heading.Line]);
        var id = groups.Count == 1 ? groups[0].Attributes.Id : null;
        var label = HeadingProblem(heading, groups, id, 3) is { } problem ? Refuse(line, problem) : ApproachLabel(groups[0], line);
        var title = label is null ? null : Title(heading, line);
        if (label is null || title is null)
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(SpokenText.Flatten(title)))
        {
            Error(line, "an approach title holds text");
            return true;
        }

        Ids.Add((id!, line));
        Anchors.Add(id!);
        _approachBody = [];
        _approaches.Add(new Approach { Id = id!, Title = title, Label = label, Body = _approachBody });
        (_approachId, _approachLine, _approachSegments, _approachFailed) = (id!, line, _segments.Count, false);
        _spokenPrefix = $"Approach: {label}. ";
        return true;
    }

    private string? Refuse(int line, string problem)
    {
        Error(line, problem);
        return null;
    }

    // The label is the one property beside the id, read the same way by both attribute readers.
    private string? ApproachLabel(AttributeGroup group, int line)
    {
        string[] only = ["approach"];
        var parsed = group.Properties.ToList();
        var label = parsed.Count == 1 ? parsed[0].Value?.Trim() : null;
        if (!group.PropertyNames.SequenceEqual(only, StringComparer.Ordinal) || !parsed.Select(p => p.Key).SequenceEqual(only, StringComparer.Ordinal)
            || label is null || !Storable(label) || !Registries.ShowsSomething(label))
        {
            return Refuse(line, ApproachForm);
        }

        if (_approaches.Any(a => string.Equals(a.Label, label, StringComparison.Ordinal)))
        {
            return Refuse(line, $"approach label \"{Shown(label)}\" is used twice in this section");
        }

        return label;
    }

    private void EndApproach()
    {
        if (_approachBody is { Count: 0 })
        {
            Error(_approachLine, $"approach \"{_approachId}\" has no blocks");
        }
        else if (_approachBody is not null && _current is { Summary: null } && _segments.Count == _approachSegments)
        {
            Error(_approachLine, $"approach \"{_approachId}\" has nothing spoken");
        }

        _approachBody = null;
        _approachFailed = false;
        _spokenPrefix = null;
    }

    // Closes the open section: one approach alone is no alternative, so it is refused.
    private void CloseApproaches()
    {
        EndApproach();
        if (_current is not null && _approaches.Count == 1)
        {
            Error(_approachLine, $"approach \"{_approachId}\" stands alone; a section with approaches holds at least two");
        }
        else if (_current is not null && _approaches.Count > 1)
        {
            _current.Approaches = _approaches;
        }

        _approaches = [];
        Speak();
    }

    // A group is one program, and only one approach is ever shown, so no group reaches across one.
    private void OwnGroup(string group, int line)
    {
        var owner = _approachBody is null ? string.Empty : _approachId;
        if (!_groups.TryGetValue(group, out var first))
        {
            _groups[group] = (owner, line);
        }
        else if (!string.Equals(first.Owner, owner, StringComparison.Ordinal))
        {
            Error(line, $"group \"{Shown(group)}\" is also used at line {first.Line.ToString(System.Globalization.CultureInfo.InvariantCulture)}; the code of an approach forms groups of its own");
        }
    }
}
