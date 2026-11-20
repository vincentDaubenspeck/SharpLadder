using System.Globalization;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace SharpLadder.Content;

/// <summary>
/// The body of a walk-it fence read from the YAML event stream as one closed document. A value's
/// type comes only from its position in the document and its scalar style, so nothing is resolved
/// by the YAML core schema: a plain scalar is an integer only by the digit form, null only as the
/// plain word null, and a quoted scalar is always text. Anything else is refused, and reading stops
/// at the first refusal.
/// </summary>
internal sealed class WalkItYaml
{
    public const int MaxCells = 10;
    public const int MaxSequences = 4;
    public const int MaxSteps = 8;
    public const int MaxIndex = 9;
    public const int MaxText = 12;

    // The largest integer every reader of the record holds exactly, compared as text so a longer
    // number is never converted at all.
    private const string MaxMagnitude = "9007199254740991";

    private static readonly string[] RootKeys = ["title", "cells", "sequences"];
    private static readonly string[] SequenceKeys = ["name", "intro", "steps"];
    private static readonly string[] StepKeys = ["dst", "src", "value", "note", "lost"];
    private static readonly string[] OptionalKeys = ["src", "value", "lost"];

    private readonly IParser _events;
    private readonly string _text;
    private (int Line, string Message)? _problem;

    private WalkItYaml(IParser events, string text)
    {
        _events = events;
        _text = text;
    }

    private int Line => (int)Math.Max(1, _events.Current?.Start.Line ?? 1);

    // Line counts from 1 at the first line of the fence's body. Document is null exactly when
    // Problem is set.
    public static (Document? Document, int Line, string? Problem) Read(string text)
    {
        using var source = new StringReader(text);
        return Read(text, new Parser(source));
    }

    // The parser is a parameter so that a test can stand in one that faults.
    internal static (Document? Document, int Line, string? Problem) Read(string text, IParser events)
    {
        var reader = new WalkItYaml(events, text);
        var document = reader.ReadDocument();
        return reader._problem is { } problem ? (null, problem.Line, problem.Message) : (document, 0, null);
    }

    // A scan rather than a timed pattern, so integer admission is timeout-free.
    private static bool IsInteger(string text)
    {
        var digits = text.AsSpan(text.StartsWith('-') ? 1 : 0);
        return digits.Length > 0
            && (digits[0] != '0' || digits.Length == 1)
            && !digits.ContainsAnyExceptInRange('0', '9');
    }

    private static string Shown(string text) => PlainYaml.Shown(text);

    // Digits only, so a longer text is out of range and a text of equal length compares as a number.
    private static bool InRange(string text)
    {
        var digits = text.TrimStart('-');
        return digits.Length < MaxMagnitude.Length
            || (digits.Length == MaxMagnitude.Length && string.CompareOrdinal(digits, MaxMagnitude) <= 0);
    }

    // A surrogate is not a character, so an escape naming one is refused even where the scanner
    // would join a pair of them into one; that join is a second spelling of the character. Every
    // escape is two characters before its digits, and digits never hold a backslash.
    private static bool EscapesSurrogate(ReadOnlySpan<char> quoted)
    {
        for (var i = 0; i + 1 < quoted.Length; i++)
        {
            if (quoted[i] != '\\')
            {
                continue;
            }

            var digits = quoted[i + 1] switch
            {
                'u' => 4,
                'U' => 8,
                _ => 0,
            };
            if (digits > 0 && i + 2 + digits <= quoted.Length
                && uint.TryParse(quoted.Slice(i + 2, digits), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var code)
                && code is >= 0xD800 and <= 0xDFFF)
            {
                return true;
            }

            i++;
        }

        return false;
    }

    private Document? ReadDocument()
    {
        if (!Advance() || !Advance())
        {
            return null;
        }

        if (_events.Current is not DocumentStart start)
        {
            return Fail<Document>("walk-it block holds no YAML document; write its title, cells and sequences", 1);
        }

        if (!start.IsImplicit)
        {
            return Fail<Document>("walk-it block takes no document marker (---) or directive; write its fields directly");
        }

        if (!Advance())
        {
            return null;
        }

        Text? title = null;
        List<Box>? cells = null;
        List<Sequence>? sequences = null;
        var read = ReadMap("the walk-it block", RootKeys, key => key switch
        {
            "title" => (title = ReadText("walk-it title")) is not null,
            "cells" => (cells = ReadList("walk-it cells", MaxCells, ReadCell)) is not null,
            _ => (sequences = ReadList("walk-it sequences", MaxSequences, ReadSequence)) is not null,
        });
        if (!read)
        {
            return null;
        }

        if (_events.Current is not DocumentEnd { IsImplicit: true })
        {
            return Fail<Document>("walk-it block takes no document end marker (...); write its fields directly");
        }

        if (!Advance())
        {
            return null;
        }

        if (_events.Current is not StreamEnd)
        {
            return Fail<Document>("walk-it block holds one YAML document; a second is not accepted");
        }

        return new Document(title!, cells!.ConvertAll(c => c.Value), sequences!);
    }

    private Sequence? ReadSequence()
    {
        Text? name = null;
        Text? intro = null;
        List<Step>? steps = null;
        var read = ReadMap("a walk-it sequence", SequenceKeys, key => key switch
        {
            "name" => (name = ReadName()) is not null,
            "intro" => (intro = ReadText("walk-it intro")) is not null,
            _ => (steps = ReadList("walk-it steps", MaxSteps, ReadStep)) is not null,
        });
        return read ? new Sequence(name!, intro!, steps!) : null;
    }

    private Step? ReadStep()
    {
        var line = Line;
        Slot? dst = null;
        Slot? src = null;
        object? value = null;
        Text? note = null;
        var lost = false;
        var read = ReadMap("a walk-it step", StepKeys, key => key switch
        {
            "dst" => (dst = ReadIndex("dst")) is not null,
            "src" => (src = ReadIndex("src")) is not null,
            "value" => ReadLiteral("walk-it value", nullable: false, out value),
            "note" => (note = ReadText("walk-it note")) is not null,
            _ => lost = ReadLost(),
        });
        if (!read)
        {
            return null;
        }

        return (src is null) == (value is null)
            ? Fail<Step>("a walk-it step copies with src or writes with value, exactly one of them", line)
            : new Step(dst!, src, value, note!, lost, line);
    }

    // Keys are plain text from a closed set, each at most once. Each value is read by the caller's
    // reader for its key, and a missing key is reported on the mapping's first line.
    private bool ReadMap(string what, string[] keys, Func<string, bool> value)
    {
        var line = Line;
        if (ReadNode(what) is not MappingStart)
        {
            return Fail($"{what} is a mapping of {string.Join(", ", keys)}");
        }

        var seen = new List<string>();
        if (!Advance())
        {
            return false;
        }

        while (_events.Current is not MappingEnd)
        {
            if (ReadKey(what, keys, seen) is not { } key || !value(key))
            {
                return false;
            }
        }

        if (!Advance())
        {
            return false;
        }

        var missing = keys.FirstOrDefault(k => !OptionalKeys.Contains(k, StringComparer.Ordinal) && !seen.Contains(k, StringComparer.Ordinal));
        return missing is null || Fail($"{what} has no {missing}", line);
    }

    private string? ReadKey(string what, string[] keys, List<string> seen)
    {
        if (ReadNode("a walk-it key") is not Scalar key)
        {
            return Fail<string>("a walk-it key is plain text, not a list or a mapping");
        }

        string? problem = null;
        if (key.Style != ScalarStyle.Plain)
        {
            problem = $"walk-it key {Shown(key.Value)} is written plain, without quotes";
        }
        else if (string.Equals(key.Value, "<<", StringComparison.Ordinal))
        {
            problem = "the merge key (<<) is not accepted";
        }
        else if (!keys.Contains(key.Value, StringComparer.Ordinal))
        {
            problem = $"unknown key {Shown(key.Value)} in {what}; its keys are {string.Join(", ", keys)}";
        }
        else if (seen.Contains(key.Value, StringComparer.Ordinal))
        {
            problem = $"duplicate key {Shown(key.Value)} in {what}";
        }

        if (problem is not null)
        {
            return Fail<string>(problem);
        }

        seen.Add(key.Value);
        return Advance() ? key.Value : null;
    }

    private List<T>? ReadList<T>(string what, int most, Func<T?> item)
        where T : class
    {
        var line = Line;
        var range = $"1 to {most.ToString(CultureInfo.InvariantCulture)}";
        if (ReadNode(what) is not SequenceStart)
        {
            return Fail<List<T>>($"{what} is a list of {range}");
        }

        var items = new List<T>();
        if (!Advance())
        {
            return null;
        }

        while (_events.Current is not SequenceEnd)
        {
            if (items.Count == most)
            {
                return Fail<List<T>>($"{what} holds more than {most.ToString(CultureInfo.InvariantCulture)}");
            }

            if (item() is not { } next)
            {
                return null;
            }

            items.Add(next);
        }

        if (!Advance())
        {
            return null;
        }

        return items.Count > 0 ? items : Fail<List<T>>($"{what} is empty; it holds {range}", line);
    }

    // A cell is boxed so that a null cell is a value, not a failed read.
    private Box? ReadCell() => ReadLiteral("walk-it cell", nullable: true, out var cell) ? new Box(cell) : null;

    // Text fields take any scalar style, as other YAML text does; the caller reads the text itself.
    private Text? ReadText(string what)
    {
        var line = Line;
        return ReadScalar(what) is { } scalar ? new Text(scalar.Value, line, scalar.Style) : null;
    }

    private Text? ReadName()
    {
        var name = ReadText("walk-it sequence name");
        return name is { Value.Length: 0 } ? Fail<Text>("walk-it sequence name is empty", name.Line) : name;
    }

    private bool ReadLiteral(string what, bool nullable, out object? value)
    {
        value = null;
        var line = Line;
        if (ReadScalar(what) is not { } scalar)
        {
            return false;
        }

        var text = scalar.Value;
        switch (scalar.Style)
        {
            case ScalarStyle.SingleQuoted or ScalarStyle.DoubleQuoted:
                if (ContentIds.SpokenLength(text) > MaxText || text.Any(char.IsControl))
                {
                    return Fail($"{what} {Shown(text)} is text of at most {MaxText.ToString(CultureInfo.InvariantCulture)} characters with no control character", line);
                }

                value = text;
                return true;
            case ScalarStyle.Plain when nullable && string.Equals(text, "null", StringComparison.Ordinal):
                return true;
            case ScalarStyle.Plain when IsInteger(text):
                if (!InRange(text))
                {
                    return Fail($"{what} {text} is outside -{MaxMagnitude} to {MaxMagnitude}", line);
                }

                value = long.Parse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
                return true;
            case ScalarStyle.Plain:
                var admitted = nullable ? "an integer, null or quoted text" : "an integer or quoted text";
                return Fail($"{what} {Shown(text)} is not {admitted}; an integer is digits with an optional leading minus and no leading zero, and text is written in quotes", line);
            default:
                return Fail($"{what} is written as a block scalar (| or >); write an integer, or text in quotes", line);
        }
    }

    private Slot? ReadIndex(string key)
    {
        var line = Line;
        if (ReadScalar("walk-it " + key) is not { } scalar)
        {
            return null;
        }

        var text = scalar.Value;
        if (scalar.Style != ScalarStyle.Plain || !IsInteger(text) || !InRange(text))
        {
            Fail($"walk-it {key} {Shown(text)} is a cell index, written as a plain integer without quotes", line);
            return null;
        }

        var index = long.Parse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        if (index is < 0 or > MaxIndex)
        {
            Fail($"walk-it {key} {text} is outside 0 to {MaxIndex.ToString(CultureInfo.InvariantCulture)}", line);
            return null;
        }

        return new Slot((int)index, line);
    }

    private bool ReadLost()
    {
        var line = Line;
        if (ReadScalar("walk-it lost") is not { } scalar)
        {
            return false;
        }

        return (scalar.Style == ScalarStyle.Plain && string.Equals(scalar.Value, "true", StringComparison.Ordinal))
            || Fail($"walk-it lost {Shown(scalar.Value)} is written as plain true, or the key is left out", line);
    }

    // The next value as a scalar that holds text only, leaving the stream after it.
    private Scalar? ReadScalar(string what)
    {
        if (ReadNode(what) is not Scalar scalar)
        {
            return Fail<Scalar>(what + " is a single value, not a list or a mapping");
        }

        if (scalar.Style == ScalarStyle.DoubleQuoted && EscapesSurrogate(_text.AsSpan((int)scalar.Start.Index, (int)(scalar.End.Index - scalar.Start.Index))))
        {
            return Fail<Scalar>(what + " escapes a surrogate code point, which is not a character; write the character itself");
        }

        return Advance() ? scalar : null;
    }

    // The current event when it opens a node with no alias, anchor or tag; null after reporting.
    private NodeEvent? ReadNode(string what) => _events.Current switch
    {
        AnchorAlias => Fail<NodeEvent>($"{what} is an alias (*name), which is not accepted"),
        NodeEvent { Anchor.IsEmpty: false } => Fail<NodeEvent>($"{what} carries an anchor (&name), which is not accepted"),
        NodeEvent { Tag.IsEmpty: false } => Fail<NodeEvent>($"{what} carries a tag (!name), which is not accepted"),
        NodeEvent node => node,
        _ => Fail<NodeEvent>("unexpected YAML structure in the walk-it block"),
    };

    // Every advance comes through here, so a fault the parser raises on author text becomes the
    // block's located refusal, while a fault in this reader's own logic still surfaces. False means
    // the refusal is recorded and reading stops.
    private bool Advance()
    {
        try
        {
            _events.MoveNext();
            return true;
        }
        catch (YamlException e)
        {
            var message = SourceFile.YamlLocation().Replace((e.InnerException ?? e).Message, string.Empty);
            return Fail("walk-it block is not valid YAML: " + message, (int)Math.Max(1, e.Start.Line));
        }

        // Parser argument checks can reject author text (an escape, a tag) for causes the type hides.
        catch (ArgumentException)
        {
            return Fail("walk-it block is not valid YAML: its structure could not be read here");
        }

        // Some malformed inputs reach a parser or scanner state the library guards with a runtime
        // error rather than a YAML error.
        catch (InvalidOperationException)
        {
            return Fail("walk-it block is not valid YAML: its structure could not be read here");
        }
    }

    private bool Fail(string message, int? line = null)
    {
        _problem ??= (line ?? Line, message);
        return false;
    }

    private T? Fail<T>(string message, int? line = null)
        where T : class
    {
        Fail(message, line);
        return null;
    }

    internal sealed record Document(Text Title, IReadOnlyList<object?> Cells, IReadOnlyList<Sequence> Sequences);

    internal sealed record Sequence(Text Name, Text Intro, IReadOnlyList<Step> Steps);

    internal sealed record Step(Slot Dst, Slot? Src, object? Value, Text Note, bool Lost, int Line);

    // A cell index keeps its line, since only the compiler knows the cell count it is checked against.
    internal sealed record Slot(int Value, int Line);

    // Line is where the scalar starts. Only a literal scalar keeps its lines as written, so only
    // its decoded lines map one for one to the source, from the line after its header.
    internal sealed record Text(string Value, int Line, ScalarStyle Style = ScalarStyle.Plain)
    {
        public int? FirstLine => Style == ScalarStyle.Literal ? Line + 1 : null;
    }

    private sealed record Box(object? Value);
}
