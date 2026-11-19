namespace SharpLadder.Content;

// The places a csharp block can stand, as the code check reports them.
internal enum ContainerKind
{
    /// <summary>A chapter's or part's blocks before its first section.</summary>
    Intro,

    /// <summary>A section's own body, outside any approach.</summary>
    Section,

    /// <summary>The body of one approach of a build section.</summary>
    Approach,

    /// <summary>A field of a card.</summary>
    Card,

    /// <summary>The opening blocks of a drill section.</summary>
    Drill,

    /// <summary>The body of a glossary entry.</summary>
    GlossaryEntry,

    /// <summary>A field of an error entry.</summary>
    ErrorEntry,
}
