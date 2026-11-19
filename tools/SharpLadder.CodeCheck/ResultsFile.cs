namespace SharpLadder.CodeCheck;

// The child creates the results file itself, so until it exists there is nothing to read. Write
// sharing is allowed because the child keeps the file open for writing while it runs.
internal sealed class ResultsFile(string path) : IDisposable
{
    private readonly byte[] _buffer = new byte[WireContract.MaxRecordBytes];
    private FileStream? _stream;

    public void ReadInto(ResultReader reader)
    {
        if (_stream is null)
        {
            if (!File.Exists(path))
            {
                return;
            }

            _stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, bufferSize: 0);
        }

        int read;
        while (reader.Fault is null && (read = _stream.Read(_buffer)) > 0)
        {
            reader.Append(_buffer.AsSpan(0, read));
        }
    }

    public void Dispose() => _stream?.Dispose();
}
