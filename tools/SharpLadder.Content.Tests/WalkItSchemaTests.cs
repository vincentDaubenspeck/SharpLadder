using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;

namespace SharpLadder.Content.Tests;

/// <summary>
/// The walk-it definitions of the body schema: each refusal is the accepted block with one change.
/// </summary>
public sealed class WalkItSchemaTests
{
    private const string Syntax = "chapters/fixture-basics/syntax.json";

    private const string WalkJson = """
        {
            "type": "walk-it",
            "blockId": "syn-walk/b4",
            "id": "walk-shift-right",
            "title": [{ "type": "text", "text": "Shift right" }],
            "cells": [4, "ab", null],
            "sequences": [
                {
                    "name": "safe",
                    "introBlockId": "syn-walk/b4.1.s0",
                    "intro": [{ "type": "text", "text": "Copy before writing." }],
                    "steps": [
                        { "blockId": "syn-walk/b4.1.s1", "dst": 2, "src": 1, "note": [{ "type": "text", "text": "Copy." }] },
                        { "blockId": "syn-walk/b4.1.s2", "dst": 1, "value": 42, "note": [{ "type": "text", "text": "Write." }], "lost": true },
                        { "blockId": "syn-walk/b4.1.s3", "dst": 0, "value": "x", "note": [{ "type": "text", "text": "Text." }] }
                    ]
                },
                {
                    "name": "wrong",
                    "introBlockId": "syn-walk/b4.2.s0",
                    "intro": [{ "type": "text", "text": "Write first." }],
                    "steps": [
                        { "blockId": "syn-walk/b4.2.s8", "dst": 1, "src": 0, "note": [{ "type": "text", "text": "Copy over." }], "lost": true }
                    ]
                }
            ]
        }
        """;

    private static readonly string[] HookForms = ["blockId", "itemId", "walkIntroId", "walkStepId"];

    [Theory]
    [InlineData(Syntax, "sections/0/body")]
    [InlineData("chapters/fixture-basics/chapter.json", "intro")]
    [InlineData("chapters/fixture-basics/cards.json", "sections/0/cards/0/why")]
    [InlineData("chapters/fixture-basics/build.json", "sections/1/approaches/0/body")]
    [InlineData("glossary/term-fixture-loop.json", "body")]
    [InlineData("errors/err-fixture-null.json", "cause")]
    public void AcceptedWhereAGeneralBodyBlockIs(string file, string blocks)
    {
        var record = Record(file);
        Assert.Null(Repository.Schema.Validate(record.ToJsonString()));

        At(record, blocks).AsArray().Add(Walk());

        Assert.Null(Repository.Schema.Validate(record.ToJsonString()));
    }

    [Theory]
    [InlineData(Syntax, "sections/0/body/4/items/0/content")]
    [InlineData(Syntax, "sections/0/title")]
    [InlineData("chapters/fixture-basics/cards.json", "sections/0/cards/0/why/2/rows/0/0")]
    public void RefusedWhereOnlyInlineContentIs(string file, string spans)
    {
        var record = Record(file);
        At(record, spans).AsArray().Add(Walk());

        Assert.NotNull(Repository.Schema.Validate(record.ToJsonString()));
    }

    [Theory]
    [InlineData("reach")]
    public void RefusedAsACardFieldOtherThanWhy(string field)
    {
        var record = Record("chapters/fixture-basics/cards.json");
        At(record, "sections/0/cards/0").AsObject()[field] = Walk();

        Assert.NotNull(Repository.Schema.Validate(record.ToJsonString()));
    }

    [Theory]
    [InlineData("cells/1", "\"abcdefghijkl\"")]
    [InlineData("cells/1", "\"\"")]
    [InlineData("cells/1", "\"\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\"")]
    [InlineData("cells/1", "\"e\\u0301e\\u0301e\\u0301e\\u0301e\\u0301e\\u0301\"")]
    [InlineData("cells/0", "-9007199254740991")]
    [InlineData("cells/0", "9007199254740991")]
    [InlineData("cells/1", "\"a\\u2028b\"")]
    [InlineData("sequences/0/steps/0/dst", "9")]
    [InlineData("sequences/0/steps/0/src", "9")]
    [InlineData("sequences/0/steps/1/dst", "9")]
    [InlineData("sequences/0/steps/0/dst", "0")]
    [InlineData("sequences/0/steps/0/lost", "true")]
    public void AcceptedWithOneChange(string path, string value)
    {
        Assert.Null(Repository.Schema.Validate(Placed(path, JsonNode.Parse(value))));
    }

    [Theory]
    [InlineData("cells/1", "\"abcdefghijklm\"")]
    [InlineData("cells/1", "\"\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00\\ud83d\\ude00a\"")]
    [InlineData("cells/1", "\"e\\u0301e\\u0301e\\u0301e\\u0301e\\u0301e\\u0301e\"")]
    [InlineData("cells/1", "\"a\\u0007\"")]
    [InlineData("cells/1", "\"a\\u007f\"")]
    [InlineData("cells/1", "\"a\\u0085\"")]
    [InlineData("cells/1", "true")]
    [InlineData("cells/0", "1.5")]
    [InlineData("cells/0", "9007199254740992")]
    [InlineData("cells/0", "-9007199254740992")]
    [InlineData("sequences/0/steps/0/dst", "10")]
    [InlineData("sequences/0/steps/0/src", "10")]
    [InlineData("sequences/0/steps/1/dst", "10")]
    [InlineData("sequences/0/steps/1/dst", "-1")]
    [InlineData("cells", "[]")]
    [InlineData("sequences", "[]")]
    [InlineData("sequences/0/steps", "[]")]
    [InlineData("sequences/0/steps/1/value", "null")]
    [InlineData("sequences/0/steps/0/value", "1")]
    [InlineData("sequences/0/steps/1/src", "0")]
    [InlineData("sequences/0/steps/0/lost", "false")]
    [InlineData("sequences/0/steps/0/dst", "-1")]
    [InlineData("sequences/0/steps/0/src", "-1")]
    [InlineData("sequences/0/steps/0/dst", "1.5")]
    [InlineData("sequences/0/steps/0/note", "[]")]
    [InlineData("sequences/0/steps/0/blockId", "\"syn-walk/b4.1.s0\"")]
    [InlineData("sequences/0/introBlockId", "\"syn-walk/b4.1.s1\"")]
    [InlineData("sequences/0/introBlockId", "\"syn-walk/b4.1.s0\\n\"")]
    [InlineData("sequences/0/name", "\"\"")]
    [InlineData("sequences/0/extra", "1")]
    [InlineData("sequences/0/steps/0/extra", "1")]
    [InlineData("id", "\"swap-smaller\"")]
    [InlineData("id", "\"walk-\"")]
    [InlineData("id", "\"walk-A\"")]
    [InlineData("blockId", "\"syn-walk/b4.1.s0\"")]
    [InlineData("type", "\"walk_it\"")]
    [InlineData("extra", "1")]
    public void RefusedWithOneChange(string path, string value)
    {
        Assert.NotNull(Repository.Schema.Validate(Placed(path, JsonNode.Parse(value))));
    }

    [Theory]
    [InlineData("id")]
    [InlineData("blockId")]
    [InlineData("title")]
    [InlineData("cells")]
    [InlineData("sequences")]
    [InlineData("sequences/0/name")]
    [InlineData("sequences/0/introBlockId")]
    [InlineData("sequences/0/intro")]
    [InlineData("sequences/0/steps")]
    [InlineData("sequences/0/steps/0/blockId")]
    [InlineData("sequences/0/steps/0/dst")]
    [InlineData("sequences/0/steps/0/src")]
    [InlineData("sequences/0/steps/0/note")]
    [InlineData("sequences/0/steps/1/value")]
    public void RefusedWithoutARequiredProperty(string path)
    {
        var walk = Walk();
        var slash = path.LastIndexOf('/');
        var parent = slash < 0 ? walk : At(walk, path[..slash]);
        Assert.True(parent.AsObject().Remove(path[(slash + 1)..]));

        Assert.NotNull(Repository.Schema.Validate(Placed(walk)));
    }

    [Theory]
    [InlineData("cells", 10, true)]
    [InlineData("cells", 11, false)]
    [InlineData("sequences/0/steps", 8, true)]
    [InlineData("sequences/0/steps", 9, false)]
    [InlineData("sequences", 4, true)]
    [InlineData("sequences", 5, false)]
    public void ListsHoldAtMostTheirLimit(string path, int count, bool accepted)
    {
        var walk = Walk();
        var list = At(walk, path).AsArray();
        var first = list[0]!;
        list.Clear();
        for (var i = 0; i < count; i++)
        {
            list.Add(first.DeepClone());
        }

        Assert.Equal(accepted, Repository.Schema.Validate(Placed(walk)) is null);
    }

    // The validator cannot read a lone surrogate as a string, so the pattern is checked on its own;
    // theory data would replace the surrogate before the test saw it.
    [Fact]
    public void CellTextRefusesALoneSurrogate()
    {
        var text = Pattern(Definitions()["literal"]!["oneOf"]![1]!);

        Assert.DoesNotMatch(text, "a\ud800");
        Assert.DoesNotMatch(text, "\udc00a");
        Assert.DoesNotMatch(text, "\ud800\ud800");
        Assert.DoesNotMatch(text, "\udc00\ud800");
        Assert.Matches(text, "a" + char.ConvertFromUtf32(0x1F600));
    }

    [Fact]
    public void ACellIsALiteralOrNull()
    {
        var cell = Definitions()["cell"]!;

        Assert.True(JsonNode.DeepEquals(cell, JsonNode.Parse("""{ "oneOf": [{ "$ref": "#/definitions/literal" }, { "type": "null" }] }""")));
    }

    [Theory]
    [InlineData("sec/b1")]
    [InlineData("sec/b12.i3")]
    [InlineData("sec/b1.1.s0")]
    [InlineData("sec/b12.10.s0")]
    [InlineData("sec/b1.1.s1")]
    [InlineData("sec/b3.4.s8")]
    [InlineData("sec/b1.1.s9")]
    [InlineData("sec/b1.0.s1")]
    [InlineData("sec/b1.01.s1")]
    [InlineData("sec/b1.1.s01")]
    [InlineData("sec/b1.1")]
    [InlineData("sec/b1.i1.s1")]
    [InlineData("sec/b0.1.s1")]
    [InlineData("sec/b1.1.s1\n")]
    public void BlockTargetAdmitsExactlyTheFourHookForms(string id)
    {
        var definitions = Definitions();
        var target = Pattern(definitions["blockTarget"]!["properties"]!["blockId"]!);
        var forms = HookForms.Select(name => Pattern(definitions[name]!)).ToArray();

        Assert.Equal(forms.Count(form => form.IsMatch(id)) == 1, target.IsMatch(id));
        Assert.True(forms.Count(form => form.IsMatch(id)) <= 1);
    }

    [Theory]
    [InlineData("sec/b2.1.s0", true, false)]
    [InlineData("sec/b2.1.s1", false, true)]
    [InlineData("sec/b2.2.s8", false, true)]
    [InlineData("sec/b2.1.s9", false, false)]
    [InlineData("sec/b2.1", false, false)]
    public void WalkHooksEndWithTheirStepNumber(string id, bool intro, bool step)
    {
        var definitions = Definitions();

        Assert.Equal(intro, Pattern(definitions["walkIntroId"]!).IsMatch(id));
        Assert.Equal(step, Pattern(definitions["walkStepId"]!).IsMatch(id));
    }

    private static JsonObject Walk() => JsonNode.Parse(WalkJson)!.AsObject();

    private static JsonNode Record(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(Repository.Root, "web", "compiled", file)))!;

    private static string Placed(JsonObject walk)
    {
        var record = Record(Syntax);
        At(record, "sections/0/body").AsArray().Add(walk);
        return record.ToJsonString();
    }

    private static string Placed(string path, JsonNode? value)
    {
        var walk = Walk();
        var slash = path.LastIndexOf('/');
        var parent = slash < 0 ? walk : At(walk, path[..slash]);
        var last = path[(slash + 1)..];
        if (parent is JsonArray array)
        {
            array[int.Parse(last, CultureInfo.InvariantCulture)] = value;
        }
        else
        {
            parent.AsObject()[last] = value;
        }

        return Placed(walk);
    }

    private static JsonNode At(JsonNode root, string path)
    {
        var node = root;
        foreach (var step in path.Split('/'))
        {
            node = node is JsonArray array ? array[int.Parse(step, CultureInfo.InvariantCulture)]! : node[step]!;
        }

        return node;
    }

    private static JsonObject Definitions() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(Repository.SchemaFolder, TypeEmitter.BodyFile)))!["definitions"]!.AsObject();

    private static Regex Pattern(JsonNode form) =>
        new(form["pattern"]!.GetValue<string>(), RegexOptions.None, TimeSpan.FromSeconds(1));
}
