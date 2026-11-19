using System.Globalization;

namespace SharpLadder.CodeCheck;

// The fields of one /proc/<pid>/stat line that the death proof reads. The name field may hold any
// byte, a ')' or a space included, so the fields are taken only after its last ')'.
internal readonly record struct ProcessStat(int ProcessId, char State, int ProcessGroup)
{
    // Null unless the line has the kernel's form "<pid> (<name>) <state> <ppid> <pgrp> ..." and ends
    // in a line feed.
    public static ProcessStat? Parse(ReadOnlySpan<byte> line)
    {
        var open = line.IndexOf(" ("u8);
        var close = line.LastIndexOf((byte)')');
        if (open <= 0 || close < open + 2 || line[^1] != (byte)'\n' || !Number(line[..open], out var pid))
        {
            return null;
        }

        var rest = line[(close + 1)..^1];
        if (!Field(ref rest, out var state) || state.Length != 1 || !char.IsAsciiLetter((char)state[0])
            || !Field(ref rest, out var parent) || !Number(parent, out _)
            || !Field(ref rest, out var group) || !Number(group, out var processGroup)
            || rest.IsEmpty)
        {
            return null;
        }

        return new ProcessStat(pid, (char)state[0], processGroup);
    }

    // The next field, which must follow exactly one space.
    private static bool Field(ref ReadOnlySpan<byte> rest, out ReadOnlySpan<byte> field)
    {
        field = default;
        if (rest.IsEmpty || rest[0] != (byte)' ')
        {
            return false;
        }

        rest = rest[1..];
        var end = rest.IndexOf((byte)' ');
        field = end < 0 ? rest : rest[..end];
        rest = end < 0 ? default : rest[end..];
        return !field.IsEmpty;
    }

    private static bool Number(ReadOnlySpan<byte> text, out int value) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value);
}
