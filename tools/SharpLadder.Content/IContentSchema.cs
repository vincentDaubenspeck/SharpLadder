namespace SharpLadder.Content;

// The validator stays behind this interface so it can be replaced without touching the compiler.
internal interface IContentSchema
{
    // Null when the JSON is valid, else one line naming the failing location.
    string? Validate(string json);
}
