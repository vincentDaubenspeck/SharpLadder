namespace SharpLadder.CodeCheck;

// How a released child ended, once cleanup has finished. Exited only when the direct child exited,
// both readers finished and no cap was passed; the results file is then read to its end. CapPassed
// names the stream; Running means the deadline passed.
internal sealed record RunEnd(ChildState State, ResultReader Records);
