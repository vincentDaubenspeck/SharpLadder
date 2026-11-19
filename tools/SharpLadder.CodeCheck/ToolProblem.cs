namespace SharpLadder.CodeCheck;

// The tool or its environment cannot give a verdict; the run ends with exit 2.
internal sealed class ToolProblem : Exception
{
    public ToolProblem()
    {
    }

    public ToolProblem(string message)
        : base(message)
    {
    }

    public ToolProblem(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
