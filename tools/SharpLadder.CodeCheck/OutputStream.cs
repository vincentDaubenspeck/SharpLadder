namespace SharpLadder.CodeCheck;

// The child's two output streams, each drained and capped on its own.
internal enum OutputStream
{
    /// <summary>The child's standard output.</summary>
    StandardOutput,

    /// <summary>The child's standard error.</summary>
    StandardError,
}
