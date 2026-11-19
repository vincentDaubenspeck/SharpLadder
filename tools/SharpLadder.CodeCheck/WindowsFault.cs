namespace SharpLadder.CodeCheck;

// Test-only faults, reached through InternalsVisibleTo and never through the command line or the
// environment. Each makes the real call fail (a missing image, an invalid handle or length), so the
// cleanup that follows is the production path.
internal enum WindowsFault
{
    /// <summary>No fault: the production behaviour.</summary>
    None,

    /// <summary>CreateProcess is given an image that does not exist.</summary>
    Start,

    /// <summary>The child starts without its token, so its harness fails before the start record.</summary>
    StartUp,

    /// <summary>The suspended child is assigned to an invalid job handle.</summary>
    Assignment,

    /// <summary>The resume is called on an invalid thread handle.</summary>
    Resume,

    /// <summary>The release line is written to an invalid handle.</summary>
    ReleaseWrite,

    /// <summary>The job's process count is queried with a buffer of the wrong length.</summary>
    ProcessCount,
}
