namespace SharpLadder.Content.Tests;

// Hands its bytes over when the code under test disposes it, as the envelope writer does.
internal sealed class CapturingStream(Action<byte[]> captured) : MemoryStream
{
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            captured(ToArray());
        }

        base.Dispose(disposing);
    }
}
