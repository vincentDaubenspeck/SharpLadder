using System.Globalization;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <summary>
/// The walk-it replay vectors shared with the web helper's tests. Their states were worked out by
/// hand and are checked there; here each input is compiled from real source, so the helper is
/// only ever held to sequences the compiler accepts, in the form the compiler emits.
/// </summary>
public sealed class WalkItReplayVectorTests
{
    // The intro is never spoken, so a walk-it there needs no gloss.
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 14, dotnet: 10 }\n---\n\nIntro text.\n\n";
    private const string Part = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## Title {#syn-a}\n\nText.\n";

    private static readonly string VectorFile = Path.Combine(Repository.Root, "tools", "SharpLadder.Content.Tests", "fixtures", "walk-replay", "vectors.json");

    private static readonly Lazy<JsonArray> Replays = new(() => JsonNode.Parse(File.ReadAllText(VectorFile))!["replays"]!.AsArray());

    private static readonly string[] InputKeys = ["dst", "src", "value", "lost"];

    public static TheoryData<string> Names() => [.. Replays.Value.Select(r => (string)r!["name"]!)];

    [Theory]
    [MemberData(nameof(Names))]
    public void TheCompilerAcceptsTheVectorAndEmitsItsInputs(string name)
    {
        var vector = Replays.Value.Single(r => string.Equals((string?)r!["name"], name, StringComparison.Ordinal))!;

        var block = Block(Source(vector));

        Assert.Equal(vector["cells"]!.ToJsonString(), block["cells"]!.ToJsonString());
        Assert.Equal(Inputs(vector["sequences"]!, []), Inputs(block["sequences"]!, ["blockId", "note"]));
    }

    [Fact]
    public void VectorNamesAreUnique()
    {
        var names = Replays.Value.Select(r => (string)r!["name"]!).ToList();

        Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void EveryAcceptedLossIsAVector()
    {
        var vectors = Replays.Value.Select(r => r!["cells"]!.ToJsonString() + " " + Inputs(r["sequences"]!, [])).ToHashSet(StringComparer.Ordinal);

        foreach (var row in WalkItSourceTests.AcceptedLosses())
        {
            var (cells, sequences) = row.Data;
            Assert.Contains(JsonNode.Parse(cells)!.ToJsonString() + " " + Inputs(Compact(sequences), []), vectors);
        }
    }

    // Each sequence's steps reduced to their replay inputs, keys in one order; any key that is
    // neither an input nor expected beside one fails the comparison.
    private static string Inputs(JsonNode sequences, string[] beside) =>
        string.Join(" / ", sequences.AsArray().Select(s => string.Join(' ', s!["steps"]!.AsArray().Select(step =>
        {
            var unknown = step!.AsObject().Select(p => p.Key).Where(k => !InputKeys.Contains(k) && !beside.Contains(k));
            Assert.Empty(unknown);
            return string.Join(',', InputKeys.Where(step.AsObject().ContainsKey).Select(k => k + ":" + (step[k]?.ToJsonString() ?? "null")));
        }))));

    // The compact form of the accepted-loss rows: " / " between sequences, a space between steps,
    // "2<1" a copy, "1=7" a write and a trailing "!" a lost mark.
    private static JsonArray Compact(string sequences) =>
        [.. sequences.Split(" / ").Select(steps => new JsonObject { ["steps"] = new JsonArray([.. steps.Split(' ').Select(CompactStep)]) })];

    private static JsonNode CompactStep(string step)
    {
        var parts = step.TrimEnd('!').Split('<', '=');
        var node = new JsonObject { ["dst"] = int.Parse(parts[0], CultureInfo.InvariantCulture) };
        node[step.Contains('<', StringComparison.Ordinal) ? "src" : "value"] = JsonNode.Parse(parts[1]);
        if (step.EndsWith('!'))
        {
            node["lost"] = true;
        }

        return node;
    }

    private static string Source(JsonNode vector) =>
        $"title: Shift\ncells: {vector["cells"]!.ToJsonString()}\nsequences:\n" + string.Concat(vector["sequences"]!.AsArray().Select((sequence, s) =>
            $"  - name: s{s + 1}\n    intro: I.\n    steps:\n" + string.Concat(sequence!["steps"]!.AsArray().Select(step => $"      - {Step(step!)}\n"))));

    private static string Step(JsonNode step)
    {
        var input = step["src"] is { } src ? $"src: {src.ToJsonString()}" : $"value: {step["value"]!.ToJsonString()}";
        var lost = step["lost"] is null ? string.Empty : $", lost: {step["lost"]!.ToJsonString()}";
        return $"{{ dst: {step["dst"]!.ToJsonString()}, {input}, note: N.{lost} }}";
    }

    private static JsonNode Block(string document)
    {
        using var folder = new TempFolder();
        folder.Write("chapters/c/chapter.md", Chapter + "```walk-it {#walk-shift}\n" + document + "```\n");
        folder.Write("chapters/c/part.md", Part);
        folder.Write("aliases.yml", "slugs: {}\nids: {}\n");
        folder.Write("patterns.yml", "patterns: []\n");
        var result = ContentCompiler.Compile(folder.Path, Repository.Schema, folder.Path);
        Assert.Empty(result.Diagnostics);
        var record = JsonNode.Parse(result.Files.Single(f => string.Equals(f.RelativePath, "chapters/c/chapter.json", StringComparison.Ordinal)).Bytes)!;
        Assert.Null(Repository.Schema.Validate(record.ToJsonString()));
        var block = record["intro"]![1]!;
        Assert.Equal("walk-it", (string?)block["type"]);
        return block;
    }
}
