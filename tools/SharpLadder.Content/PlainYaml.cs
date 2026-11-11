using System.Text.Json;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace SharpLadder.Content;

// A registry file read from the YAML event stream as maps, lists and text only. Anchors, aliases,
// tags and merge keys are refused on the events that carry them, never by scanning the text, so
// the same characters inside a comment or a quoted string are ordinary. Every scalar is text:
// nothing is resolved to a number, a boolean or null.
internal sealed class PlainYaml
{
    private const int MaxDepth = 8;

    private readonly Parser _events;
    private readonly string _display;
    private Diagnostic? _problem;

    private PlainYaml(TextReader text, string display)
    {
        _events = new Parser(text);
        _display = display;
    }

    private int Line => (int)Math.Max(1, _events.Current?.Start.Line ?? 1);

    // Root is null exactly when Refusal is set.
    public static (Node? Root, Diagnostic? Refusal) Read(string text, string display)
    {
        using var source = new StringReader(text);
        var reader = new PlainYaml(source, display);
        try
        {
            var root = reader.Document();
            return reader._problem is null ? (root, null) : (null, reader._problem);
        }
        catch (YamlException e)
        {
            return (null, new Diagnostic(display, (int)Math.Max(1, e.Start.Line), "not valid YAML: " + e.Message));
        }
    }

    // Text from a registry file as a diagnostic shows it: quoted, with every odd character escaped.
    public static string Shown(string text) => JsonSerializer.Serialize(text);

    private Node? Document()
    {
        _events.MoveNext();
        _events.MoveNext();
        if (_events.Current is not DocumentStart)
        {
            return Fail("the file holds no document");
        }

        _events.MoveNext();
        var root = Value(1);
        if (root is null)
        {
            return null;
        }

        _events.MoveNext();
        return _events.Current is StreamEnd ? root : Fail("a second document is not accepted");
    }

    // Reads one node and leaves the stream after its last event.
    private Node? Value(int depth)
    {
        if (depth > MaxDepth)
        {
            return Fail("nesting is too deep");
        }

        switch (_events.Current)
        {
            case AnchorAlias:
                return Fail("an alias (*name) is not accepted");
            case Scalar scalar:
                var text = Marked(scalar) ? null : new Text(scalar.Value, Line);
                _events.MoveNext();
                return text;
            case SequenceStart sequence:
                return Marked(sequence) ? null : ReadList(depth);
            case MappingStart mapping:
                return Marked(mapping) ? null : ReadMap(depth);
            default:
                return Fail("unexpected YAML structure");
        }
    }

    private List? ReadList(int depth)
    {
        var line = Line;
        var items = new List<Node>();
        _events.MoveNext();
        while (_events.Current is not SequenceEnd)
        {
            if (Value(depth + 1) is not { } item)
            {
                return null;
            }

            items.Add(item);
        }

        _events.MoveNext();
        return new List(items, line);
    }

    private Map? ReadMap(int depth)
    {
        var line = Line;
        var entries = new List<Entry>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        _events.MoveNext();
        while (_events.Current is not MappingEnd)
        {
            var keyLine = Line;
            if (_events.Current is AnchorAlias)
            {
                Fail("an alias (*name) is not accepted");
                return null;
            }

            if (_events.Current is not Scalar key)
            {
                Fail("a key must be plain text");
                return null;
            }

            if (Marked(key))
            {
                return null;
            }

            if (key.Style == ScalarStyle.Plain && string.Equals(key.Value, "<<", StringComparison.Ordinal))
            {
                Fail("the merge key (<<) is not accepted");
                return null;
            }

            // Keys are compared as decoded, so two spellings of one key are one key.
            if (!seen.Add(key.Value))
            {
                Fail($"duplicate key {Shown(key.Value)}");
                return null;
            }

            _events.MoveNext();
            if (Value(depth + 1) is not { } value)
            {
                return null;
            }

            entries.Add(new Entry(key.Value, keyLine, value));
        }

        _events.MoveNext();
        return new Map(entries, line);
    }

    private bool Marked(NodeEvent node)
    {
        if (!node.Anchor.IsEmpty)
        {
            Fail("an anchor (&name) is not accepted");
            return true;
        }

        if (!node.Tag.IsEmpty)
        {
            Fail("a tag (!name) is not accepted");
            return true;
        }

        return false;
    }

    private Node? Fail(string message)
    {
        _problem ??= new Diagnostic(_display, Line, message);
        return null;
    }

    internal abstract record Node(int Line);

    internal sealed record Text(string Value, int Line) : Node(Line);

    internal sealed record List(IReadOnlyList<Node> Items, int Line) : Node(Line);

    internal sealed record Map(IReadOnlyList<Entry> Entries, int Line) : Node(Line);

    internal sealed record Entry(string Key, int Line, Node Value);
}
