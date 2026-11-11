using System.Text;
using Xunit;

namespace SharpLadder.Content.Tests;

public sealed class EmitterTests
{
    private const string Draft = "\"$schema\":\"http://json-schema.org/draft-07/schema#\",";
    private const string BodyId = "\"$id\":\"https://sharpladder.com/schema/body.schema.json\",";
    private const string ContentId = "\"$id\":\"https://sharpladder.com/schema/content.schema.json\",";
    private const string IdDefinition = """
        "id":{"type":"string"}
        """;

    private const string AFile = """
        "aFile":{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"const":"a"}}}
        """;

    private const string BFile = """
        "bFile":{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"const":"b"}}}
        """;

    private const string Root = """
        "oneOf":[{"$ref":"#/definitions/aFile"},{"$ref":"#/definitions/bFile"}],
        """;

    private const string Optional4 = """
        "type":"object","additionalProperties":false,"properties":{"a":{"type":"string"},"b":{"type":"string"},"c":{"type":"string"},"d":{"type":"string"}}
        """;

    private const string Members = """
        "m1":{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"const":"one"}}},"m2":{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"const":"two"}}}
        """;

    private static readonly string[] ModuleNames = ["body.ts", "content.ts"];

    private static string Emitter => Path.Combine(Repository.Root, "tools", "SharpLadder.Content.Tests", "fixtures", "emitter");

    [Fact]
    public void RealSchemasEmitTheCommittedModules()
    {
        var modules = Accepted(Real(TypeEmitter.BodyFile), Real(TypeEmitter.ContentFile));

        Assert.Equal(ModuleNames, modules.Keys.ToArray());
        Assert.Equal(File.ReadAllText(Path.Combine(Emitter, "body.ts.expected")), modules["body.ts"]);
        Assert.Equal(File.ReadAllText(Path.Combine(Emitter, "content.ts.expected")), modules["content.ts"]);
    }

    [Fact]
    public void UnchangedBaselineSchemasAreAccepted()
    {
        var modules = Accepted(File.ReadAllText(Path.Combine(Emitter, "h", TypeEmitter.BodyFile)), File.ReadAllText(Path.Combine(Emitter, "h", TypeEmitter.ContentFile)));

        Assert.DoesNotContain("LinkSpan", modules["body.ts"], StringComparison.Ordinal);
        Assert.Contains("export type ContentDoc = ChapterFile | PartFile;", modules["content.ts"], StringComparison.Ordinal);
    }

    [Fact]
    public void EmitterAndSchemaSetReadOneInputTree()
    {
        using var root = Folder.OpenRoot(Repository.SchemaFolder, Repository.SchemaFolder);
        var tree = InputTree.Read(root);

        var (set, problems) = SchemaSet.Load(tree);
        var (modules, emitProblems) = TypeEmitter.Emit(tree);

        Assert.NotNull(set);
        Assert.Empty(problems);
        Assert.Empty(emitProblems);
        Assert.Equal(Accepted(Real(TypeEmitter.BodyFile), Real(TypeEmitter.ContentFile)), modules);
    }

    [Fact]
    public void OutputIsDeterministic()
    {
        var first = Accepted(Real(TypeEmitter.BodyFile), Real(TypeEmitter.ContentFile));
        var second = Accepted(Real(TypeEmitter.BodyFile), Real(TypeEmitter.ContentFile));

        Assert.Equal(first, second);
    }

    [Fact]
    public void ModulesHaveTheHeaderTheRootAndNoEmptyObjectType()
    {
        var modules = Accepted(Real(TypeEmitter.BodyFile), Real(TypeEmitter.ContentFile));

        foreach (var text in modules.Values)
        {
            Assert.StartsWith("// SharpLadder.Content type emitter output, grammar 1. Do not edit.\n", text, StringComparison.Ordinal);
            AssertNoEmptyObject(text);
            Assert.DoesNotContain("\r", text, StringComparison.Ordinal);
            Assert.EndsWith(";\n", text, StringComparison.Ordinal);
        }

        Assert.Contains("import type { Body, Id, SectionId, Spans, Speech } from \"./body.ts\";\n", modules["content.ts"], StringComparison.Ordinal);
        Assert.DoesNotContain("import", modules["body.ts"], StringComparison.Ordinal);
        Assert.Equal(1, Occurrences(modules["content.ts"], "export type ContentDoc ="));
    }

    [Fact]
    public void RecursionThroughAnObjectPropertyIsKept()
    {
        var body = Accepted(Real(TypeEmitter.BodyFile), Real(TypeEmitter.ContentFile))["body.ts"];

        Assert.Contains("export type Spans = [Span, ...Span[]];", body, StringComparison.Ordinal);
        Assert.Contains("export type EmSpan = {\n  type: \"em\";\n  content: Spans;\n};", body, StringComparison.Ordinal);
        Assert.Contains("export type LinkContent = [LinkContentSpan, ...LinkContentSpan[]];", body, StringComparison.Ordinal);
        Assert.Contains("export type LinkEmSpan = {\n  type: \"em\";\n  content: LinkContent;\n};", body, StringComparison.Ordinal);
    }

    [Fact]
    public void AtMostOneEmitsOneVariantPerName()
    {
        var body = Accepted(Real(TypeEmitter.BodyFile), Real(TypeEmitter.ContentFile))["body.ts"];

        Assert.Contains("export type CodeBlock =\n  | {\n      type: \"code\";", body, StringComparison.Ordinal);
        Assert.Contains("      check?: string;\n      throws?: never;\n      fail?: never;", body, StringComparison.Ordinal);
        Assert.Contains("      check?: never;\n      throws?: never;\n      fail?: string;", body, StringComparison.Ordinal);
        Assert.Contains("      check?: never;\n      throws?: string;\n      fail?: never;", body, StringComparison.Ordinal);
    }

    // Each expected layout is the pinned formatter's own output for that type.
    [Theory]
    [InlineData("""{"type":"array","items":ITEM}""", "export type X = (\n  | {\n      a?: string;\n      b?: never;\n    }\n  | {\n      a?: never;\n      b?: string;\n    }\n)[];")]
    [InlineData("""{"type":"array","items":{"type":"array","items":ITEM}}""", "export type X = (\n  | {\n      a?: string;\n      b?: never;\n    }\n  | {\n      a?: never;\n      b?: string;\n    }\n)[][];")]
    [InlineData("""{"type":"array","minItems":1,"items":ITEM}""", "export type X = [\n  (\n    | {\n        a?: string;\n        b?: never;\n      }\n    | {\n        a?: never;\n        b?: string;\n      }\n  ),\n  ...(\n    | {\n        a?: string;\n        b?: never;\n      }\n    | {\n        a?: never;\n        b?: string;\n      }\n  )[],\n];")]
    [InlineData("""{"type":"array","minItems":1,"items":{"type":"array","items":ITEM}}""", "export type X = [\n  (\n    | {\n        a?: string;\n        b?: never;\n      }\n    | {\n        a?: never;\n        b?: string;\n      }\n  )[],\n  ...(\n    | {\n        a?: string;\n        b?: never;\n      }\n    | {\n        a?: never;\n        b?: string;\n      }\n  )[][],\n];")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{"x":{"type":"array","items":ITEM}}}""", "export type X = {\n  x?: (\n    | {\n        a?: string;\n        b?: never;\n      }\n    | {\n        a?: never;\n        b?: string;\n      }\n  )[];\n};")]
    [InlineData("""{"type":"array","items":{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/m2"}]}}""", "export type X = (M1 | M2)[];")]
    [InlineData("""{"type":"array","minItems":1,"items":{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/m2"}]}}""", "export type X = [M1 | M2, ...(M1 | M2)[]];")]
    public void ArraysOfObjectUnionsEmitTheirElementType(string node, string expected)
    {
        const string item = """{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"},"b":{"type":"string"}},"not":{"anyOf":[{"required":["a","b"]}]}}""";
        var body = Accepted(BodyDocument(IdDefinition + "," + Members + ",\"x\":" + node.Replace("ITEM", item, StringComparison.Ordinal)), ContentDocument())["body.ts"];

        Assert.Contains("\n" + expected + "\n", body, StringComparison.Ordinal);
        Assert.DoesNotContain("= [];", body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"enum":["ok"]}""", "export type X = \"ok\";")]
    [InlineData("""{"enum":["ok","no"]}""", "export type X = \"ok\" | \"no\";")]
    [InlineData("""{"type":"array","items":{"enum":["ok"]}}""", "export type X = \"ok\"[];")]
    [InlineData("""{"type":"array","minItems":1,"items":{"enum":["ok"]}}""", "export type X = [\"ok\", ...\"ok\"[]];")]
    [InlineData("""{"type":"array","items":{"enum":["ok","no"]}}""", "export type X = (\"ok\" | \"no\")[];")]
    public void EnumsOfOneOrMoreValuesAreEmitted(string node, string expected)
    {
        var body = Accepted(BodyDocument(IdDefinition + ",\"x\":" + node), ContentDocument())["body.ts"];

        Assert.Contains("\n" + expected + "\n", body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""[{"required":["a","b"]}]""", 2)]
    [InlineData("""[{"required":["b","a"]},{"required":["c","a"]},{"required":["c","b"]}]""", 3)]
    public void AtMostOneSetsAreAccepted(string anyOf, int variants)
    {
        var body = Accepted(BodyDocument(IdDefinition + ",\"x\":{" + Optional4 + ",\"not\":{\"anyOf\":" + anyOf + "}}"), ContentDocument())["body.ts"];

        Assert.Equal(variants, Occurrences(body, "\n  | {"));
        Assert.Contains("      a?: string;\n      b?: never;", body, StringComparison.Ordinal);
    }

    [Fact]
    public void AtMostOneOfEightNamesIsAccepted()
    {
        var body = Accepted(BodyDocument(IdDefinition + ",\"x\":" + ExclusiveObject(8, Pairs(8))), ContentDocument())["body.ts"];

        Assert.Equal(8, Occurrences(body, "\n  | {"));
        Assert.Equal(56, Occurrences(body, "?: never;"));
    }

    [Theory]
    [InlineData("""[{"required":["a","b"]},{"required":["b","a"]}]""", "listed twice")]
    [InlineData("""[{"required":["a","b"]},{"required":["a","c"]},{"required":["b","c"]},{"required":["a","a"]}]""", "repeats the name \"a\"")]
    [InlineData("""[{"required":["a","b"]},{"required":["a","c"]}]""", "needs all 3 pairs")]
    [InlineData("""[{"required":["a","b"]},{"required":["a","c"]},{"required":["b","c"]},{"required":["a","b"]}]""", "listed twice")]
    [InlineData("""[{"required":["a","a"]}]""", "holds 2 to 8 names, not 1")]
    [InlineData("""[]""", "not must be exactly")]
    [InlineData("""[{"required":["a","b","c"]}]""", "exactly { \"required\": [a, b] }")]
    [InlineData("""[{"required":["a"]}]""", "exactly { \"required\": [a, b] }")]
    [InlineData("""[{"required":["a","b"],"minProperties":1}]""", "exactly { \"required\": [a, b] }")]
    [InlineData("""[{"required":["a",1]}]""", "exactly { \"required\": [a, b] }")]
    [InlineData("""[{"required":["a","e"]}]""", "\"e\" is not an optional property")]
    public void AtMostOnePairSetsAreRefused(string anyOf, string problem) =>
        Refused(BodyDocument(IdDefinition + ",\"x\":{" + Optional4 + ",\"not\":{\"anyOf\":" + anyOf + "}}"), ContentDocument(), problem);

    [Fact]
    public void AtMostOneOfNineNamesIsRefused() =>
        Refused(BodyDocument(IdDefinition + ",\"x\":" + ExclusiveObject(9, Pairs(9))), ContentDocument(), "holds 2 to 8 names, not 9");

    [Fact]
    public void AtMostOneOverARequiredPropertyIsRefused() =>
        Refused(
            BodyDocument(IdDefinition + ",\"x\":{" + Optional4 + ",\"required\":[\"a\"],\"not\":{\"anyOf\":[{\"required\":[\"a\",\"b\"]}]}}"),
            ContentDocument(),
            "\"a\" is not an optional property");

    [Theory]
    [InlineData("""{"anyOf":[{"required":["a","b"]}],"title":"t"}""")]
    [InlineData("""{"required":["a","b"]}""")]
    [InlineData("""{"type":"string"}""")]
    public void OtherNotFormsAreRefused(string not) =>
        Refused(BodyDocument(IdDefinition + ",\"x\":{" + Optional4 + ",\"not\":" + not + "}"), ContentDocument(), "not must be exactly");

    [Theory]
    [InlineData("""{"$defs":{"a":{"type":"string"}},"type":"string"}""", "unsupported keyword \"$defs\"")]
    [InlineData("""{"if":{"type":"string"},"then":{"type":"string"}}""", "matches no supported form")]
    [InlineData("""{"if":{"type":"string"},"then":{"type":"string"},"else":{"type":"integer"}}""", "matches no supported form")]
    [InlineData("""{"type":"string","if":{"const":"a"},"then":{"const":"a"},"else":{"const":"b"}}""", "unsupported keyword \"if\"")]
    [InlineData("""{"type":"array"}""", "missing \"items\"")]
    [InlineData("""{"type":"object","additionalProperties":"false","properties":{"a":{"type":"string"}}}""", "additionalProperties must be false")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}},"patternProperties":{"^b":{"type":"string"}}}""", "unsupported keyword \"patternProperties\"")]
    [InlineData("""{"type":"string","format":"uri"}""", "unsupported keyword \"format\"")]
    [InlineData("""{"type":["string","integer"]}""", "type must be a single string")]
    [InlineData("""{"type":"object","additionalProperties":true,"properties":{"a":{"type":"string"}}}""", "additionalProperties must be false")]
    [InlineData("""{"type":"object","additionalProperties":{"type":"string"},"properties":{"a":{"type":"string"}}}""", "additionalProperties must be false")]
    [InlineData("""{"type":"object","properties":{"a":{"type":"string"}}}""", "missing \"additionalProperties\"")]
    [InlineData("""{"type":"object","additionalProperties":false}""", "missing \"properties\"")]
    [InlineData("""{"$ref":"#/definitions/id","title":"x"}""", "unsupported keyword \"title\"")]
    [InlineData("""{"$ref":"#/definitions/id","pattern":"^a"}""", "unsupported keyword \"pattern\"")]
    [InlineData("""{"type":"string","title":"x"}""", "unsupported keyword \"title\"")]
    [InlineData("""{"type":"string","description":"x"}""", "unsupported keyword \"description\"")]
    [InlineData("""{"type":"string","default":"a"}""", "unsupported keyword \"default\"")]
    [InlineData("""{"type":"number"}""", "type \"number\" is not supported")]
    [InlineData("""{"type":"null"}""", "type \"null\" is not supported")]
    [InlineData("""{}""", "matches no supported form")]
    [InlineData("""true""", "a schema node must be a JSON object")]
    [InlineData("""{"not":{"type":"string"}}""", "matches no supported form")]
    [InlineData("""{"anyOf":[{"type":"string"},{"type":"integer"}]}""", "matches no supported form")]
    [InlineData("""{"type":"array","items":[{"type":"string"}]}""", "tuples are not supported")]
    [InlineData("""{"type":"array","items":{"type":"string"},"additionalItems":false}""", "unsupported keyword \"additionalItems\"")]
    [InlineData("""{"type":"array","items":{"type":"string"},"maxItems":3}""", "unsupported keyword \"maxItems\"")]
    [InlineData("""{"type":"boolean","const":true}""", "unsupported keyword \"type\"")]
    [InlineData("""{"type":"integer","maximum":3}""", "unsupported keyword \"maximum\"")]
    public void UnsupportedConstructsAreRefused(string node, string problem) => RefusedNode(node, problem);

    [Theory]
    [InlineData("""{"$ref":"#/definitions/missing"}""", "names no definition")]
    [InlineData("""{"$ref":"https://example.com/x.schema.json#/definitions/id"}""", "$ref must be")]
    [InlineData("""{"$ref":"https://sharpladder.com/schema/body.schema.json#/definitions/id"}""", "$ref must be")]
    [InlineData("""{"$ref":"other.schema.json#/definitions/id"}""", "$ref must be")]
    [InlineData("""{"$ref":"#/properties/id"}""", "$ref must be")]
    [InlineData("""{"$ref":"#"}""", "$ref must be")]
    [InlineData("""{"$ref":"#/definitions/id/pattern"}""", "$ref must be")]
    [InlineData("""{"$ref":"#/definitions/id\n"}""", "names no definition")]
    [InlineData("""{"$ref":1}""", "$ref must be")]
    public void UnsupportedReferencesAreRefused(string node, string problem) => RefusedNode(node, problem);

    [Theory]
    [InlineData("""{"const":1.5}""")]
    [InlineData("""{"const":1e2}""")]
    [InlineData("""{"const":1.0}""")]
    [InlineData("""{"const":-0}""")]
    [InlineData("""{"const":9007199254740992}""")]
    [InlineData("""{"const":-9007199254740992}""")]
    [InlineData("""{"const":true}""")]
    [InlineData("""{"type":"integer","minimum":1.5}""")]
    [InlineData("""{"type":"integer","minimum":1e2}""")]
    [InlineData("""{"type":"integer","minimum":-0}""")]
    [InlineData("""{"type":"integer","minimum":"1"}""")]
    [InlineData("""{"type":"integer","minimum":9007199254740992}""")]
    [InlineData("""{"type":"string","maxLength":1.0}""")]
    [InlineData("""{"type":"string","maxLength":"48"}""")]
    [InlineData("""{"type":"string","minLength":-9007199254740992}""")]
    [InlineData("""{"type":"string","minLength":1E2}""")]
    public void NumbersOutsideTheSafeIntegerTokenAreRefused(string node) => RefusedNode(node, "must be an integer token");

    [Theory]
    [InlineData("""{"type":"string","minLength":-1}""", "minLength must not be negative")]
    [InlineData("""{"type":"string","pattern":1}""", "pattern must be a string")]
    [InlineData("""{"type":"array","items":{"type":"string"},"minItems":0}""", "minItems must be absent or exactly 1")]
    [InlineData("""{"type":"array","items":{"type":"string"},"minItems":2}""", "minItems must be absent or exactly 1")]
    [InlineData("""{"type":"array","items":{"type":"string"},"minItems":1.0}""", "minItems must be absent or exactly 1")]
    [InlineData("""{"type":"array","items":{"type":"string"},"minItems":"1"}""", "minItems must be absent or exactly 1")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{}}""", "properties must hold at least one property")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}},"required":[]}""", "required must be a non-empty array")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}},"required":["b"]}""", "\"b\" is not a declared property")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}},"required":["a","a"]}""", "listed twice")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}},"required":"a"}""", "required must be a non-empty array")]
    [InlineData("""{"type":"object","additionalProperties":false,"properties":{"a":{"type":"string"}},"required":["a\n"]}""", "property name \"a\\n\"")]
    public void ValueRulesAreEnforced(string node, string problem) => RefusedNode(node, problem);

    [Theory]
    [InlineData("""{"const":"Upper"}""")]
    [InlineData("""{"const":"a\"b"}""")]
    [InlineData("""{"const":"a\\b"}""")]
    [InlineData("""{"const":"name\n"}""")]
    [InlineData("""{"const":""}""")]
    [InlineData("""{"const":"1a"}""")]
    [InlineData("""{"const":"a b"}""")]
    [InlineData("""{"enum":["ok","Bad"]}""")]
    [InlineData("""{"enum":["ok","a\"b"]}""")]
    [InlineData("""{"enum":["ok","a\\b"]}""")]
    [InlineData("""{"enum":["ok\n"]}""")]
    [InlineData("""{"enum":[1]}""")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"not":{"const":"Intro"}}]}""")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"not":{"const":"intro\n"}}]}""")]
    public void LiteralStringsOutsideTheGrammarAreRefused(string node) => RefusedNode(node, "a literal string is");

    [Theory]
    [InlineData("""{"enum":[]}""", "enum must be a non-empty array")]
    [InlineData("""{"enum":"a"}""", "enum must be a non-empty array")]
    [InlineData("""{"enum":["a","a"]}""", "enum repeats \"a\"")]
    [InlineData("""{"enum":["a"],"type":"string"}""", "unsupported keyword \"type\"")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"}]}""", "allOf must be exactly [$ref, refinement]")]
    [InlineData("""{"allOf":[{"pattern":"^a"},{"$ref":"#/definitions/id"}]}""", "allOf must be exactly [$ref, refinement]")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"pattern":"^a"},{"pattern":"^b"}]}""", "allOf must be exactly [$ref, refinement]")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"pattern":"^a","minLength":1}]}""", "a refinement is exactly")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"not":{"enum":["a"]}}]}""", "a refinement is exactly")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"not":{"const":"a","type":"string"}}]}""", "a refinement is exactly")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"pattern":1}]}""", "a refinement is exactly")]
    [InlineData("""{"allOf":[{"$ref":"#/definitions/id"},{"type":"string"}]}""", "a refinement is exactly")]
    public void EnumAndRefinementShapesAreEnforced(string node, string problem) => RefusedNode(node, problem);

    [Theory]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"}]}""", "two or more members")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"const":"x"}}}]}""", "must be a $ref to an Object")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/id"}]}""", "union member id is not an Object")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/m1"}]}""", "discriminator \"one\" is repeated")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/same"}]}""", "discriminator \"one\" is repeated")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/untagged"}]}""", "needs a required string const property named type")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/keyed"}]}""", "needs a required string const property named type")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/loose"}]}""", "needs a required string const property named type")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/optional"}]}""", "needs a required string const property named type")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/numbered"}]}""", "needs a required string const property named type")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/alias"}]}""", "union member alias is not an Object")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/m2","title":"t"}]}""", "unsupported keyword \"title\"")]
    [InlineData("""{"oneOf":[{"$ref":"#/definitions/m1"},{"$ref":"#/definitions/m2"}],"type":"object"}""", "unsupported keyword \"type\"")]
    public void AmbiguousUnionsAreRefused(string node, string problem)
    {
        const string Extra = """
            "same":{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"const":"one"}}},
            "untagged":{"type":"object","additionalProperties":false,"properties":{"name":{"type":"string"}}},
            "keyed":{"type":"object","additionalProperties":false,"required":["kind"],"properties":{"kind":{"const":"two"}}},
            "loose":{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"type":"string"}}},
            "optional":{"type":"object","additionalProperties":false,"properties":{"type":{"const":"two"}}},
            "numbered":{"type":"object","additionalProperties":false,"required":["type"],"properties":{"type":{"const":2}}},
            "alias":{"$ref":"#/definitions/m2"}
            """;
        Refused(BodyDocument(IdDefinition + "," + Members + "," + Extra + ",\"x\":" + node), ContentDocument(), problem);
    }

    [Fact]
    public void AUnionOfTaggedObjectsIsAccepted()
    {
        var body = Accepted(BodyDocument(IdDefinition + "," + Members + ",\"x\":{\"oneOf\":[{\"$ref\":\"#/definitions/m1\"},{\"$ref\":\"#/definitions/m2\"}]}"), ContentDocument())["body.ts"];

        Assert.Contains("export type X = M1 | M2;\n", body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("__proto__")]
    [InlineData("constructor-x")]
    [InlineData("a b")]
    [InlineData("\\\"")]
    [InlineData("Type")]
    [InlineData("a234567890123456789012345678901234567890123456789")]
    [InlineData("caf\u00e9")]
    [InlineData("caf\\u00e9")]
    [InlineData("a\\u0020b")]
    [InlineData("a\\u0022")]
    [InlineData("name\\n")]
    [InlineData("")]
    [InlineData("a$b")]
    [InlineData("1a")]
    public void HostileNamesAreRefused(string name)
    {
        Refused(BodyDocument(IdDefinition + ",\"" + name + "\":{\"type\":\"string\"}"), ContentDocument(), "definition name");
        RefusedNode("{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"" + name + "\":{\"type\":\"string\"}}}", "property name");
    }

    [Fact]
    public void NamesAreReadAfterEscapesAreDecoded()
    {
        const string Name48 = "a2345678901234567890123456789012345678901234567b";
        var body = Accepted(BodyDocument(IdDefinition + ",\"\\u0078y\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"" + Name48 + "\":{\"const\":\"\\u0061-1\"}}}"), ContentDocument())["body.ts"];

        Assert.Contains("export type Xy = {\n  " + Name48 + "?: \"a-1\";\n};\n", body, StringComparison.Ordinal);
    }

    [Fact]
    public void SafeIntegerBoundsAreAccepted()
    {
        var body = Accepted(BodyDocument(IdDefinition + ",\"x\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"hi\":{\"const\":9007199254740991},\"lo\":{\"const\":-9007199254740991},\"n\":{\"type\":\"integer\",\"minimum\":-9007199254740991}}}"), ContentDocument())["body.ts"];

        Assert.Contains("  hi?: 9007199254740991;\n  lo?: -9007199254740991;\n  n?: number;\n", body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("array")]
    [InlineData("boolean")]
    [InlineData("date")]
    [InlineData("error")]
    [InlineData("function")]
    [InlineData("map")]
    [InlineData("number")]
    [InlineData("object")]
    [InlineData("promise")]
    [InlineData("record")]
    [InlineData("regExp")]
    [InlineData("set")]
    [InlineData("string")]
    [InlineData("symbol")]
    [InlineData("partial")]
    [InlineData("required")]
    [InlineData("readonly")]
    [InlineData("pick")]
    [InlineData("omit")]
    [InlineData("exclude")]
    [InlineData("extract")]
    [InlineData("nonNullable")]
    [InlineData("returnType")]
    [InlineData("jSX")]
    [InlineData("react")]
    [InlineData("contentDoc")]
    public void ReservedAliasesAreRefused(string name) =>
        Refused(BodyDocument(IdDefinition + ",\"" + name + "\":{\"type\":\"string\"}"), ContentDocument(), "is reserved");

    [Fact]
    public void AnAliasCollisionAcrossFilesIsRefused() =>
        Refused(BodyDocument(IdDefinition + "," + AFile), ContentDocument(), "alias AFile is also produced by body.schema.json");

    [Theory]
    [InlineData("""
        "a":{"$ref":"#/definitions/b"},"b":{"$ref":"#/definitions/a"}
        """)]
    [InlineData("""
        "a":{"$ref":"#/definitions/a"}
        """)]
    [InlineData("""
        "a":{"type":"array","items":{"$ref":"#/definitions/a"}}
        """)]
    [InlineData("""
        "a":{"allOf":[{"$ref":"#/definitions/b"},{"pattern":"^a"}]},"b":{"type":"array","items":{"$ref":"#/definitions/a"}}
        """)]
    public void CyclesWithoutAnObjectPropertyAreRefused(string definitions) =>
        Refused(BodyDocument(IdDefinition + "," + definitions), ContentDocument(), "reference cycle without an Object property");

    [Fact]
    public void ACycleThroughAnObjectPropertyIsAccepted()
    {
        var body = Accepted(BodyDocument(IdDefinition + ",\"tree\":{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"kids\":{\"type\":\"array\",\"items\":{\"$ref\":\"#/definitions/tree\"}}}}"), ContentDocument())["body.ts"];

        Assert.Contains("export type Tree = {\n  kids?: Tree[];\n};\n", body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("\"type\":\"object\",", "definitions only, not \"type\"")]
    [InlineData(Root, "definitions only, not \"oneOf\"")]
    [InlineData("\"$ref\":\"#/definitions/id\",", "definitions only, not \"$ref\"")]
    [InlineData("\"$defs\":{},", "definitions only, not \"$defs\"")]
    [InlineData("\"title\":1,", "title must be a string")]
    public void ABodyDocumentHoldsDefinitionsOnly(string extra, string problem) =>
        Refused(BodyDocument(IdDefinition, extra), ContentDocument(), problem);

    [Theory]
    [InlineData("", "needs its root Union")]
    [InlineData("\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"a\":{\"type\":\"string\"}},", "needs its root Union")]
    [InlineData("\"allOf\":[{\"$ref\":\"#/definitions/aFile\"},{\"pattern\":\"^a\"}],", "needs its root Union")]
    [InlineData(Root + "\"type\":\"object\",", "a Union alone, not with \"type\"")]
    [InlineData("\"oneOf\":[{\"$ref\":\"#/definitions/aFile\"}],", "two or more members")]
    [InlineData("\"oneOf\":[{\"$ref\":\"#/definitions/aFile\"},{\"$ref\":\"#/definitions/aFile\"}],", "discriminator \"a\" is repeated")]
    [InlineData(Root + "\"title\":[],", "title must be a string")]
    public void TheContentDocumentNeedsItsRootUnion(string root, string problem) =>
        Refused(BodyDocument(IdDefinition), ContentDocument(root: root), problem);

    [Theory]
    [InlineData("\"$schema\":\"http://json-schema.org/draft-07/schema#\",", "", "missing \"$schema\"")]
    [InlineData("\"$id\":\"https://sharpladder.com/schema/body.schema.json\",", "", "missing \"$id\"")]
    [InlineData("\"definitions\":{\"id\":{\"type\":\"string\"}}", "\"title\":\"t\"", "missing \"definitions\"")]
    [InlineData("draft-07", "draft-04", "$schema must be")]
    [InlineData("\"$schema\":\"http://json-schema.org/draft-07/schema#\"", "\"$schema\":1", "$schema must be")]
    [InlineData("body.schema.json\"", "other.schema.json\"", "$id must be")]
    [InlineData("\"definitions\":{\"id\":{\"type\":\"string\"}}", "\"definitions\":{}", "one or more definitions")]
    [InlineData("\"definitions\":{\"id\":{\"type\":\"string\"}}", "\"definitions\":[]", "one or more definitions")]
    public void DocumentKeysAreChecked(string from, string to, string problem)
    {
        var body = BodyDocument(IdDefinition);
        Assert.Contains(from, body, StringComparison.Ordinal);
        Refused(body.Replace(from, to, StringComparison.Ordinal), ContentDocument(), problem);
    }

    [Theory]
    [InlineData("""{"type":1,"\u0074ype":2}""")]
    [InlineData("""{"a":{"b":{"c":{"d":1,"d":2}}}}""")]
    public void DuplicateNamesAreRefusedBeforeAnythingElse(string twin)
    {
        Refused(BodyDocument(IdDefinition + ",\"x\":" + twin), ContentDocument(), "not UTF-8 JSON without duplicate names");
        Refused(BodyDocument(IdDefinition, "\"title\":\"t\",\"title\":\"u\","), ContentDocument(), "not UTF-8 JSON without duplicate names");
    }

    [Fact]
    public void ByteLevelRefusals()
    {
        var bom = TypeEmitter.Emit([new InputEntry(TypeEmitter.BodyFile, TypeEmitter.BodyFile, TypeEmitter.BodyFile, [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(BodyDocument(IdDefinition))]), Entry(TypeEmitter.ContentFile, ContentDocument())]);
        var notUtf8 = TypeEmitter.Emit([new InputEntry(TypeEmitter.BodyFile, TypeEmitter.BodyFile, TypeEmitter.BodyFile, [0x7B, 0xFF, 0x7D]), Entry(TypeEmitter.ContentFile, ContentDocument())]);

        Assert.Null(bom.Modules);
        Assert.Contains("byte order mark", Assert.Single(bom.Problems), StringComparison.Ordinal);
        Assert.Null(notUtf8.Modules);
        Assert.Contains("not UTF-8 JSON", Assert.Single(notUtf8.Problems), StringComparison.Ordinal);
        Refused("[]", ContentDocument(), "the document must be a JSON object");
    }

    [Theory]
    [InlineData("\r\n")]
    [InlineData("\r")]
    public void CarriageReturnInASchemaFileIsRefused(string ending)
    {
        var body = Entry(TypeEmitter.BodyFile, Real(TypeEmitter.BodyFile).Replace("\n", ending, StringComparison.Ordinal));

        AssertProblem(TypeEmitter.Emit([body, Entry(TypeEmitter.ContentFile, Real(TypeEmitter.ContentFile))]), "body.schema.json: holds a carriage return (CR)");
    }

    [Fact]
    public void OnlyTheTwoSchemaFilesAreRead()
    {
        var body = Entry(TypeEmitter.BodyFile, BodyDocument(IdDefinition));
        var content = Entry(TypeEmitter.ContentFile, ContentDocument());

        AssertProblem(TypeEmitter.Emit([body, content, Entry("extra.schema.json", "{}")]), "extra.schema.json: the schema folder holds only");
        AssertProblem(TypeEmitter.Emit([body, content, new InputEntry("nested", "nested", "nested", null)]), "nested: the schema folder holds only");
        AssertProblem(TypeEmitter.Emit([content]), "body.schema.json: not found");
        AssertProblem(TypeEmitter.Emit([body]), "content.schema.json: not found");
        Assert.NotNull(TypeEmitter.Emit([body, content]).Modules);
    }

    // With the theory below, default-deny changes applied to the committed schemas themselves.
    [Fact]
    public void ByteOrderMarkOnTheCurrentSchemasIsRefused()
    {
        var body = new InputEntry(TypeEmitter.BodyFile, TypeEmitter.BodyFile, TypeEmitter.BodyFile, [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(Real(TypeEmitter.BodyFile))]);

        AssertProblem(TypeEmitter.Emit([body, Entry(TypeEmitter.ContentFile, Real(TypeEmitter.ContentFile))]), "body.schema.json: starts with a byte order mark");
    }

    [Theory]
    [InlineData("body.schema.json", "unsupported keyword \"if\"", "\"ordered\": { \"type\": \"boolean\" }", "\"ordered\": { \"type\": \"boolean\", \"if\": { \"const\": true }, \"then\": { \"const\": true } }")]
    [InlineData("body.schema.json", "unsupported keyword \"if\"", "\"ordered\": { \"type\": \"boolean\" }", "\"ordered\": { \"type\": \"boolean\", \"if\": { \"const\": true }, \"then\": { \"const\": true }, \"else\": { \"const\": false } }")]
    [InlineData("body.schema.json", "not \"$defs\"", "\"title\": \"Body blocks and inline spans\",", "\"title\": \"Body blocks and inline spans\",\n  \"$defs\": {},")]
    [InlineData("body.schema.json", "unsupported keyword \"patternProperties\"", "\"required\": [\"blockId\", \"content\"],", "\"required\": [\"blockId\", \"content\"],\n      \"patternProperties\": { \"^x\": { \"type\": \"string\" } },")]
    [InlineData("body.schema.json", "tuples are not supported", "\"items\": { \"$ref\": \"#/definitions/listItem\" }", "\"items\": [{ \"$ref\": \"#/definitions/listItem\" }]")]
    [InlineData("content.schema.json", "needs a required string const property named type", "\"type\": { \"const\": \"part\" },", "", "\"required\": [\"type\", \"kind\",", "\"required\": [\"kind\",")]
    [InlineData("content.schema.json", "discriminator \"chapter\" is repeated", "\"type\": { \"const\": \"part\" },", "\"type\": { \"const\": \"chapter\" },")]
    [InlineData("body.schema.json", "$schema must be", "draft-07", "draft-04")]
    [InlineData("body.schema.json", "$id must be", "/schema/body.schema.json", "/schema/other.schema.json")]
    [InlineData("body.schema.json", "\"extra\" is not a declared property", "\"required\": [\"blockId\", \"content\"],", "\"required\": [\"blockId\", \"content\", \"extra\"],")]
    [InlineData("body.schema.json", "$ref must be", "{ \"$ref\": \"#/definitions/listItem\" }", "{ \"$ref\": \"https://example.com/schema.json#/definitions/listItem\" }")]
    [InlineData("content.schema.json", "$ref must be", "\"body.schema.json#/definitions/body\"", "\"other.schema.json#/definitions/body\"")]
    [InlineData("body.schema.json", "names no definition", "\"#/definitions/listItem\"", "\"#/definitions/listEntry\"")]
    [InlineData("content.schema.json", "unsupported keyword \"format\"", "\"title\": { \"type\": \"string\", \"minLength\": 1 },", "\"title\": { \"type\": \"string\", \"minLength\": 1, \"format\": \"uri\" },")]
    [InlineData("content.schema.json", "additionalProperties must be false", "\"additionalProperties\": false,", "\"additionalProperties\": true,")]
    public void DefaultDenyChangesToTheCurrentSchemasAreRefused(string file, string problem, params string[] edits)
    {
        var texts = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [TypeEmitter.BodyFile] = Real(TypeEmitter.BodyFile),
            [TypeEmitter.ContentFile] = Real(TypeEmitter.ContentFile),
        };
        for (var i = 0; i < edits.Length; i += 2)
        {
            var at = texts[file].IndexOf(edits[i], StringComparison.Ordinal);
            Assert.True(at >= 0, edits[i]);
            texts[file] = string.Concat(texts[file].AsSpan(0, at), edits[i + 1], texts[file].AsSpan(at + edits[i].Length));
        }

        Refused(texts[TypeEmitter.BodyFile], texts[TypeEmitter.ContentFile], problem);
    }

    private static string Real(string file) => File.ReadAllText(Path.Combine(Repository.SchemaFolder, file));

    private static InputEntry Entry(string name, string text) => new(name, name, name, Encoding.UTF8.GetBytes(text));

    private static string BodyDocument(string definitions, string extra = "") =>
        "{" + Draft + BodyId + extra + "\"definitions\":{" + definitions + "}}";

    private static string ContentDocument(string root = Root) =>
        "{" + Draft + ContentId + root + "\"definitions\":{" + AFile + "," + BFile + "}}";

    private static string Pairs(int count)
    {
        var pairs = new List<string>();
        for (var i = 0; i < count; i++)
        {
            for (var j = i + 1; j < count; j++)
            {
                pairs.Add($"{{\"required\":[\"p{i}\",\"p{j}\"]}}");
            }
        }

        return "[" + string.Join(",", pairs) + "]";
    }

    private static string ExclusiveObject(int count, string anyOf) =>
        "{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{"
        + string.Join(",", Enumerable.Range(0, count).Select(i => $"\"p{i}\":{{\"type\":\"string\"}}"))
        + "},\"not\":{\"anyOf\":" + anyOf + "}}";

    private static IReadOnlyDictionary<string, string> Accepted(string body, string content)
    {
        var (modules, problems) = TypeEmitter.Emit([Entry(TypeEmitter.BodyFile, body), Entry(TypeEmitter.ContentFile, content)]);
        Assert.Empty(problems);
        return modules!;
    }

    private static void Refused(string body, string content, string problem) =>
        AssertProblem(TypeEmitter.Emit([Entry(TypeEmitter.BodyFile, body), Entry(TypeEmitter.ContentFile, content)]), problem);

    private static void RefusedNode(string node, string problem) =>
        Refused(BodyDocument(IdDefinition + ",\"x\":" + node), ContentDocument(), problem);

    private static void AssertProblem((IReadOnlyDictionary<string, string>? Modules, IReadOnlyList<string> Problems) result, string problem)
    {
        Assert.Null(result.Modules);
        Assert.Contains(problem, Assert.Single(result.Problems), StringComparison.Ordinal);
    }

    private static int Occurrences(string text, string part)
    {
        var count = 0;
        for (var at = text.IndexOf(part, StringComparison.Ordinal); at >= 0; at = text.IndexOf(part, at + part.Length, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
    }

    // The TypeScript empty-object type {} admits every non-null value, so it must never appear.
    private static void AssertNoEmptyObject(string text)
    {
        for (var at = text.IndexOf('{', StringComparison.Ordinal); at >= 0; at = text.IndexOf('{', at + 1))
        {
            var next = at + 1;
            while (next < text.Length && char.IsWhiteSpace(text[next]))
            {
                next++;
            }

            Assert.True(next == text.Length || text[next] != '}', $"empty object type at {at}");
        }
    }
}
