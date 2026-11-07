namespace SharpLadder.Content.Tests;

internal sealed class TempFolder : IDisposable
{
    public TempFolder() => Path = Directory.CreateTempSubdirectory("sharpladder-content-").FullName;

    public string Path { get; }

    public string Write(string relative, string text)
    {
        var full = System.IO.Path.Combine(Path, relative);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(full)!);
        File.WriteAllText(full, text);
        return full;
    }

    public void Dispose() => Directory.Delete(Path, recursive: true);
}
