using Xunit;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace SharpLadder.Content.Tests;

/// <summary>
/// The walk-it reader behind a stand-in parser: which faults it contains at an advance, and which
/// it leaves to surface.
/// </summary>
public sealed class WalkItYamlTests
{
    private const string Unread = "walk-it block is not valid YAML: its structure could not be read here";

    private const string Accepted = "title: Shift\ncells: [4, \"ab\", null]\nsequences:\n  - name: safe\n    intro: Copy first.\n    steps:\n      - { dst: 2, src: 1, note: Copy. }\n";

    // The stand-in proves containment only: whichever advance faults, the fault ends as a located
    // refusal. It does not show which faults the real parser raises.
    [Theory]
    [InlineData("yaml")]
    [InlineData("argument")]
    [InlineData("state")]
    public void AFaultAtAnyAdvanceIsALocatedRefusal(string kind)
    {
        var events = Count(Accepted);
        for (var good = 0; good <= events; good++)
        {
            using var source = new StringReader(Accepted);
            var parser = new FaultingParser(new Parser(source), good, Fault(kind));

            var (document, line, problem) = WalkItYaml.Read(Accepted, parser);

            if (good == events)
            {
                Assert.NotNull(document);
                continue;
            }

            Assert.Null(document);
            if (string.Equals(kind, "yaml", StringComparison.Ordinal))
            {
                Assert.StartsWith("walk-it block is not valid YAML: ", problem, StringComparison.Ordinal);
                Assert.Equal(3, line);
            }
            else
            {
                Assert.Equal(Unread, problem);
                Assert.Equal((int)Math.Max(1, parser.Current?.Start.Line ?? 1), line);
            }
        }
    }

    // A scalar placed past the end of the text makes the reader's own read of its span fail, and
    // that fault is the reader's, not the author's.
    [Fact]
    public void AFaultInTheReaderItselfIsNotTakenForAYamlError()
    {
        var outside = new Mark(100, 1, 101);
        var parser = new Replay(
            new StreamStart(),
            new DocumentStart(),
            new MappingStart(),
            new Scalar(AnchorName.Empty, TagName.Empty, "title", ScalarStyle.Plain, true, false, Mark.Empty, Mark.Empty),
            new Scalar(AnchorName.Empty, TagName.Empty, "x", ScalarStyle.DoubleQuoted, false, true, outside, outside));

        Assert.Throws<ArgumentOutOfRangeException>(() => WalkItYaml.Read("title: \"x\"", parser));
    }

    private static int Count(string text)
    {
        using var source = new StringReader(text);
        var parser = new Parser(source);
        var count = 0;
        while (parser.MoveNext())
        {
            count++;
        }

        return count;
    }

    private static Exception Fault(string kind) => kind switch
    {
        "yaml" => new YamlException(new Mark(0, 3, 1), new Mark(0, 3, 1), "fault"),
        "argument" => new ArgumentException("fault", nameof(kind)),
        _ => new InvalidOperationException("fault"),
    };

    private sealed class FaultingParser(IParser inner, int good, Exception fault) : IParser
    {
        private int _advances;

        public ParsingEvent? Current => inner.Current;

        public bool MoveNext() => _advances++ < good ? inner.MoveNext() : throw fault;
    }

    private sealed class Replay(params ParsingEvent[] events) : IParser
    {
        private int _next;

        public ParsingEvent? Current { get; private set; }

        public bool MoveNext()
        {
            Current = _next < events.Length ? events[_next++] : null;
            return Current is not null;
        }
    }
}
