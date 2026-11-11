namespace SharpLadder.Content;

// What a compiled record is, set from the model it was serialised from, never from its name.
internal enum RecordKind
{
    /// <summary>Owns a slug and the chapter id; the only kind with an intro.</summary>
    Chapter,

    /// <summary>Sections of one chapter under one heading kind; has no slug of its own.</summary>
    Part,

    /// <summary>Retired slugs and ids, each with the live name it ends at; one per content root.</summary>
    Aliases,

    /// <summary>The pattern list, whose ids share the site-wide id table; one per content root.</summary>
    Patterns,
}
