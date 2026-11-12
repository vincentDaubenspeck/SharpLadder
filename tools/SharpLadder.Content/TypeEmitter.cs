using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace SharpLadder.Content;

/// <summary>
/// Maps the closed set of schema forms the two content schemas use to TypeScript type aliases.
/// Every node must match one form exactly; anything else stops generation, so the types never
/// silently describe a construct they do not model.
/// </summary>
internal static partial class TypeEmitter
{
    // Raised whenever the accepted forms or the emitted shapes change.
    public const int GrammarVersion = 2;

    public const string BodyFile = "body.schema.json";
    public const string ContentFile = SchemaSet.RootFile;
    public const string RootAlias = "ContentDoc";

    private const string Draft07 = "http://json-schema.org/draft-07/schema#";
    private const long MaxSafe = 9007199254740991;

    // The pinned formatter's default line width; output must already be in its format.
    private const int Width = 80;

    // A bounded array is written as one tuple per length, each kept whole on a line; the format
    // check on the generated modules catches a tuple that a deeper position would still break.
    private const int MaxBound = 16;
    private const int TupleWidth = 60;

    private static readonly string Header = $"// SharpLadder.Content type emitter output, grammar {GrammarVersion.ToString(CultureInfo.InvariantCulture)}. Do not edit.";
    private static readonly string[] Files = [BodyFile, ContentFile];
    private static readonly string[] DocumentKeys = ["$schema", "$id", "title", "definitions"];
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // Global and library type names an alias could shadow in the generated modules.
    private static readonly HashSet<string> Reserved = new(StringComparer.Ordinal)
    {
        "Array", "Boolean", "Date", "Error", "Function", "Map", "Number", "Object", "Promise", "Record",
        "RegExp", "Set", "String", "Symbol", "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude",
        "Extract", "NonNullable", "ReturnType", "JSX", "React",
    };

    public static (IReadOnlyDictionary<string, string>? Modules, IReadOnlyList<string> Problems) Emit(InputTree tree) =>
        Emit(tree.Children(string.Empty));

    // The modules are keyed by output file name: body.ts and content.ts.
    public static (IReadOnlyDictionary<string, string>? Modules, IReadOnlyList<string> Problems) Emit(IReadOnlyList<InputEntry> entries)
    {
        try
        {
            return (new Run(Load([.. entries.Where(e => !SchemaSet.RegistryFiles.Contains(e.Name, StringComparer.Ordinal))])).Modules(), []);
        }
        catch (InvalidDataException e)
        {
            return (null, [e.Message]);
        }
    }

    public static string ModuleName(string schemaFile) => schemaFile[..^".schema.json".Length] + ".ts";

    [GeneratedRegex(@"^[a-z][A-Za-z0-9]{0,47}(?![\s\S])", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    internal static partial Regex NamePattern();

    // A JSON number token a JavaScript number holds exactly, written the same in both languages.
    internal static (long Value, string Token) SafeInteger(JsonNode? value, string at, string what)
    {
        if (value is JsonValue json && json.GetValueKind() == JsonValueKind.Number && json.TryGetValue<JsonElement>(out var element))
        {
            var token = element.GetRawText();
            if (IntegerToken().IsMatch(token) && !string.Equals(token, "-0", StringComparison.Ordinal)
                && long.TryParse(token, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var number)
                && number is >= -MaxSafe and <= MaxSafe)
            {
                return (number, token);
            }
        }

        throw Fail(at, $"{what} must be an integer token without fraction or exponent, not -0, within the safe integer range");
    }

    [GeneratedRegex(@"^[a-z][a-z0-9-]{0,47}(?![\s\S])", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex LiteralPattern();

    [GeneratedRegex(@"^-?(?:0|[1-9][0-9]*)(?![\s\S])", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex IntegerToken();

    [GeneratedRegex(@"^(?:(?<file>body|content)\.schema\.json)?#/definitions/(?<name>[^/]*)(?![\s\S])", RegexOptions.CultureInvariant | RegexOptions.ExplicitCapture, matchTimeoutMilliseconds: 1000)]
    private static partial Regex RefPattern();

    private static InvalidDataException Fail(string at, string message) => new($"{at}: {message}");

    private static string Alias(string name) => char.ToUpperInvariant(name[0]) + name[1..];

    private static string Key(string file, string name) => file + "#/definitions/" + name;

    private static string Spaces(int count) => new(' ', count);

    private static string Count(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static Dictionary<string, JsonObject> Load(IReadOnlyList<InputEntry> entries)
    {
        var documents = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            if (entry.IsFolder || !Files.Contains(entry.Name, StringComparer.Ordinal))
            {
                throw Fail(entry.Name, $"the schema folder holds only {BodyFile} and {ContentFile}");
            }

            documents.Add(entry.Name, Parse(entry.Name, entry.Bytes!));
        }

        foreach (var file in Files)
        {
            if (!documents.ContainsKey(file))
            {
                throw Fail(file, "not found in the schema folder");
            }
        }

        return documents;
    }

    private static JsonObject Parse(string file, byte[] bytes)
    {
        if (bytes.AsSpan().StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]))
        {
            throw Fail(file, "starts with a byte order mark");
        }

        if (TextAdmission.HoldsCarriageReturn(bytes))
        {
            throw Fail(file, "holds a carriage return (CR)");
        }

        JsonNode? node;
        try
        {
            node = StrictJson.Parse(StrictUtf8.GetString(bytes));
        }
        catch (Exception e) when (e is JsonException or DecoderFallbackException)
        {
            throw Fail(file, "not UTF-8 JSON without duplicate names: " + e.Message);
        }

        return node as JsonObject ?? throw Fail(file, "the document must be a JSON object");
    }

    private static JsonObject CheckDocument(string file, JsonObject document)
    {
        foreach (var key in new[] { "$schema", "$id", "definitions" })
        {
            if (!document.ContainsKey(key))
            {
                throw Fail(file, $"missing \"{key}\"");
            }
        }

        if (!IsString(document["$schema"], out var schema) || !string.Equals(schema, Draft07, StringComparison.Ordinal))
        {
            throw Fail(file, $"$schema must be {Draft07}");
        }

        if (!IsString(document["$id"], out var id) || !string.Equals(id, SchemaSet.BaseUri + file, StringComparison.Ordinal))
        {
            throw Fail(file, $"$id must be {SchemaSet.BaseUri + file}");
        }

        if (document.ContainsKey("title") && !IsString(document["title"], out _))
        {
            throw Fail(file, "title must be a string");
        }

        var rest = document.Select(p => p.Key).Where(k => !DocumentKeys.Contains(k, StringComparer.Ordinal)).ToList();
        if (string.Equals(file, BodyFile, StringComparison.Ordinal) && rest.Count > 0)
        {
            throw Fail(file, $"the body document holds definitions only, not \"{rest[0]}\"");
        }

        if (string.Equals(file, ContentFile, StringComparison.Ordinal))
        {
            if (!rest.Contains("oneOf", StringComparer.Ordinal))
            {
                throw Fail(file, "the content document needs its root Union (oneOf)");
            }

            var other = rest.Find(k => !string.Equals(k, "oneOf", StringComparison.Ordinal));
            if (other is not null)
            {
                throw Fail(file, $"the root form must be a Union alone, not with \"{other}\"");
            }
        }

        if (document["definitions"] is not JsonObject definitions || definitions.Count == 0)
        {
            throw Fail(file, "definitions must be an object holding one or more definitions");
        }

        foreach (var (name, _) in definitions)
        {
            CheckName(name, $"{file}#/definitions", "definition name");
        }

        return definitions;
    }

    private static void CheckName(string name, string at, string what)
    {
        if (!NamePattern().IsMatch(name))
        {
            throw Fail(at, $"{what} {JsonSerializer.Serialize(name)} is not a lower-case ASCII letter then at most 47 ASCII letters or digits");
        }
    }

    private static string Literal(JsonNode? value, string at)
    {
        if (!IsString(value, out var text) || !LiteralPattern().IsMatch(text))
        {
            throw Fail(at, "a literal string is a lower-case ASCII letter then at most 47 lower-case letters, digits or hyphens");
        }

        return text;
    }

    private static bool IsString(JsonNode? node, out string text)
    {
        var isString = node?.GetValueKind() == JsonValueKind.String;
        text = isString ? (string)node! : string.Empty;
        return isString;
    }

    private static void Keys(JsonObject node, string at, string[] required, string[] optional)
    {
        foreach (var key in required)
        {
            if (!node.ContainsKey(key))
            {
                throw Fail(at, $"missing \"{key}\"");
            }
        }

        foreach (var (key, _) in node)
        {
            if (!required.Contains(key, StringComparer.Ordinal) && !optional.Contains(key, StringComparer.Ordinal))
            {
                throw Fail(at, $"unsupported keyword \"{key}\" in this form");
            }
        }
    }

    private static Atom ConstForm(JsonObject node, string at)
    {
        Keys(node, at, ["const"], []);
        var kind = node["const"]?.GetValueKind();
        if (kind is JsonValueKind.True or JsonValueKind.False)
        {
            return new Atom(kind == JsonValueKind.True ? "true" : "false");
        }

        return kind == JsonValueKind.String
            ? new Atom($"\"{Literal(node["const"], at)}\"")
            : new Atom(SafeInteger(node["const"], at, "const").Token);
    }

    private static Ts EnumForm(JsonObject node, string at)
    {
        Keys(node, at, ["enum"], []);
        if (node["enum"] is not JsonArray values || values.Count == 0)
        {
            throw Fail(at, "enum must be a non-empty array");
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var members = new List<Ts>();
        foreach (var value in values)
        {
            var text = Literal(value, at);
            if (!seen.Add(text))
            {
                throw Fail(at, $"enum repeats \"{text}\"");
            }

            members.Add(new Atom($"\"{text}\""));
        }

        // One value is that literal itself; a union always has two or more members.
        return members.Count == 1 ? members[0] : new UnionOf(members);
    }

    private static Atom StringForm(JsonObject node, string at)
    {
        Keys(node, at, ["type"], ["minLength", "maxLength", "pattern"]);
        foreach (var key in new[] { "minLength", "maxLength" })
        {
            if (node.ContainsKey(key) && SafeInteger(node[key], at, key).Value < 0)
            {
                throw Fail(at, $"{key} must not be negative");
            }
        }

        // The pattern's dialect is the validator's concern; the type is plain string.
        if (node.ContainsKey("pattern") && !IsString(node["pattern"], out _))
        {
            throw Fail(at, "pattern must be a string");
        }

        return new Atom("string");
    }

    private static Atom IntegerForm(JsonObject node, string at)
    {
        Keys(node, at, ["type"], ["minimum"]);
        if (node.ContainsKey("minimum"))
        {
            _ = SafeInteger(node["minimum"], at, "minimum");
        }

        return new Atom("number");
    }

    private static Atom BooleanForm(JsonObject node, string at)
    {
        Keys(node, at, ["type"], []);
        return new Atom("boolean");
    }

    // The required string Const an Object holds under a tag name, or null when it holds none.
    private static string? Tag(JsonObject target, string tag, string at)
    {
        var node = (target["properties"] as JsonObject)?[tag] as JsonObject;
        var required = target["required"] as JsonArray;
        var held = node is { Count: 1 } && node["const"]?.GetValueKind() == JsonValueKind.String
            && required?.Any(r => IsString(r, out var s) && string.Equals(s, tag, StringComparison.Ordinal)) == true;
        return held ? Literal(node!["const"], at) : null;
    }

    private static (string Type, string? Kind) ObjectTags(JsonNode? definition, string name, string at)
    {
        if (definition is not JsonObject target || !IsString(target["type"], out var form) || !string.Equals(form, "object", StringComparison.Ordinal))
        {
            throw Fail(at, $"union member {name} is not an Object");
        }

        var type = Tag(target, "type", at) ?? throw Fail(at, $"union member {name} needs a required string const property named type");
        return (type, Tag(target, "kind", at));
    }

    private static HashSet<string> Required(JsonObject node, string at, JsonObject properties)
    {
        var required = new HashSet<string>(StringComparer.Ordinal);
        if (!node.ContainsKey("required"))
        {
            return required;
        }

        if (node["required"] is not JsonArray list || list.Count == 0)
        {
            throw Fail(at, "required must be a non-empty array");
        }

        foreach (var entry in list)
        {
            if (!IsString(entry, out var name))
            {
                throw Fail(at + "/required", "entries must be strings");
            }

            CheckName(name, at + "/required", "property name");
            if (!properties.ContainsKey(name) || !required.Add(name))
            {
                throw Fail(at + "/required", $"\"{name}\" is not a declared property, or is listed twice");
            }
        }

        return required;
    }

    // The only modelled not: every pair of one set of 2 to 8 optional properties, each pair once.
    private static List<string> AtMostOne(JsonNode? node, string at, JsonObject properties, HashSet<string> required)
    {
        if (node is not JsonObject not || not.Count != 1 || not["anyOf"] is not JsonArray anyOf || anyOf.Count == 0)
        {
            throw Fail(at, "not must be exactly { \"anyOf\": [ ... ] }");
        }

        var pairs = new List<(string A, string B)>();
        for (var i = 0; i < anyOf.Count; i++)
        {
            var entryAt = $"{at}/anyOf/{Count(i)}";
            if (anyOf[i] is not JsonObject entry || entry.Count != 1 || entry["required"] is not JsonArray names || names.Count != 2
                || !IsString(names[0], out var a) || !IsString(names[1], out var b))
            {
                throw Fail(entryAt, "each entry must be exactly { \"required\": [a, b] }");
            }

            foreach (var name in new[] { a, b })
            {
                if (!properties.ContainsKey(name) || required.Contains(name))
                {
                    throw Fail(entryAt, $"\"{name}\" is not an optional property of this object");
                }
            }

            pairs.Add(string.CompareOrdinal(a, b) <= 0 ? (a, b) : (b, a));
        }

        var set = pairs.SelectMany(p => new[] { p.A, p.B }).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
        if (set.Count is < 2 or > 8)
        {
            throw Fail(at, $"an at-most-one set holds 2 to 8 names, not {Count(set.Count)}");
        }

        var seen = new HashSet<(string, string)>();
        foreach (var pair in pairs)
        {
            if (string.Equals(pair.A, pair.B, StringComparison.Ordinal))
            {
                throw Fail(at, $"a pair repeats the name \"{pair.A}\"");
            }

            if (!seen.Add(pair))
            {
                throw Fail(at, $"the pair \"{pair.A}\", \"{pair.B}\" is listed twice, in either order");
            }
        }

        if (seen.Count != set.Count * (set.Count - 1) / 2)
        {
            throw Fail(at, $"a set of {Count(set.Count)} names needs all {Count(set.Count * (set.Count - 1) / 2)} pairs");
        }

        return set;
    }

    private static string Import(IReadOnlyList<string> names, string module)
    {
        var line = $"import type {{ {string.Join(", ", names)} }} from \"./{module}\";";
        return line.Length <= Width
            ? line
            : "import type {\n" + string.Concat(names.Select(n => $"  {n},\n")) + $"}} from \"./{module}\";";
    }

    private static string Statement(string alias, Ts type)
    {
        CheckShape(type, $"export type {alias}");
        return Place($"export type {alias} =", type, 0) + ";";
    }

    // The layout below has a rendering for each shape admitted here and no other, so a shape the
    // forms never meant to build is a refusal instead of an empty or truncated type.
    private static void CheckShape(Ts type, string at)
    {
        switch (type)
        {
            case Atom atom when atom.Text.Length > 0:
                return;
            case UnionOf union when union.Members.Count >= 2 && union.Members.All(m => m is not UnionOf):
                foreach (var member in union.Members)
                {
                    CheckShape(member, at);
                }

                return;
            case ArrayOf array:
                CheckShape(array.Item, at);
                return;
            case ObjectOf obj when obj.Fields.Count > 0:
                foreach (var field in obj.Fields)
                {
                    CheckShape(field.Type, at);
                }

                return;
            default:
                throw Fail(at, "the emitter has no rendering for this type shape");
        }
    }

    // The type after a prefix such as "export type X =" or "  name?:", in the formatter's layout.
    private static string Place(string prefix, Ts type, int indent)
    {
        var flat = Flat(type);
        if (flat is not null && prefix.Length + 1 + flat.Length + 1 <= Width)
        {
            return prefix + " " + flat;
        }

        // A union too long for the prefix line moves whole to the next line if it fits there.
        if (type is UnionOf && flat is not null && indent + 2 + flat.Length + 1 <= Width)
        {
            return prefix + "\n" + Spaces(indent + 2) + flat;
        }

        return type switch
        {
            UnionOf union => prefix + Broken(union, indent),
            _ => prefix + " " + Block(type, indent),
        };
    }

    private static string Broken(UnionOf union, int indent) =>
        string.Concat(union.Members.Select(m => "\n" + Spaces(indent + 2) + "| " + Block(m, indent + 4)));

    private static string Block(Ts type, int indent) => type switch
    {
        ObjectOf obj => "{" + string.Concat(obj.Fields.Select(f =>
            "\n" + Place(Spaces(indent + 2) + f.Name + (f.Optional ? "?:" : ":"), f.Type, indent + 2) + ";")) + "\n" + Spaces(indent) + "}",
        ArrayOf { Least: 2 } array => Flat(array) ?? throw new InvalidOperationException("an array of two or more passed the shape check without a one-line form"),
        ArrayOf { Least: 1 } array => "[\n" + Spaces(indent + 2) + Block(array.Item, indent + 2) + ",\n"
            + Spaces(indent + 2) + "..." + Block(array with { Least = 0 }, indent + 2) + ",\n" + Spaces(indent) + "]",
        ArrayOf array => Flat(array) ?? Block(array.Item, indent) + "[]",

        // In an element position a union that holds an object is parenthesised, as the formatter writes it.
        UnionOf union => Flat(union) ?? "(" + Broken(union, indent) + "\n" + Spaces(indent) + ")",
        Atom atom => atom.Text,
        _ => throw new InvalidOperationException("a type shape without a rendering passed the shape check"),
    };

    // The one-line form, or null when the type holds an object, which is always written expanded.
    private static string? Flat(Ts type)
    {
        switch (type)
        {
            case Atom atom:
                return atom.Text;
            case UnionOf union:
                var members = union.Members.Select(Flat).ToList();
                return members.Contains(null) ? null : string.Join(" | ", members);
            case ArrayOf array:
                var item = Flat(array.Item);
                if (item is null)
                {
                    return null;
                }

                var element = array.Item is UnionOf ? $"({item})" : item;
                return array.Least switch
                {
                    0 => element + "[]",
                    1 => $"[{item}, ...{element}[]]",
                    _ => $"[{item}, {item}, ...{element}[]]",
                };
            default:
                return null;
        }
    }

    private abstract record Ts;

    // An alias name, a keyword or a literal: never broken across lines.
    private sealed record Atom(string Text) : Ts;

    private sealed record UnionOf(IReadOnlyList<Ts> Members) : Ts;

    // Least is the fewest items the array may hold: none, one or two.
    private sealed record ArrayOf(Ts Item, int Least) : Ts;

    private sealed record ObjectOf(IReadOnlyList<Field> Fields) : Ts;

    private sealed record Field(string Name, bool Optional, Ts Type);

    private sealed class Run
    {
        private readonly Dictionary<string, JsonObject> _definitions = new(StringComparer.Ordinal);
        private readonly Dictionary<string, SortedSet<string>> _imports = new(StringComparer.Ordinal);

        // Edges between definitions that do not pass through an Object property.
        private readonly Dictionary<string, List<string>> _direct = new(StringComparer.Ordinal);
        private readonly Dictionary<string, List<(string Alias, Ts Type)>> _aliases = new(StringComparer.Ordinal);
        private readonly UnionOf _root;

        public Run(Dictionary<string, JsonObject> documents)
        {
            foreach (var file in Files)
            {
                _definitions[file] = CheckDocument(file, documents[file]);
                _imports[file] = new SortedSet<string>(StringComparer.Ordinal);
                _aliases[file] = [];
            }

            CheckAliases();
            foreach (var file in Files)
            {
                foreach (var (name, node) in _definitions[file])
                {
                    var edges = new List<string>();
                    _direct[Key(file, name)] = edges;
                    _aliases[file].Add((Alias(name), Node(node, file, Key(file, name), edges)));
                }
            }

            _root = UnionForm(new JsonObject { ["oneOf"] = documents[ContentFile]["oneOf"]!.DeepClone() }, ContentFile, ContentFile + "#", edges: null);
            CheckCycles();
        }

        public SortedDictionary<string, string> Modules()
        {
            var modules = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (var file in Files)
            {
                var text = new StringBuilder().Append(Header).Append('\n');
                var other = Files.Single(f => !string.Equals(f, file, StringComparison.Ordinal));
                if (_imports[file].Count > 0)
                {
                    text.Append('\n').Append(Import([.. _imports[file]], ModuleName(other))).Append('\n');
                }

                var statements = _aliases[file].Select(a => Statement(a.Alias, a.Type)).ToList();
                if (string.Equals(file, ContentFile, StringComparison.Ordinal))
                {
                    statements.Add(Statement(RootAlias, _root));
                }

                foreach (var statement in statements)
                {
                    text.Append('\n').Append(statement).Append('\n');
                }

                modules.Add(ModuleName(file), text.ToString());
            }

            return modules;
        }

        private void CheckAliases()
        {
            var owner = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var file in Files)
            {
                foreach (var (name, _) in _definitions[file])
                {
                    var alias = Alias(name);
                    if (string.Equals(alias, RootAlias, StringComparison.Ordinal) || Reserved.Contains(alias))
                    {
                        throw Fail(Key(file, name), $"alias {alias} is reserved");
                    }

                    if (!owner.TryAdd(alias, file))
                    {
                        throw Fail(Key(file, name), $"alias {alias} is also produced by {owner[alias]}");
                    }
                }
            }
        }

        private Ts Node(JsonNode? node, string file, string at, List<string>? edges)
        {
            if (node is not JsonObject obj)
            {
                throw Fail(at, "a schema node must be a JSON object");
            }

            if (obj.ContainsKey("$ref"))
            {
                return Ref(obj, file, at, edges).Type;
            }

            if (obj.ContainsKey("const"))
            {
                return ConstForm(obj, at);
            }

            if (obj.ContainsKey("enum"))
            {
                return EnumForm(obj, at);
            }

            if (obj.ContainsKey("oneOf"))
            {
                return UnionForm(obj, file, at, edges);
            }

            if (obj.ContainsKey("allOf"))
            {
                return RefinementForm(obj, file, at, edges);
            }

            if (!obj.ContainsKey("type"))
            {
                throw Fail(at, "matches no supported form");
            }

            if (!IsString(obj["type"], out var type))
            {
                throw Fail(at, "type must be a single string");
            }

            return type switch
            {
                "object" => ObjectForm(obj, file, at),
                "array" => ArrayForm(obj, file, at, edges),
                "string" => StringForm(obj, at),
                "integer" => IntegerForm(obj, at),
                "boolean" => BooleanForm(obj, at),
                _ => throw Fail(at, $"type {JsonSerializer.Serialize(type)} is not supported"),
            };
        }

        private (Atom Type, string File, string Name) Ref(JsonObject node, string file, string at, List<string>? edges)
        {
            Keys(node, at, ["$ref"], []);
            var match = IsString(node["$ref"], out var reference) ? RefPattern().Match(reference) : Match.Empty;
            if (!match.Success)
            {
                throw Fail(at, "$ref must be #/definitions/<name> or <schema file>#/definitions/<name>");
            }

            var target = match.Groups["file"].Success ? match.Groups["file"].Value + ".schema.json" : file;
            var name = match.Groups["name"].Value;
            if (!_definitions[target].ContainsKey(name))
            {
                throw Fail(at, $"$ref \"{reference}\" names no definition");
            }

            edges?.Add(Key(target, name));
            if (!string.Equals(target, file, StringComparison.Ordinal))
            {
                _imports[file].Add(Alias(name));
            }

            return (new Atom(Alias(name)), target, name);
        }

        // A union is admitted only as members told apart by one required string Const: type, or
        // kind where every member is an Object holding the same type. Where type tells them apart,
        // a member may itself be such a kind union, standing for the type its Objects share.
        private UnionOf UnionForm(JsonObject node, string file, string at, List<string>? edges)
        {
            Keys(node, at, ["oneOf"], []);
            if (node["oneOf"] is not JsonArray members || members.Count < 2)
            {
                throw Fail(at, "oneOf must hold two or more members");
            }

            var types = new List<Ts>();
            var tags = new List<(string Type, string? Kind, string Name, string At)>();
            for (var i = 0; i < members.Count; i++)
            {
                var memberAt = $"{at}/oneOf/{Count(i)}";
                if (members[i] is not JsonObject member || !member.ContainsKey("$ref"))
                {
                    throw Fail(memberAt, "a union member must be a $ref to an Object definition");
                }

                var (type, targetFile, name) = Ref(member, file, memberAt, edges);
                var (tag, kind) = MemberTags(targetFile, name, memberAt);
                tags.Add((tag, kind, name, memberAt));
                types.Add(type);
            }

            var byKind = tags.All(t => string.Equals(t.Type, tags[0].Type, StringComparison.Ordinal)) && tags.Exists(t => t.Kind is not null);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (type, kind, name, memberAt) in tags)
            {
                if (byKind && kind is null)
                {
                    throw Fail(memberAt, $"union member {name} shares type \"{type}\" and needs a required string const property named kind");
                }

                var value = byKind ? kind! : type;
                if (!seen.Add(value))
                {
                    throw Fail(memberAt, $"discriminator \"{value}\" is repeated");
                }
            }

            return new UnionOf(types);
        }

        // The tags of one member: an Object's own, or for a kind union the type its Objects share.
        private (string Type, string? Kind) MemberTags(string file, string name, string at)
        {
            var definition = _definitions[file][name];
            if (definition is not JsonObject { Count: 1 } union || union["oneOf"] is not JsonArray inner)
            {
                return ObjectTags(definition, name, at);
            }

            string? shared = null;
            foreach (var member in inner)
            {
                var match = member is JsonObject { Count: 1 } reference && IsString(reference["$ref"], out var text) ? RefPattern().Match(text) : Match.Empty;
                var target = match.Success && match.Groups["file"].Success ? match.Groups["file"].Value + ".schema.json" : file;
                if (!match.Success || !_definitions.TryGetValue(target, out var known) || !known.TryGetPropertyValue(match.Groups["name"].Value, out var inside))
                {
                    throw Fail(at, $"union member {name} is a union with a member that is not a $ref to a definition");
                }

                var (type, kind) = ObjectTags(inside, match.Groups["name"].Value, at);
                if (kind is null || (shared is not null && !string.Equals(shared, type, StringComparison.Ordinal)))
                {
                    throw Fail(at, $"union member {name} is a union whose members are not told apart by kind under one shared type");
                }

                shared = type;
            }

            return (shared ?? throw Fail(at, $"union member {name} is an empty union"), null);
        }

        private Atom RefinementForm(JsonObject node, string file, string at, List<string>? edges)
        {
            Keys(node, at, ["allOf"], []);
            if (node["allOf"] is not JsonArray parts || parts.Count != 2 || parts[0] is not JsonObject first || !first.ContainsKey("$ref"))
            {
                throw Fail(at, "allOf must be exactly [$ref, refinement]");
            }

            var type = Ref(first, file, at + "/allOf/0", edges).Type;
            var refinement = parts[1] as JsonObject;
            var pattern = refinement is { Count: 1 } && IsString(refinement["pattern"], out _);
            var excluded = refinement is { Count: 1 } && refinement["not"] is JsonObject { Count: 1 } not && IsString(not["const"], out _);
            if (!pattern && !excluded)
            {
                throw Fail(at + "/allOf/1", "a refinement is exactly { \"pattern\": string } or { \"not\": { \"const\": literal } }");
            }

            if (excluded)
            {
                _ = Literal(refinement!["not"]!["const"], at + "/allOf/1/not");
            }

            return type;
        }

        private Ts ArrayForm(JsonObject node, string file, string at, List<string>? edges)
        {
            Keys(node, at, ["type", "items"], ["minItems", "maxItems"]);
            if (node["items"] is not JsonObject items)
            {
                throw Fail(at, "items must be one schema; tuples are not supported");
            }

            var token = !node.ContainsKey("minItems") ? "0" : node["minItems"] is JsonValue min && min.GetValueKind() == JsonValueKind.Number ? min.ToJsonString() : null;
            var least = token switch
            {
                "0" when !node.ContainsKey("minItems") => 0,
                "1" => 1,
                "2" => 2,
                _ => throw Fail(at, "minItems must be absent, 1 or 2"),
            };
            var item = Node(items, file, at + "/items", edges);
            if (least == 2 && (node.ContainsKey("maxItems") || !items.ContainsKey("$ref") || item is not Atom))
            {
                throw Fail(at, "minItems 2 needs items that are a $ref and no maxItems");
            }

            if (!node.ContainsKey("maxItems"))
            {
                return new ArrayOf(item, least);
            }

            if (!items.ContainsKey("$ref") || item is not Atom alias)
            {
                throw Fail(at, "maxItems needs items that are a $ref");
            }

            var max = SafeInteger(node["maxItems"], at, "maxItems").Value;
            if (max is < 1 or > MaxBound)
            {
                throw Fail(at, $"maxItems must be from 1 to {Count(MaxBound)}");
            }

            var tuples = new List<Ts>();
            for (var length = least; length <= max; length++)
            {
                tuples.Add(new Atom("[" + string.Join(", ", Enumerable.Repeat(alias.Text, length)) + "]"));
            }

            if (((Atom)tuples[^1]).Text.Length > TupleWidth)
            {
                throw Fail(at, $"maxItems gives a tuple longer than {Count(TupleWidth)} characters");
            }

            return tuples.Count == 1 ? tuples[0] : new UnionOf(tuples);
        }

        private Ts ObjectForm(JsonObject node, string file, string at)
        {
            Keys(node, at, ["type", "additionalProperties", "properties"], ["required", "not"]);
            if (node["additionalProperties"]?.GetValueKind() != JsonValueKind.False)
            {
                throw Fail(at, "additionalProperties must be false");
            }

            if (node["properties"] is not JsonObject properties || properties.Count == 0)
            {
                throw Fail(at, "properties must hold at least one property");
            }

            foreach (var (name, _) in properties)
            {
                CheckName(name, at + "/properties", "property name");
            }

            var required = Required(node, at, properties);
            var exclusive = node.ContainsKey("not") ? AtMostOne(node["not"], at + "/not", properties, required) : [];

            // Properties never add direct edges: a cycle through one is a supported recursion.
            var fields = properties.Select(p => new Field(p.Key, !required.Contains(p.Key), Node(p.Value, file, $"{at}/properties/{p.Key}", edges: null))).ToList();
            if (exclusive.Count == 0)
            {
                return new ObjectOf(fields);
            }

            return new UnionOf(exclusive
                .Select(present => (Ts)new ObjectOf(fields
                    .Select(f => exclusive.Contains(f.Name, StringComparer.Ordinal) && !string.Equals(f.Name, present, StringComparison.Ordinal) ? f with { Type = new Atom("never") } : f)
                    .ToList()))
                .ToList());
        }

        // A cycle of aliases with no Object property on it has no finite TypeScript meaning here.
        private void CheckCycles()
        {
            var state = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (var key in _direct.Keys)
            {
                Visit(key, state, []);
            }
        }

        // State false: on the current path; true: finished.
        private void Visit(string key, Dictionary<string, bool> state, List<string> path)
        {
            if (state.TryGetValue(key, out var done))
            {
                if (!done)
                {
                    var cycle = path.Skip(path.IndexOf(key)).Append(key);
                    throw Fail(key, "reference cycle without an Object property: " + string.Join(" -> ", cycle));
                }

                return;
            }

            state[key] = false;
            path.Add(key);
            foreach (var next in _direct[key])
            {
                Visit(next, state, path);
            }

            path.RemoveAt(path.Count - 1);
            state[key] = true;
        }
    }
}
