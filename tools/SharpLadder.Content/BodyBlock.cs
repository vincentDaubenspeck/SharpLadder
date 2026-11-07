using System.Text.Json.Serialization;

namespace SharpLadder.Content;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(ParagraphNode), "paragraph")]
[JsonDerivedType(typeof(ListNode), "list")]
[JsonDerivedType(typeof(CodeNode), "code")]
[JsonDerivedType(typeof(TextNode), "text")]
internal abstract class BodyBlock
{
    // Positional, for rendering and highlighting only; never an identity.
    [JsonPropertyOrder(0)]
    public required string BlockId { get; init; }
}
