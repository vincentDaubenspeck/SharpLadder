using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class DuplicateKeyTests
{
    // \u0074 is the letter t, so both names decode to "type"; the escape stays raw JSON here.
    private const string EscapedTwin = """{"type":1,"\u0074ype":2}""";

    [Theory]
    [InlineData(EscapedTwin)]
    [InlineData("""{"type":1,"type":2}""")]
    [InlineData("""{"a":{"b":{"c":{"d":1,"d":2}}}}""")]
    [InlineData("""[{"a":[{"b":1,"\u0062":2}]}]""")]
    public void DuplicateDecodedNameIsRejected(string json) =>
        Assert.ThrowsAny<JsonException>(() => StrictJson.Parse(json));

    [Theory]
    [InlineData("""{"type":1,"Type":2}""")]
    [InlineData("""{"a":{"d":1},"b":{"d":2}}""")]
    public void DistinctNamesParse(string json) =>
        Assert.NotNull(StrictJson.Parse(json));

    [Theory]
    [InlineData("\"title\": \"Body blocks and inline spans\",", "\"title\": \"Body blocks and inline spans\",\n  \"title\": \"Again\",")]
    [InlineData("\"definitions\": {", "\"definitions\": {\n    \"twin\": " + EscapedTwin + ",")]
    [InlineData("\"text\": { \"type\": \"string\", \"minLength\": 1 }", "\"text\": { \"type\": \"string\", \"minLength\": 1, \"minLength\": 2 }")]
    public void SchemaWithADuplicateNameFailsToLoad(string from, string to)
    {
        using var folder = CopyOfSchema();
        var path = Path.Combine(folder.Path, "body.schema.json");
        var text = File.ReadAllText(path);
        Assert.Contains(from, text, StringComparison.Ordinal);
        File.WriteAllText(path, text.Replace(from, to, StringComparison.Ordinal));

        var (set, problems) = SchemaSet.Load(folder.Path);

        Assert.Null(set);
        Assert.Contains(problems, p => p.StartsWith("body.schema.json: not UTF-8 JSON: ", StringComparison.Ordinal));
    }

    [Fact]
    public void SchemaWithADuplicateNameIsASetupError()
    {
        using var schema = CopyOfSchema();
        var path = Path.Combine(schema.Path, "content.schema.json");
        File.WriteAllText(path, File.ReadAllText(path).Replace("\"definitions\": {", "\"definitions\": {\n    \"twin\": " + EscapedTwin + ",", StringComparison.Ordinal));
        using var work = new TempFolder();
        using var output = new StringWriter { NewLine = "\n" };

        var code = Cli.Run([schema.Path, Repository.Fixture, Path.Combine(work.Path, "out")], output);

        Assert.Equal(2, code);
        Assert.Contains("  schema: content.schema.json: not UTF-8 JSON: ", output.ToString(), StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(work.Path, "out")));
    }

    [Fact]
    public void ValidatedDocumentWithADuplicateNameIsRejected()
    {
        var bytes = Repository.Compile(Repository.Fixture).Files.Single(f => f.RelativePath.EndsWith("syntax.json", StringComparison.Ordinal)).Bytes;
        var json = System.Text.Encoding.UTF8.GetString(bytes);
        Assert.Null(Repository.Schema.Validate(json));

        var twinned = json.Replace("\"kind\": \"syntax\",", "\"kind\": \"syntax\",\n  \"\\u006bind\": \"syntax\",", StringComparison.Ordinal);

        Assert.NotEqual(json, twinned, StringComparer.Ordinal);
        Assert.StartsWith("not JSON without duplicate names: ", Repository.Schema.Validate(twinned), StringComparison.Ordinal);
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
}
