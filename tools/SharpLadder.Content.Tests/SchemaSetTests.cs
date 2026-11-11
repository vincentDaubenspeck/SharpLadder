using System.Text;
using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class SchemaSetTests
{
    // A percent-encoded slash, kept apart so the spelling check sees whole words.
    private const string EncodedSlash = "%2F";

    [Fact]
    public void RepositorySchemaLoads()
    {
        var (set, problems) = SchemaSet.Load(Repository.SchemaFolder);

        Assert.Empty(problems);
        Assert.NotNull(set);
    }

    [Fact]
    public void InvalidDocumentNamesTheLocation()
    {
        var problem = Repository.Schema.Validate("{\"type\":\"chapter\",\"id\":\"ch-x\"}");

        Assert.NotNull(problem);
    }

    [Theory]
    [InlineData("https://example.com/remote.schema.json#/definitions/id")]
    [InlineData("../outside.schema.json#/definitions/id")]
    [InlineData("https://sharpladder.com/elsewhere/body.schema.json#/definitions/id")]
    [InlineData("file:///etc/passwd")]
    public void ReferenceOutsideTheFolderIsRejected(string reference)
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"$ref\": \"#/definitions/id\"", $"\"$ref\": \"{reference}\"");

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.Contains(problems, p => p.Contains($"$ref \"{reference}\" leaves the schema folder", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("\"spoken\": {", "\"dangling\": { \"$ref\": \"#/definitions/does-not-exist\" },\n    \"spoken\": {", "#/definitions/does-not-exist")]
    [InlineData("\"items\": { \"$ref\": \"#/definitions/block\" }", "\"items\": { \"$ref\": \"#/definitions/nope\" }", "#/definitions/nope")]
    [InlineData("\"items\": { \"$ref\": \"#/definitions/block\" }", "\"items\": { \"$ref\": \"#plain-name\" }", "#plain-name")]
    public void ReferenceToAMissingLocationIsRejected(string from, string to, string reference)
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", from, to);

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.Contains($"body.schema.json: $ref \"{reference}\" names no location in body.schema.json", problems, StringComparer.Ordinal);
    }

    [Fact]
    public void ReferenceToAMissingLocationInAnotherFileIsRejected()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "content.schema.json", "body.schema.json#/definitions/body\"", "body.schema.json#/definitions/missing\"");

        Assert.Contains(
            "content.schema.json: $ref \"body.schema.json#/definitions/missing\" names no location in body.schema.json",
            SchemaSet.Load(folder.Path).Problems,
            StringComparer.Ordinal);
    }

    // The loader has its own path to the files, apart from the content root.
    [Theory]
    [InlineData("body.schema.json", "\r\n")]
    [InlineData("body.schema.json", "\r")]
    [InlineData("content.schema.json", "\r\n")]
    public void CarriageReturnInASchemaFileIsRefused(string file, string ending)
    {
        using var folder = CopyOfSchema();
        var path = Path.Combine(folder.Path, file);
        File.WriteAllText(path, File.ReadAllText(path).Replace("\n", ending, StringComparison.Ordinal));

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.Contains($"{file}: file holds a carriage return (CR); save it with LF line endings", problems, StringComparer.Ordinal);
    }

    [Fact]
    public void OneLoneCarriageReturnIsRefused()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"definitions\": {", "\"definitions\": {\r");

        Assert.Null(SchemaSet.Load(folder.Path).Set);
    }

    [Fact]
    public void MalformedKeywordValueIsASetupProblem()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "content.schema.json", "\"minimum\": 1", "\"minimum\": \"not-a-number\"");

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.StartsWith("the schema files do not form a valid draft-07 schema: ", Assert.Single(problems), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("chapters/fixture-basics/chapter.json", "\"id\": \"ch-fixture\"")]
    [InlineData("chapters/fixture-basics/chapter.json", "\"slug\": \"fixture-basics\"")]
    [InlineData("chapters/fixture-basics/chapter.json", "\"blockId\": \"intro/b1\"")]
    [InlineData("chapters/fixture-basics/chapter.json", "\"blockId\": \"intro/b2.i2\"")]
    [InlineData("chapters/fixture-basics/gotchas.json", "\"number\": \"2.2\"")]
    [InlineData("chapters/fixture-basics/gotchas.json", "\"fail\": \"CS1620\"")]
    public void PatternRejectsATrailingLineBreak(string file, string value)
    {
        var json = Encoding.UTF8.GetString(Repository.Compile(Repository.Fixture).Files.Single(f => string.Equals(f.RelativePath, file, StringComparison.Ordinal)).Bytes);
        Assert.Null(Repository.Schema.Validate(json));
        Assert.Contains(value, json, StringComparison.Ordinal);

        var broken = json.Replace(value, value[..^1] + "\\n\"", StringComparison.Ordinal);

        Assert.NotNull(Repository.Schema.Validate(broken));
    }

    [Fact]
    public void NestedIdIsRejected()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"spoken\": {", "\"spoken\": {\n      \"$id\": \"https://example.com/spoken\",");

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.Contains("body.schema.json: a nested $id is not allowed; one $id per file", problems, StringComparer.Ordinal);
    }

    [Fact]
    public void WrongDraftOrIdIsRejected()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "draft-07", "draft-04");

        Assert.Contains(SchemaSet.Load(folder.Path).Problems, p => p.StartsWith("body.schema.json: $schema must be", StringComparison.Ordinal));
    }

    [Fact]
    public void OtherFilesAndFoldersAreRejected()
    {
        using var folder = CopyOfSchema();
        folder.Write("notes.txt", "x\n");
        Directory.CreateDirectory(Path.Combine(folder.Path, "nested"));

        var problems = SchemaSet.Load(folder.Path).Problems;

        Assert.Contains("nested: the schema folder holds only *.schema.json files", problems, StringComparer.Ordinal);
        Assert.Contains("notes.txt: the schema folder holds only *.schema.json files", problems, StringComparer.Ordinal);
    }

    [Fact]
    public void LinkedSchemaFileIsRejected()
    {
        using var folder = CopyOfSchema();
        using var outside = new TempFolder();
        var target = outside.Write("body.schema.json", File.ReadAllText(Path.Combine(folder.Path, "body.schema.json")));
        File.Delete(Path.Combine(folder.Path, "body.schema.json"));
        try
        {
            File.CreateSymbolicLink(Path.Combine(folder.Path, "body.schema.json"), target);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Assert.Skip("this account cannot create symbolic links: " + e.Message);
        }

        var error = Assert.Throws<BoundaryException>(() => SchemaSet.Load(folder.Path));

        Assert.EndsWith("body.schema.json: links and reparse points are not accepted at or below a root folder", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void HardLinkedSchemaFileIsRejected()
    {
        using var folder = CopyOfSchema();
        using var outside = new TempFolder();
        using var hard = Links.Hard(Path.Combine(outside.Path, "second"), Path.Combine(folder.Path, "body.schema.json"));

        var error = Assert.Throws<BoundaryException>(() => SchemaSet.Load(folder.Path));

        Assert.EndsWith("body.schema.json: has 2 hard links; an input file must have exactly one", error.Message, StringComparison.Ordinal);
    }

    // The link is the folder argument itself, so the kernel follows it to the root.
    [Fact]
    public void SchemaFolderGivenThroughALinkLoads()
    {
        using var folder = CopyOfSchema();
        using var parent = new TempFolder();
        var link = Path.Combine(parent.Path, "schema");
        using var linked = Links.Folder(link, folder.Path);

        var (set, problems) = SchemaSet.Load(link);

        Assert.NotNull(set);
        Assert.Empty(problems);
    }

    [Theory]
    [InlineData("#/title")]
    [InlineData("#/definitions/unused/maxLength")]
    public void UnusedReferenceToANonSchemaIsRejected(string reference)
    {
        using var folder = CopyOfSchema();
        Replace(
            folder,
            "body.schema.json",
            "\"definitions\": {",
            $"\"definitions\": {{\n    \"unused\": {{ \"maxLength\": 3 }},\n    \"user\": {{ \"$ref\": \"{reference}\" }},");

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.Equal($"body.schema.json: $ref \"{reference}\" does not name a schema in body.schema.json", Assert.Single(problems));
    }

    [Fact]
    public void UsedReferenceToANonSchemaExitsWithASetupError()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"$ref\": \"#/definitions/id\"", "\"$ref\": \"#/title\"");
        using var work = new TempFolder();
        using var output = new StringWriter { NewLine = "\n" };

        var code = Cli.Run([folder.Path, Repository.Fixture, Path.Combine(work.Path, "out")], output);

        Assert.Equal(2, code);
        Assert.Contains("\n  schema: body.schema.json: $ref \"#/title\" does not name a schema in body.schema.json\n", "\n" + output, StringComparison.Ordinal);
        Assert.DoesNotContain("unexpected error", output.ToString(), StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    // An object reached only through data keywords is not registered by the validator, and its
    // patterns were never compiled at load time; both must stop at setup, not mid-run.
    [Theory]
    [InlineData("{ \"default\": { \"type\": \"string\" } }", "#/definitions/data/default")]
    [InlineData("{ \"default\": { \"pattern\": \"[\" } }", "#/definitions/data/default")]
    [InlineData("{ \"enum\": [{ \"type\": \"string\" }] }", "#/definitions/data/enum/0")]
    [InlineData("{ \"examples\": [{ \"pattern\": \"[\" }] }", "#/definitions/data/examples/0")]
    [InlineData("{ \"$ref\": \"#/definitions/id\", \"properties\": { \"inner\": { \"type\": \"string\" } } }", "#/definitions/data/properties/inner")]
    public void UsedReferenceIntoDataExitsWithASetupError(string data, string reference)
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"definitions\": {", $"\"definitions\": {{\n    \"data\": {data},");
        Replace(folder, "body.schema.json", "\"$ref\": \"#/definitions/id\"", $"\"$ref\": \"{reference}\"");
        using var work = new TempFolder();
        using var output = new StringWriter { NewLine = "\n" };

        var code = Cli.Run([folder.Path, Repository.Fixture, Path.Combine(work.Path, "out")], output);

        Assert.Equal(2, code);
        Assert.Contains($"\n  schema: body.schema.json: $ref \"{reference}\" does not name a schema in body.schema.json\n", "\n" + output, StringComparison.Ordinal);
        Assert.DoesNotContain("unexpected error", output.ToString(), StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Fact]
    public void ReferenceToABooleanSchemaIsAccepted()
    {
        using var folder = CopyOfSchema();
        Replace(
            folder,
            "body.schema.json",
            "\"definitions\": {",
            "\"definitions\": {\n    \"anything\": true,\n    \"nothing\": false,\n    \"user\": { \"$ref\": \"#/definitions/anything\" },\n    \"never\": { \"$ref\": \"#/definitions/nothing\" },");
        Replace(folder, "body.schema.json", "{ \"$ref\": \"#/definitions/id\" },", "{ \"$ref\": \"#/definitions/user\" },");

        AssertFixtureCompiles(folder);
    }

    [Fact]
    public void PercentEncodedPointerResolves()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"$ref\": \"#/definitions/id\"", $"\"$ref\": \"#{EncodedSlash}definitions{EncodedSlash}id\"");

        AssertFixtureCompiles(folder);
    }

    [Fact]
    public void TildeEscapesDecode()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"$ref\": \"#/definitions/id\"", "\"$ref\": \"#/definitions/a~1b\"");
        Replace(
            folder,
            "body.schema.json",
            "\"definitions\": {",
            "\"definitions\": {\n    \"a/b\": { \"$ref\": \"#/definitions/c~0d\" },\n    \"c~d\": { \"$ref\": \"#/definitions/e~01f\" },\n    \"e~1f\": { \"$ref\": \"#/definitions/id\" },");

        AssertFixtureCompiles(folder);
    }

    [Theory]
    [InlineData("#/definitions/a~2b")]
    [InlineData("#/definitions/a%7E2b")]
    [InlineData("#/definitions/a~")]
    [InlineData($"#{EncodedSlash}definitions{EncodedSlash}a~2b")]
    public void IllegalTildeEscapeIsRejected(string reference)
    {
        using var folder = CopyOfSchema();

        // Both raw names exist, so only a strict reading of the escape can reject the reference.
        Replace(
            folder,
            "body.schema.json",
            "\"definitions\": {",
            $"\"definitions\": {{\n    \"a~2b\": {{ \"type\": \"string\" }},\n    \"a~\": {{ \"type\": \"string\" }},\n    \"user\": {{ \"$ref\": \"{reference}\" }},");

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.Contains($"body.schema.json: $ref \"{reference}\" names no location in body.schema.json", problems, StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("\"unused\": { \"pattern\": \"[\" },", "#/definitions/unused/pattern")]
    [InlineData("\"unused\": { \"patternProperties\": { \"(\": {} } },", "#/definitions/unused/patternProperties/(")]
    [InlineData("\"unused\": { \"items\": [{ \"not\": { \"pattern\": \"a{2,1}\" } }] },", "#/definitions/unused/items/0/not/pattern")]
    public void InvalidPatternInAnUnusedSchemaIsASetupProblem(string definition, string location)
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"definitions\": {", "\"definitions\": {\n    " + definition);

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.StartsWith($"body.schema.json: {location} is not a valid regular expression: ", Assert.Single(problems), StringComparison.Ordinal);
    }

    [Fact]
    public void InvalidPatternInAUsedSchemaExitsWithASetupError()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"pattern\": \"^[a-z][a-z0-9-]{0,47}(?![\\\\s\\\\S])\"", "\"pattern\": \"[\"");
        using var work = new TempFolder();
        using var output = new StringWriter { NewLine = "\n" };

        var code = Cli.Run([folder.Path, Repository.Fixture, Path.Combine(work.Path, "out")], output);

        Assert.Equal(2, code);
        Assert.Contains("\n  schema: body.schema.json: #/definitions/id/pattern is not a valid regular expression: ", "\n" + output, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Fact]
    public void PatternTextInsideDataIsNotARegularExpression()
    {
        using var folder = CopyOfSchema();
        Replace(folder, "body.schema.json", "\"definitions\": {", "\"definitions\": {\n    \"unused\": { \"const\": { \"pattern\": \"[\" }, \"enum\": [{ \"pattern\": \"[\" }] },");

        AssertFixtureCompiles(folder);
    }

    private static void AssertFixtureCompiles(TempFolder folder)
    {
        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Empty(problems);
        Assert.Empty(ContentCompiler.Compile(Repository.Fixture, set!, Repository.Fixture).Diagnostics);
    }

    private static TempFolder CopyOfSchema()
    {
        var folder = new TempFolder();
        foreach (var file in Directory.EnumerateFiles(Repository.SchemaFolder))
        {
            File.Copy(file, Path.Combine(folder.Path, Path.GetFileName(file)));
        }

        return folder;
    }

    private static void Replace(TempFolder folder, string file, string from, string to)
    {
        var path = Path.Combine(folder.Path, file);
        var text = File.ReadAllText(path);
        Assert.Contains(from, text, StringComparison.Ordinal);
        File.WriteAllText(path, text.Replace(from, to, StringComparison.Ordinal));
    }
}
