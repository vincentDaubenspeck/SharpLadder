using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <summary>
/// Validator decisions for the type-test matrix: each row's JSON fixture is accepted or refused as
/// recorded, and a refused row validates once its one recorded change is undone.
/// </summary>
public sealed class TypeMatrixTests
{
    private static readonly UTF8Encoding Strict = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private static string Folder => Path.Combine(Repository.Root, "web", "type-tests");

    public static TheoryData<string> RowNames()
    {
        var data = new TheoryData<string>();
        foreach (var row in Rows())
        {
            data.Add(row["name"]!.GetValue<string>());
        }

        return data;
    }

    [Fact]
    public void EveryJsonFixtureIsARecordedRow()
    {
        var recorded = Rows().Select(r => Path.GetFileName(r["json"]!.GetValue<string>())).Order(StringComparer.Ordinal);
        var present = Directory.EnumerateFiles(Path.Combine(Folder, "json")).Select(Path.GetFileName).Order(StringComparer.Ordinal);

        Assert.Equal(recorded, present);
    }

    [Theory]
    [MemberData(nameof(RowNames))]
    public void ValidatorDecisionMatchesTheRecord(string name)
    {
        var row = Rows().Single(r => string.Equals(r["name"]!.GetValue<string>(), name, StringComparison.Ordinal));
        var bytes = File.ReadAllBytes(Path.Combine(Folder, row["json"]!.GetValue<string>()));
        var refused = row["validator"]!.GetValue<string>() switch
        {
            "accepted" => false,
            "refused" => true,
            var other => throw new InvalidOperationException($"{name}: unknown decision {other}"),
        };

        var result = PayloadWorkspace.Invoke(["validate", Repository.SchemaFolder], stdin: bytes);

        Assert.Equal(refused ? 1 : 0, result.Code);
        Assert.EndsWith(refused ? "FAIL content validate\n" : "PASS content validate\n", result.Output, StringComparison.Ordinal);
        Assert.Equal(refused, row["repair"] is not null);
        if (refused)
        {
            var repaired = Repair(JsonNode.Parse(bytes)!, row["repair"]!.AsObject());
            var again = PayloadWorkspace.Invoke(["validate", Repository.SchemaFolder], stdin: Strict.GetBytes(repaired.ToJsonString()));
            Assert.Equal(0, again.Code);
        }
    }

    private static JsonNode Repair(JsonNode document, JsonObject repair)
    {
        var path = repair["path"]!.AsArray();
        Assert.NotEmpty(path);
        var parent = document;
        foreach (var step in path.Take(path.Count - 1))
        {
            parent = Step(parent, step!)!;
        }

        var last = path[^1]!;
        var op = repair["op"]!.GetValue<string>();
        switch (op, last.GetValueKind())
        {
            case ("set", JsonValueKind.String):
                parent.AsObject()[last.GetValue<string>()] = repair["value"]!.DeepClone();
                break;
            case ("set", JsonValueKind.Number):
                parent.AsArray()[last.GetValue<int>()] = repair["value"]!.DeepClone();
                break;
            case ("delete", JsonValueKind.String):
                Assert.True(parent.AsObject().Remove(last.GetValue<string>()));
                break;
            default:
                throw new InvalidOperationException($"unsupported repair {op}");
        }

        return document;
    }

    private static JsonNode? Step(JsonNode node, JsonNode step) =>
        step.GetValueKind() == JsonValueKind.Number ? node.AsArray()[step.GetValue<int>()] : node.AsObject()[step.GetValue<string>()];

    private static IEnumerable<JsonObject> Rows() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(Folder, "matrix.json"), Strict))!["rows"]!.AsArray().Select(r => r!.AsObject());
}
