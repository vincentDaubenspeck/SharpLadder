using System.Text;

namespace SharpLadder.CodeCheck;

// The result lines of a suite's standard output (PD 9.2). Bytes arrive in order, split anywhere, and
// are decoded as one UTF-8 stream with U+FFFD for each maximal invalid subpart. Only the start of a
// line is kept, so memory stays the same however much the child writes. No I/O, base library only.
internal sealed class CheckLines
{
    public const int MaxDeclared = 200;

    public const int MaxNameLength = 100;

    private const string PassPrefix = "#check pass ";
    private const string FailPrefix = "#check fail ";

    // The prefix, the longest recordable name, a CR before the line feed and one unit that shows the
    // name is longer than the limit.
    private const int KeptLength = 114;

    private readonly Decoder _decoder = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false).GetDecoder();
    private readonly char[] _decoded = new char[4096];
    private readonly char[] _line = new char[KeptLength];
    private readonly List<Check> _checks = [];
    private readonly int _declared;
    private int _length;
    private bool _over;
    private bool _ended;

    public CheckLines(int declared)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(declared, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(declared, MaxDeclared);
        _declared = declared;
    }

    // In arrival order, at most the declared count.
    public IReadOnlyList<Check> Checks => _checks;

    // Result lines past the declared count or with a name over the limit; it saturates, never wraps.
    public int Unrecorded { get; private set; }

    public void Append(ReadOnlySpan<byte> chunk)
    {
        ObjectDisposedException.ThrowIf(_ended, this);
        Decode(chunk, flush: false);
    }

    // A sequence cut off by the end becomes U+FFFD, and a last line without a line feed is a line.
    public void End()
    {
        ObjectDisposedException.ThrowIf(_ended, this);
        Decode([], flush: true);
        _ended = true;
        if (_length > 0)
        {
            EndLine(atLineFeed: false);
        }
    }

    private void Decode(ReadOnlySpan<byte> bytes, bool flush)
    {
        while (true)
        {
            _decoder.Convert(bytes, _decoded, flush, out var used, out var produced, out var completed);
            bytes = bytes[used..];
            foreach (var unit in _decoded.AsSpan(0, produced))
            {
                if (unit == '\n')
                {
                    EndLine(atLineFeed: true);
                }
                else if (_length < KeptLength)
                {
                    _line[_length++] = unit;
                }
                else
                {
                    _over = true;
                }
            }

            if (bytes.IsEmpty && (completed || !flush))
            {
                return;
            }
        }
    }

    private void EndLine(bool atLineFeed)
    {
        var length = _length;
        var over = _over;
        _length = 0;
        _over = false;
        if (atLineFeed && length > 0 && _line[length - 1] == '\r')
        {
            length--;
        }

        var line = _line.AsSpan(0, length);
        bool pass;
        if (line.StartsWith(PassPrefix, StringComparison.Ordinal))
        {
            pass = true;
        }
        else if (line.StartsWith(FailPrefix, StringComparison.Ordinal))
        {
            pass = false;
        }
        else
        {
            return;
        }

        var name = line[PassPrefix.Length..];
        if (over || name.Length > MaxNameLength || _checks.Count == _declared)
        {
            Unrecorded = Unrecorded == int.MaxValue ? Unrecorded : Unrecorded + 1;
            return;
        }

        _checks.Add(new Check(name.ToString(), pass));
    }

    // One recorded result line: the name verbatim, UTF-16 units as the web counts them.
    internal sealed record Check(string Name, bool Pass);
}
