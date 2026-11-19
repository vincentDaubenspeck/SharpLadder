using Microsoft.CodeAnalysis.CSharp;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The leak scan's own decoder against the C# lexer, the oracle for every C# entry of its table.
public sealed class LeakDecoderTests
{
    [Theory]
    [InlineData(@"\'")]
    [InlineData(@"\""")]
    [InlineData(@"\\")]
    [InlineData(@"\0")]
    [InlineData(@"\a")]
    [InlineData(@"\b")]
    [InlineData(@"\e")]
    [InlineData(@"\f")]
    [InlineData(@"\n")]
    [InlineData(@"\r")]
    [InlineData(@"\t")]
    [InlineData(@"\v")]
    [InlineData(@"\u0041")]
    [InlineData(@"\uD83D\uDE00")]
    [InlineData(@"\U0001F600")]
    [InlineData(@"\x4")]
    [InlineData(@"\x41")]
    [InlineData(@"\x041")]
    [InlineData(@"\x0041")]
    [InlineData(@"\x00411")]
    public void DecoderMatchesTheCSharpLexer(string escape)
    {
        var token = SyntaxFactory.ParseToken($"\"{escape}\"");

        Assert.False(token.ContainsDiagnostics);
        Assert.Equal(token.ValueText, LeakText.Decode(escape));
    }

    [Theory]
    [InlineData(@"\/", "/")]
    [InlineData(@"\q", @"\q")]
    public void JsonSolidusDecodesAndAnUnknownEscapeStays(string escape, string expected) =>
        Assert.Equal(expected, LeakText.Decode(escape));
}
