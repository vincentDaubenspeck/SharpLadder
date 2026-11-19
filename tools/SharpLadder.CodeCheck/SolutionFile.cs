namespace SharpLadder.CodeCheck;

// One admitted solution file. Kind is null for the subject's reference, else the wrong kind.
internal sealed record SolutionFile(string Subject, string? Kind, string Display, string Text);
