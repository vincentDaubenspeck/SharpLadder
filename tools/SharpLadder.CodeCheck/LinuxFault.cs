namespace SharpLadder.CodeCheck;

// Test-only faults, reached through InternalsVisibleTo and never through the command line or the
// environment. Each makes the real call fail (a missing image, an invalid descriptor, a missing
// directory), so the cleanup that follows is the production path.
internal enum LinuxFault
{
    /// <summary>No fault: the production behaviour.</summary>
    None,

    /// <summary>The start is given a setsid image that does not exist.</summary>
    Start,

    /// <summary>The child starts without its token, so its harness fails before the start record.</summary>
    StartUp,

    /// <summary>The release line is written to an invalid descriptor.</summary>
    ReleaseWrite,

    /// <summary>The death proof lists a process table that does not exist.</summary>
    Enumeration,
}
