namespace SharpLadder.Content.Tests;

internal sealed record CliResult(int Code, string Output, string Error, byte[] Stdout);
