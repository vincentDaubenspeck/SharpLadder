namespace SharpLadder.Content;

// Part is the part kind of a part record, taken from its model; every other file has none.
internal sealed record OutputFile(string RelativePath, byte[] Bytes, RecordKind? Kind = null, string? Part = null);
