namespace SharpLadder.Content;

// Output and Error carry reports; the raw streams carry the test-records envelope and validate's input.
internal sealed record CliStreams(TextWriter Output, TextWriter Error, Func<Stream> OpenStandardOutput, Func<Stream> OpenStandardInput);
