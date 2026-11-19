namespace SharpLadder.CodeCheck;

// How a suite run ended, once cleanup has finished and its tool faults are ruled out. Lines holds
// every result line of a completed run; a capped or timed-out run is judged by its state alone.
internal sealed record SuiteEnd(ChildState State, CheckLines Lines);
