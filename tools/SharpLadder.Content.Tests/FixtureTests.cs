using System.Collections;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class FixtureTests
{
    [Fact]
    public void FixtureCompilesToOneJsonFilePerSource()
    {
        var result = Repository.Compile(Repository.Fixture);

        Assert.Empty(result.Diagnostics);
        Assert.Equal(
            ["chapters/fixture-basics/chapter.json", "chapters/fixture-basics/gotchas.json", "chapters/fixture-basics/syntax.json"],
            result.Files.Select(f => f.RelativePath),
            StringComparer.Ordinal);
    }

    [Fact]
    public void FixtureFollowsTheIdConventions()
    {
        var files = Repository.Compile(Repository.Fixture).Files.ToDictionary(f => f.RelativePath, f => JsonDocument.Parse(f.Bytes), StringComparer.Ordinal);
        try
        {
            var chapter = files["chapters/fixture-basics/chapter.json"].RootElement;
            Assert.Equal("intro/b1", chapter.GetProperty("intro")[0].GetProperty("blockId").GetString());
            Assert.Equal("intro/b2.i2", chapter.GetProperty("intro")[1].GetProperty("items")[1].GetProperty("blockId").GetString());
            Assert.Equal("fix-parts", chapter.GetProperty("sections")[0].GetProperty("id").GetString());
            Assert.False(chapter.GetProperty("sections")[0].TryGetProperty("number", out _));

            var gotchas = files["chapters/fixture-basics/gotchas.json"].RootElement.GetProperty("sections");
            Assert.Equal("2.2", gotchas[1].GetProperty("number").GetString());
            var fail = gotchas[1].GetProperty("body")[0];
            Assert.Equal("gotcha-fix-out/b1", fail.GetProperty("blockId").GetString());
            Assert.Equal("CS1620", fail.GetProperty("fail").GetString());
            Assert.False(gotchas[1].GetProperty("body")[1].TryGetProperty("id", out _));

            var sum = files["chapters/fixture-basics/syntax.json"].RootElement.GetProperty("sections")[0].GetProperty("body");
            Assert.Equal("Over an array", sum[1].GetProperty("label").GetString());
            Assert.Equal("Shows it", sum[2].GetProperty("spoken").GetString());
            Assert.Equal("syn-fix-sum/b5.i2", sum[4].GetProperty("items")[1].GetProperty("blockId").GetString());
        }
        finally
        {
            foreach (var document in files.Values)
            {
                document.Dispose();
            }
        }
    }

    [Fact]
    public void OutputIsByteIdenticalForCrlfAndLfSources()
    {
        using var lf = new TempFolder();
        using var crlf = new TempFolder();
        Repository.CopyTree(Repository.Fixture, lf.Path, "\n");
        Repository.CopyTree(Repository.Fixture, crlf.Path, "\r\n");
        Assert.Contains("\r\n", File.ReadAllText(Path.Combine(crlf.Path, "chapters", "fixture-basics", "chapter.md")), StringComparison.Ordinal);

        var fromLf = Repository.Compile(lf.Path);
        var fromCrlf = Repository.Compile(crlf.Path);

        Assert.Empty(fromCrlf.Diagnostics);
        Assert.Equal(fromLf.Files.Select(f => f.RelativePath), fromCrlf.Files.Select(f => f.RelativePath), StringComparer.Ordinal);
        Assert.All(fromLf.Files.Zip(fromCrlf.Files), pair => Assert.Equal(pair.First.Bytes, pair.Second.Bytes));
        Assert.DoesNotContain((byte)'\r', fromCrlf.Files.SelectMany(f => f.Bytes));
    }

    [Fact]
    public void OutputDigestMatchesTheCommittedGoldenValue()
    {
        var golden = File.ReadAllText(Repository.GoldenFile).Trim();

        var digest = OutputDigest.Compute(Repository.Compile(Repository.Fixture).Files);

        Assert.Equal(golden, digest);
    }

    [Fact]
    public void EveryModelPropertyHasAnExplicitOrderAndNoDictionary()
    {
        var models = typeof(ContentCompiler).Assembly.GetTypes()
            .Where(t => t.GetCustomAttributes<JsonPolymorphicAttribute>().Any()
                || t.GetProperties().Any(p => p.GetCustomAttribute<JsonPropertyOrderAttribute>() is not null))
            .ToList();

        Assert.NotEmpty(models);
        foreach (var property in models.SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)))
        {
            Assert.True(property.GetCustomAttribute<JsonPropertyOrderAttribute>() is not null, $"{property.DeclaringType!.Name}.{property.Name} has no JsonPropertyOrder");
            Assert.False(IsDictionary(property.PropertyType), $"{property.DeclaringType!.Name}.{property.Name} is a dictionary");
        }
    }

    // A dictionary would need ordinal key sorting to serialise deterministically.
    private static bool IsDictionary(Type type) =>
        typeof(IDictionary).IsAssignableFrom(type)
        || type.GetInterfaces().Append(type).Any(i => i.IsGenericType
            && (i.GetGenericTypeDefinition() == typeof(IDictionary<,>) || i.GetGenericTypeDefinition() == typeof(IReadOnlyDictionary<,>)));
}
