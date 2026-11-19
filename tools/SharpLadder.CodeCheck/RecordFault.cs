namespace SharpLadder.CodeCheck;

// The first record that broke the contract. A fault in record 1 is a start-up failure (exit 2);
// any later one fails the group.
internal sealed record RecordFault(int Record, string Reason);
