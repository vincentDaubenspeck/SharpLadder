using System.Text.Json.Serialization;

namespace SharpLadder.Content;

// What a spoken segment highlights while it plays: one block or list item, or a whole section.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(BlockTarget), "block")]
[JsonDerivedType(typeof(SectionTarget), "section")]
internal abstract class SegmentTarget
{
}
