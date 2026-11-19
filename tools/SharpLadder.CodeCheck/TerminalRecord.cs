namespace SharpLadder.CodeCheck;

// The record that ends a run: end, exception or check-failed. ExactTypeMatch and ActualType belong
// to exception only; Record is its position, for the missing-check reason.
internal sealed record TerminalRecord(string Kind, string? BlockId, bool ExactTypeMatch, string? ActualType, int Record);
