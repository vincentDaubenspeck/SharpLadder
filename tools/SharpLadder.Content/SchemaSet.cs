using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LateApexEarlySpeed.Json.Schema;
using LateApexEarlySpeed.Json.Schema.JSchema;
using LateApexEarlySpeed.Json.Schema.JSchema.interfaces;
using LateApexEarlySpeed.Json.Schema.Keywords;

namespace SharpLadder.Content;

// The committed schema files as one offline registry. The folder is a boundary: only regular
// files directly inside it are read, never through a link, and every $ref must resolve to a
// schema position in one of them, so nothing is fetched and no file outside the folder is ever
// opened.
internal sealed class SchemaSet : IContentSchema
{
    public const string BaseUri = "https://sharpladder.com/schema/";
    public const string RootFile = "content.schema.json";
    private const string Draft07 = "http://json-schema.org/draft-07/schema#";

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private readonly JsonValidator _validator;

    private SchemaSet(JsonValidator validator) => _validator = validator;

    // A boundary refusal, a link in the folder included, throws BoundaryException.
    public static (SchemaSet? Set, IReadOnlyList<string> Problems) Load(string folder)
    {
        using var root = Folder.OpenRoot(folder, folder);
        return Load(InputTree.Read(root));
    }

    public static (SchemaSet? Set, IReadOnlyList<string> Problems) Load(InputTree tree)
    {
        var problems = new List<string>();
        var texts = new SortedDictionary<string, string>(StringComparer.Ordinal);
        var nodes = new SortedDictionary<string, JsonNode>(StringComparer.Ordinal);
        foreach (var entry in tree.Children(string.Empty))
        {
            if (entry.IsFolder || !entry.Name.EndsWith(".schema.json", StringComparison.Ordinal))
            {
                problems.Add($"{entry.Name}: the schema folder holds only *.schema.json files");
                continue;
            }

            Read(entry.Name, entry.Bytes!, texts, nodes, problems);
        }

        if (!texts.ContainsKey(BaseUri + RootFile))
        {
            problems.Add($"{RootFile} not found in the schema folder");
        }

        var positions = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var (uri, node) in nodes)
        {
            positions[uri] = new HashSet<string>(StringComparer.Ordinal);
            CheckPatterns(new Uri(uri).Segments[^1], node, "#", positions[uri], problems);
        }

        foreach (var (uri, node) in nodes)
        {
            CheckReferences(new Uri(uri), node, nodes, positions, problems, top: true);
        }

        if (problems.Count > 0)
        {
            return (null, problems);
        }

        // The validator library reports a malformed keyword value with assorted exception types.
        try
        {
            return (new SchemaSet(Build(texts)), []);
        }
        catch (Exception e)
        {
            return (null, [$"the schema files do not form a valid draft-07 schema: {e.Message}"]);
        }
    }

    public string? Validate(string json)
    {
        try
        {
            _ = StrictJson.Parse(json);
        }
        catch (JsonException e)
        {
            return "not JSON without duplicate names: " + e.Message;
        }

        var result = _validator.Validate(json);
        if (result.IsValid)
        {
            return null;
        }

        var error = result.ValidationErrors.FirstOrDefault();
        return error is null ? "invalid" : $"{error.InstanceLocation}: {error.ErrorMessage} ({error.Keyword})";
    }

    private static JsonValidator Build(SortedDictionary<string, string> texts)
    {
        var options = new JsonValidatorOptions { DefaultDialect = DialectKind.Draft7 };
        var validator = new JsonValidator(texts[BaseUri + RootFile], options)
        {
            ExternalSchemaDocumentPopulator = new RefusingPopulator(),
        };
        foreach (var (uri, text) in texts)
        {
            if (!string.Equals(uri, BaseUri + RootFile, StringComparison.Ordinal))
            {
                validator.AddExternalDocument(text, options);
            }
        }

        return validator;
    }

    private static void Read(string name, byte[] bytes, SortedDictionary<string, string> texts, SortedDictionary<string, JsonNode> nodes, List<string> problems)
    {
        string text;
        JsonNode? node;
        try
        {
            text = StrictUtf8.GetString(bytes);
            node = StrictJson.Parse(text);
        }
        catch (Exception e) when (e is JsonException or DecoderFallbackException)
        {
            problems.Add($"{name}: not UTF-8 JSON: {e.Message}");
            return;
        }

        var id = BaseUri + name;
        var declaredSchema = (node as JsonObject)?["$schema"]?.GetValueKind() == JsonValueKind.String ? (string?)node!["$schema"] : null;
        var declaredId = (node as JsonObject)?["$id"]?.GetValueKind() == JsonValueKind.String ? (string?)node!["$id"] : null;
        var ok = string.Equals(declaredSchema, Draft07, StringComparison.Ordinal) && string.Equals(declaredId, id, StringComparison.Ordinal);
        if (!ok)
        {
            problems.Add($"{name}: $schema must be {Draft07} and $id must be {id}");
            return;
        }

        texts.Add(id, text);
        nodes.Add(id, node!);
    }

    private static void CheckReferences(Uri document, JsonNode? node, SortedDictionary<string, JsonNode> nodes, Dictionary<string, HashSet<string>> positions, List<string> problems, bool top)
    {
        var name = document.Segments[^1];
        if (node is JsonArray array)
        {
            foreach (var item in array)
            {
                CheckReferences(document, item, nodes, positions, problems, top: false);
            }
        }

        if (node is not JsonObject obj)
        {
            return;
        }

        foreach (var (key, value) in obj)
        {
            if (string.Equals(key, "$id", StringComparison.Ordinal) && !top)
            {
                problems.Add($"{name}: a nested $id is not allowed; one $id per file");
            }
            else if (string.Equals(key, "$ref", StringComparison.Ordinal))
            {
                CheckReference(document, value, nodes, positions, problems);
            }

            CheckReferences(document, value, nodes, positions, problems, top: false);
        }
    }

    private static void CheckReference(Uri document, JsonNode? value, SortedDictionary<string, JsonNode> nodes, Dictionary<string, HashSet<string>> positions, List<string> problems)
    {
        var name = document.Segments[^1];
        var text = value?.GetValueKind() == JsonValueKind.String ? (string?)value : null;
        if (text is null || !Uri.TryCreate(document, text, out var target))
        {
            problems.Add($"{name}: $ref must be a string holding a valid reference");
        }
        else if (!nodes.TryGetValue(target.GetLeftPart(UriPartial.Query), out var root))
        {
            problems.Add($"{name}: $ref \"{text}\" leaves the schema folder");
        }
        else if (!Resolves(root, target.Fragment, out var pointer))
        {
            problems.Add($"{name}: $ref \"{text}\" names no location in {target.Segments[^1]}");
        }
        else if (!positions[target.GetLeftPart(UriPartial.Query)].Contains("#" + pointer))
        {
            // The validator registers only schema positions, and would otherwise find out only once
            // an instance reaches the reference, and throw; nor were patterns there compiled.
            problems.Add($"{name}: $ref \"{text}\" does not name a schema in {target.Segments[^1]}");
        }
    }

    // The validator compiles a pattern only when an instance first reaches it, so a bad one would
    // otherwise pass while unused and fail mid-run once used. Only schema positions are walked, and
    // recorded as the only places a $ref may name: a "pattern" inside const, enum, default or
    // examples is data.
    private static void CheckPatterns(string name, JsonNode? node, string pointer, HashSet<string> positions, List<string> problems)
    {
        if (node?.GetValueKind() is JsonValueKind.True or JsonValueKind.False)
        {
            positions.Add(pointer);
        }

        if (node is not JsonObject schema)
        {
            return;
        }

        positions.Add(pointer);

        // Draft-07 ignores every keyword beside $ref, so the validator registers nothing below it.
        if (schema.ContainsKey("$ref"))
        {
            return;
        }

        foreach (var (key, value) in schema)
        {
            var at = pointer + "/" + Escape(key);
            switch (key)
            {
                case "pattern" when value?.GetValueKind() == JsonValueKind.String:
                    CheckPattern(name, (string)value!, at, problems);
                    break;
                case "patternProperties" when value is JsonObject map:
                    foreach (var (pattern, child) in map)
                    {
                        CheckPattern(name, pattern, at + "/" + Escape(pattern), problems);
                        CheckPatterns(name, child, at + "/" + Escape(pattern), positions, problems);
                    }

                    break;
                case "properties" or "definitions" or "dependencies" when value is JsonObject map:
                    foreach (var (child, sub) in map)
                    {
                        CheckPatterns(name, sub, at + "/" + Escape(child), positions, problems);
                    }

                    break;
                case "items" or "allOf" or "anyOf" or "oneOf" when value is JsonArray list:
                    for (var i = 0; i < list.Count; i++)
                    {
                        CheckPatterns(name, list[i], at + "/" + i.ToString(CultureInfo.InvariantCulture), positions, problems);
                    }

                    break;
                case "items" or "additionalItems" or "additionalProperties" or "contains" or "propertyNames" or "not" or "if" or "then" or "else":
                    CheckPatterns(name, value, at, positions, problems);
                    break;
            }
        }
    }

    // Same engine and options as the validator, which adds only RegexOptions.Compiled once a
    // pattern is hot; that changes speed, never what parses.
    private static void CheckPattern(string name, string pattern, string pointer, List<string> problems)
    {
        try
        {
            _ = new Regex(pattern, RegexOptions.None, TimeSpan.FromSeconds(1));
        }
        catch (ArgumentException e)
        {
            problems.Add($"{name}: {pointer} is not a valid regular expression: {e.Message}");
        }
    }

    private static string Escape(string token) =>
        token.Replace("~", "~0", StringComparison.Ordinal).Replace("/", "~1", StringComparison.Ordinal);

    // Only JSON pointer fragments can resolve: one $id per file leaves no plain-name anchors.
    // The fragment is percent-decoded as a whole before it is read as an RFC 6901 pointer, which
    // is given back in the escaped form the schema walk records.
    private static bool Resolves(JsonNode root, string fragment, out string pointer)
    {
        pointer = Uri.UnescapeDataString(fragment.StartsWith('#') ? fragment[1..] : fragment);
        if (pointer.Length == 0)
        {
            return true;
        }

        if (pointer[0] != '/' || !HasOnlyValidEscapes(pointer))
        {
            return false;
        }

        JsonNode? node = root;
        foreach (var raw in pointer[1..].Split('/'))
        {
            var token = raw.Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal);
            node = node switch
            {
                JsonObject obj when obj.TryGetPropertyValue(token, out var child) => child,
                JsonArray array when IsIndex(token, array.Count) => array[int.Parse(token, CultureInfo.InvariantCulture)],
                _ => null,
            };
            if (node is null)
            {
                return false;
            }
        }

        return true;
    }

    private static bool HasOnlyValidEscapes(string pointer)
    {
        for (var i = 0; i < pointer.Length; i++)
        {
            if (pointer[i] == '~' && (i + 1 == pointer.Length || pointer[i + 1] is not ('0' or '1')))
            {
                return false;
            }
        }

        return true;
    }

    // A JSON pointer array index is "0" or digits without a leading zero.
    private static bool IsIndex(string token, int count) =>
        (string.Equals(token, "0", StringComparison.Ordinal) || (token.Length is > 0 and < 10 && token[0] != '0' && token.All(char.IsAsciiDigit)))
        && int.Parse(token, CultureInfo.InvariantCulture) < count;

    // Any $ref the registry cannot answer fails validation instead of being fetched.
    private sealed class RefusingPopulator : IExternalSchemaDocumentPopulator
    {
        public void Populate(Uri baseUri, ExternalSchemaRegistry externalSchemaRegistry) =>
            throw new InvalidOperationException($"schema reference {baseUri} is outside the offline registry");
    }
}
