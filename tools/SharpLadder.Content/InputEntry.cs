namespace SharpLadder.Content;

// Relative uses / separators from the input root. Bytes is null for a folder.
internal sealed record InputEntry(string Name, string Relative, string Display, byte[]? Bytes)
{
    public bool IsFolder => Bytes is null;
}
