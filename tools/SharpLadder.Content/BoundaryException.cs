namespace SharpLadder.Content;

// A filesystem boundary check that refused or could not be established; the run ends with exit 2
// and nothing written.
internal sealed class BoundaryException : Exception
{
    public BoundaryException()
    {
    }

    public BoundaryException(string message)
        : base(message)
    {
    }

    public BoundaryException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
