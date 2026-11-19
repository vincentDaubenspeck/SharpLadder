namespace SharpLadder.CodeCheck;

// One OS's control of a group's child. The shared runner owns the protocol, the deadlines and the
// verdicts; a backend owns start, pipes, termination, the death proof and the reap.
internal interface IRunBackend
{
    // Linux start records carry pgid and sid, which must both equal the started pid.
    bool ReportsProcessGroup { get; }

    // The OS's canonical form, so the observed and the expected runtime directory compare exactly.
    string Canonical(string directory);

    // A failed start throws ToolProblem once the backend has cleaned up whatever it started.
    IRunningChild Start(ChildLaunch launch);
}
