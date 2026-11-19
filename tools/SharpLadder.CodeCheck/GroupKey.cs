namespace SharpLadder.CodeCheck;

// The execution key: same-name blocks of one document form one program, wherever they stand.
internal sealed record GroupKey(string DocumentId, string Group);
