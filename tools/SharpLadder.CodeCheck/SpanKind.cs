namespace SharpLadder.CodeCheck;

// What a stretch of a generated Program.cs holds, so a diagnostic is classified by where it is.
internal enum SpanKind
{
    /// <summary>A generated #line directive line.</summary>
    Directive,

    /// <summary>Content copied from a block; it maps to the block's source lines.</summary>
    Source,

    /// <summary>The executing-block marker call, apart from its expected type.</summary>
    Marker,

    /// <summary>A throws block's type as written, inside the marker's typeof.</summary>
    ExpectedType,

    /// <summary>A block's check expression as written; it maps to the block's fence line.</summary>
    Check,

    /// <summary>The generated code around a check expression.</summary>
    CheckWrapper,

    /// <summary>The end-record call.</summary>
    EndRecord,
}
