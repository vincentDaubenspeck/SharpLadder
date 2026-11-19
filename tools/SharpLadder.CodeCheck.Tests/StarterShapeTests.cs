using Microsoft.CodeAnalysis.CSharp;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

// The starter's shape in a starter and suite compilation against the pinned reference set.
public sealed class StarterShapeTests(CompilerFixture fixture) : IClassFixture<CompilerFixture>
{
    private const string Suite = "using System;\nusing Fixture;\n\nConsole.WriteLine(new Tally().Count(\"aa\") == 1 ? \"#check pass one\" : \"#check fail one\");\n";

    private const string Head = "using System;\n\nnamespace Fixture;\n\n";

    [Theory]
    [InlineData(Head + "public sealed class Tally\n{\n    public int Count(string text)\n    {\n        throw new NotImplementedException();\n    }\n}\n")]
    [InlineData(Head + "public sealed class Tally\n{\n    public int Count(string text) => throw new NotImplementedException(\"count them\");\n}\n")]
    [InlineData(Head + "public enum Mark { Open, Closed }\n\npublic interface IShape { int Sides(); }\n\npublic abstract class Shape { public abstract int Size(); }\n\npublic partial class Tally\n{\n    private int _seen;\n\n    public event EventHandler? Changed;\n\n    public int Total { get; set; }\n\n    public int Count(string text) => throw new NotImplementedException();\n\n    partial void Hook();\n}\n")]
    public void StubIsAccepted(string starter) => Assert.Empty(Problems(starter));

    [Theory]
    [InlineData(Head + "public sealed class Tally\n{\n    public int Count(string text) => text.Length;\n}\n", 7, "Fixture.Tally.Count(string) must have only throw new NotImplementedException() as its body")]
    [InlineData("using System;\n\nConsole.WriteLine(\"ready\");\n\nnamespace Fixture\n{\n    public sealed class Tally\n    {\n        public int Count(string text) => throw new NotImplementedException();\n    }\n}\n", 3, "a statement outside a type is not accepted in a starter")]
    [InlineData(Head + "public sealed class Tally\n{\n    private int _seen = 1;\n\n    public int Count(string text) => throw new NotImplementedException();\n}\n", 7, "Fixture.Tally._seen has an initializer; a starter runs nothing")]
    [InlineData(Head + "public sealed class NotImplementedException : Exception\n{\n}\n\npublic sealed class Tally\n{\n    public int Count(string text) => throw new NotImplementedException();\n}\n", 11, "Fixture.Tally.Count(string) throws Fixture.NotImplementedException, not System.NotImplementedException")]
    public void MoreThanAStubIsRefused(string starter, int line, string reason) => Assert.Equal([(line, reason)], Problems(starter));

    private IReadOnlyList<(int Line, string Reason)> Problems(string starter)
    {
        var tree = CSharpSyntaxTree.ParseText(starter, ProgramText.ParseOptions, "starter.cs");
        var suite = CSharpSyntaxTree.ParseText(Suite, ProgramText.ParseOptions, "suite.cs");
        var compilation = CSharpCompilation.Create("StarterShapeTest", [tree, suite], fixture.References, GroupCompiler.Options);
        return StarterShape.Problems(compilation.GetSemanticModel(tree));
    }
}
