namespace SharpLadder.Content;

// The names in use across a content tree: every chapter slug, every ID, and the IDs that are
// sections or walk-it blocks.
internal sealed record LiveNames(IReadOnlySet<string> Slugs, IReadOnlySet<string> Ids, IReadOnlySet<string> SectionIds, IReadOnlySet<string> WalkIds);
