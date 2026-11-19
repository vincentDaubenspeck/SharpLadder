namespace SharpLadder.Content;

// What parsing a practice file knows beyond its record: the line of each front matter key, for
// the checks that span files.
internal sealed record PracticeFile(RecordKind Kind, string Id, string StarterId, IReadOnlyDictionary<string, int> KeyLines);
