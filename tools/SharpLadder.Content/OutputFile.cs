namespace SharpLadder.Content;

internal sealed record OutputFile(string RelativePath, byte[] Bytes, RecordKind? Kind = null);
