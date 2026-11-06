namespace SharpLadder.Policy;

internal enum ConfigLineKind
{
    /// <summary>A line that sets something other than a rule severity.</summary>
    Other,

    /// <summary>A line that sets the severity of one rule.</summary>
    Severity,

    /// <summary>A line that sets the severity of a category or of every rule.</summary>
    Bulk,

    /// <summary>A section header.</summary>
    Section,

    /// <summary>A line that sets nothing: a comment or a blank line.</summary>
    Comment,
}
