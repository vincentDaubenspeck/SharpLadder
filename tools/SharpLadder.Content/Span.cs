using System.Text.Json.Serialization;

namespace SharpLadder.Content;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(TextSpan), "text")]
[JsonDerivedType(typeof(CodeSpan), "code")]
[JsonDerivedType(typeof(EmphasisSpan), "em")]
[JsonDerivedType(typeof(StrongSpan), "strong")]
[JsonDerivedType(typeof(LinkSpan), "link")]
[JsonDerivedType(typeof(TermSpan), "term")]
internal abstract class Span
{
}
