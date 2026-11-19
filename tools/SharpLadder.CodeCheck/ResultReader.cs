using System.Globalization;
using System.Text.Json;

namespace SharpLadder.CodeCheck;

// The checker's side of protocol version 1. Bytes are fed as the child writes them; a line stays
// pending until its line feed arrives or the run ends, and the first fault ends the reading, so no
// more than one record's bound is ever buffered.
internal sealed class ResultReader
{
    private readonly string _token;
    private readonly IReadOnlyList<string> _expectedChecks;
    private readonly IReadOnlyList<SourceBlock> _blocks;
    private readonly bool _processGroup;
    private readonly int _maxRecords;
    private readonly byte[] _pending = new byte[WireContract.MaxRecordBytes];
    private int _pendingLength;
    private int _records;

    public ResultReader(string token, CompiledGroup group, bool processGroup)
        : this(token, group.ExpectedChecks, group.Program.Blocks, processGroup, group.ExpectedChecks.Count + 2)
    {
    }

    private ResultReader(string token, IReadOnlyList<string> expectedChecks, IReadOnlyList<SourceBlock> blocks, bool processGroup, int maxRecords)
    {
        _token = token;
        _expectedChecks = expectedChecks;
        _blocks = blocks;
        _processGroup = processGroup;
        _maxRecords = maxRecords;
    }

    public StartRecord? Start { get; private set; }

    public int ChecksRecorded { get; private set; }

    public TerminalRecord? Terminal { get; private set; }

    public RecordFault? Fault { get; private set; }

    private int MaxRecords => _maxRecords;

    // A suite reports on standard output, so its results file holds the start record and nothing else.
    public static ResultReader StartOnly(string token, bool processGroup) => new(token, [], [], processGroup, 1);

    public static string MissingCheck(string blockId, int record) =>
        string.Create(CultureInfo.InvariantCulture, $"the check record of {blockId} is missing before result record {record}");

    public void Append(ReadOnlySpan<byte> bytes)
    {
        while (Fault is null && !bytes.IsEmpty)
        {
            var record = _records + 1;

            // Counted from the first byte, so nothing past the bounds is buffered or parsed.
            if (record > MaxRecords)
            {
                Fault = new(record, string.Create(CultureInfo.InvariantCulture, $"wrote more than {MaxRecords} result records"));
                return;
            }

            if (Terminal is not null)
            {
                Reject(record, "is not expected there");
                return;
            }

            var end = bytes.IndexOf((byte)'\n');
            var part = end < 0 ? bytes : bytes[..end];
            if (_pendingLength + part.Length > WireContract.MaxRecordBytes)
            {
                Reject(record, string.Create(CultureInfo.InvariantCulture, $"is longer than {WireContract.MaxRecordBytes / 1024} KiB"));
                return;
            }

            part.CopyTo(_pending.AsSpan(_pendingLength));
            _pendingLength += part.Length;
            if (end < 0)
            {
                return;
            }

            bytes = bytes[(end + 1)..];
            _records = record;
            Accept(record, _pending.AsMemory(0, _pendingLength));
            _pendingLength = 0;
        }
    }

    // At the child's exit: a record still without its line feed is never completed.
    public void Complete()
    {
        if (Fault is null && _pendingLength > 0)
        {
            Reject(_records + 1, "is malformed");
        }
    }

    private static string? Text(Dictionary<string, JsonElement> fields, string name) =>
        fields.TryGetValue(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? Positive(Dictionary<string, JsonElement> fields, string name) =>
        fields.TryGetValue(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) && number > 0
            ? number
            : null;

    private void Reject(int record, string what) =>
        Fault = new(record, string.Create(CultureInfo.InvariantCulture, $"result record {record} {what}"));

    private void Accept(int record, ReadOnlyMemory<byte> line)
    {
        var parsed = Parse(line);
        if (parsed is null)
        {
            Reject(record, "is malformed");
            return;
        }

        if (record == 1)
        {
            if (parsed.Start is null)
            {
                Reject(record, "is not a start record");
            }
            else
            {
                Start = parsed.Start;
            }

            return;
        }

        switch (parsed.Kind)
        {
            case WireContract.StartKind:
                Reject(record, "repeats an earlier record");
                break;
            case WireContract.CheckKind or WireContract.CheckFailedKind:
                Sequence(record, parsed);
                break;
            case WireContract.EndKind when ChecksRecorded < _expectedChecks.Count:
                Fault = new(record, MissingCheck(_expectedChecks[ChecksRecorded], record));
                break;
            default:
                Terminal = new(parsed.Kind, parsed.BlockId, parsed.ExactTypeMatch, parsed.ActualType, record);
                break;
        }
    }

    // Checks pass in block order; check-failed names the check that was due next.
    private void Sequence(int record, Parsed parsed)
    {
        var blockId = parsed.BlockId!;
        if (_expectedChecks.Take(ChecksRecorded).Contains(blockId, StringComparer.Ordinal))
        {
            Reject(record, "repeats an earlier record");
        }
        else if (ChecksRecorded == _expectedChecks.Count || !string.Equals(_expectedChecks[ChecksRecorded], blockId, StringComparison.Ordinal))
        {
            Reject(record, "is not expected there");
        }
        else if (string.Equals(parsed.Kind, WireContract.CheckKind, StringComparison.Ordinal))
        {
            ChecksRecorded++;
        }
        else
        {
            Terminal = new(parsed.Kind, blockId, false, null, record);
        }
    }

    // Strict per kind: the token of this run, exactly the kind's fields, each of its own type.
    private Parsed? Parse(ReadOnlyMemory<byte> line)
    {
        if (line.Span.StartsWith("\uFEFF"u8))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(line);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            using var properties = document.RootElement.EnumerateObject();
            foreach (var property in properties)
            {
                if (!fields.TryAdd(property.Name, property.Value))
                {
                    return null;
                }
            }

            if (!string.Equals(Text(fields, WireContract.TokenField), _token, StringComparison.Ordinal))
            {
                return null;
            }

            return Text(fields, WireContract.KindField) switch
            {
                WireContract.StartKind => ParseStart(fields),
                WireContract.CheckKind when fields.Count == 3 && Text(fields, WireContract.BlockIdField) is { } blockId =>
                    new Parsed(WireContract.CheckKind, blockId, false, null, null),
                WireContract.CheckFailedKind when fields.Count == 3 && Text(fields, WireContract.BlockIdField) is { } blockId =>
                    new Parsed(WireContract.CheckFailedKind, blockId, false, null, null),
                WireContract.EndKind when fields.Count == 2 => new Parsed(WireContract.EndKind, null, false, null, null),
                WireContract.ExceptionKind => ParseException(fields),
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            // Invalid UTF-8 in a name or a string surfaces only when it is read.
            return null;
        }
    }

    private Parsed? ParseStart(Dictionary<string, JsonElement> fields)
    {
        if (fields.Count != (_processGroup ? 6 : 4)
            || Positive(fields, WireContract.PidField) is not { } pid
            || Text(fields, WireContract.CoreLibraryDirectoryField) is not { Length: > 0 } core)
        {
            return null;
        }

        if (!_processGroup)
        {
            return new Parsed(WireContract.StartKind, null, false, null, new StartRecord(pid, core, null, null));
        }

        return Positive(fields, WireContract.PgidField) is { } group && Positive(fields, WireContract.SidField) is { } session
            ? new Parsed(WireContract.StartKind, null, false, null, new StartRecord(pid, core, group, session))
            : null;
    }

    // blockId is null when no block was executing, otherwise one of this group's blocks.
    private Parsed? ParseException(Dictionary<string, JsonElement> fields)
    {
        if (fields.Count != 5
            || !fields.TryGetValue(WireContract.BlockIdField, out var block)
            || !fields.TryGetValue(WireContract.ExactTypeMatchField, out var match)
            || match.ValueKind is not (JsonValueKind.True or JsonValueKind.False)
            || Text(fields, WireContract.ActualTypeField) is not { Length: <= WireContract.ActualTypeLength } actual)
        {
            return null;
        }

        string? blockId = null;
        if (block.ValueKind == JsonValueKind.String)
        {
            blockId = block.GetString()!;
            if (!_blocks.Any(b => string.Equals(b.BlockId, blockId, StringComparison.Ordinal)))
            {
                return null;
            }
        }
        else if (block.ValueKind != JsonValueKind.Null)
        {
            return null;
        }

        return new Parsed(WireContract.ExceptionKind, blockId, match.ValueKind == JsonValueKind.True, actual, null);
    }

    private sealed record Parsed(string Kind, string? BlockId, bool ExactTypeMatch, string? ActualType, StartRecord? Start);
}
