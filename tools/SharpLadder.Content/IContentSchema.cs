namespace SharpLadder.Content;

// The validator stays behind this interface so it can be replaced without touching the compiler.
internal interface IContentSchema
{
    // Null when the JSON is a valid chapter or part record, else one line naming the failing
    // location.
    string? Validate(string json);

    // The same for a record of one stated kind; a record of another kind is invalid.
    string? Validate(string json, RecordKind kind);
}
