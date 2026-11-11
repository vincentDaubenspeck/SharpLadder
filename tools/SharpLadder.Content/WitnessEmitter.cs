using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SharpLadder.Content;

/// <summary>
/// Writes one compiled JSON file as a TypeScript module holding the same value as a literal checked
/// with satisfies against the generated root type. Only objects, arrays, strings, booleans and safe
/// integers are admitted; every string is JSON-encoded, never interpolated.
/// </summary>
internal static class WitnessEmitter
{
    // Raised whenever the admitted value forms or the emitted module shape change.
    public const int GrammarVersion = 1;

    public const string Folder = "witness";
    public const string ExportName = "witness";

    // Line width of the emitter's own fixed layout.
    private const int Width = 80;

    // The layout never moves a value off the line of a property key this short or shorter.
    private const int ShortKey = 4;

    private static readonly string Header = $"// SharpLadder.Content witness emitter output, grammar {GrammarVersion.ToString(CultureInfo.InvariantCulture)}. Do not edit.";

    private static readonly JsonSerializerOptions StringOptions = new() { Encoder = JavaScriptEncoder.Default };
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // A compiled path such as chapters/a/b.json maps to witness/chapters/a/b.ts.
    public static string ModulePath(string compiledRelative)
    {
        if (!compiledRelative.EndsWith(".json", StringComparison.Ordinal))
        {
            throw new ArgumentException("a compiled payload path ends in .json", nameof(compiledRelative));
        }

        return $"{Folder}/{compiledRelative[..^".json".Length]}.ts";
    }

    // Text is null on refusal, with exactly one problem formatted <file>#<pointer>: <message>.
    public static (string? Text, IReadOnlyList<string> Problems) Emit(string compiledRelative, byte[] bytes)
    {
        try
        {
            var root = Convert(Parse(compiledRelative, bytes), compiledRelative + "#");
            if (root is not Obj obj)
            {
                throw Fail(compiledRelative + "#", "the witness value must be a JSON object");
            }

            return (Module(compiledRelative, obj), []);
        }
        catch (InvalidDataException e)
        {
            return (null, [e.Message]);
        }
    }

    private static InvalidDataException Fail(string at, string message) => new($"{at}: {message}");

    private static string Spaces(int count) => new(' ', count);

    private static JsonNode? Parse(string file, byte[] bytes)
    {
        if (bytes.AsSpan().StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]))
        {
            throw Fail(file + "#", "starts with a byte order mark");
        }

        try
        {
            return StrictJson.Parse(StrictUtf8.GetString(bytes));
        }
        catch (Exception e) when (e is JsonException or DecoderFallbackException)
        {
            throw Fail(file + "#", "not UTF-8 JSON without duplicate names: " + e.Message);
        }
    }

    private static Value Convert(JsonNode? node, string at)
    {
        switch (node)
        {
            case null:
                throw Fail(at, "null is not an admitted witness value");
            case JsonObject obj:
                var members = new List<(string, Value)>();
                foreach (var (key, value) in obj)
                {
                    // Keys are emitted unquoted, so anything an identifier cannot hold, __proto__ included, stops here.
                    if (!TypeEmitter.NamePattern().IsMatch(key))
                    {
                        throw Fail(at, $"key {JsonSerializer.Serialize(key)} is not a lower-case ASCII letter then at most 47 ASCII letters or digits");
                    }

                    members.Add((key, Convert(value, $"{at}/{key}")));
                }

                return new Obj(members);
            case JsonArray array:
                return new Arr([.. array.Select((item, i) => Convert(item, $"{at}/{i.ToString(CultureInfo.InvariantCulture)}"))]);
        }

        switch (node.GetValueKind())
        {
            case JsonValueKind.String:
                return new Atom(JsonSerializer.Serialize(node.GetValue<string>(), StringOptions), IsNumber: false);
            case JsonValueKind.True:
                return new Atom("true", IsNumber: false);
            case JsonValueKind.False:
                return new Atom("false", IsNumber: false);
            case JsonValueKind.Number:
                return new Atom(TypeEmitter.SafeInteger(node, at, "a number").Token, IsNumber: true);
            default:
                throw Fail(at, "not an admitted witness value");
        }
    }

    private static string Module(string compiledRelative, Obj root)
    {
        var ups = string.Concat(Enumerable.Repeat("../", compiledRelative.Count(c => c == '/') + 1));
        var import = $"import type {{ {TypeEmitter.RootAlias} }} from \"{ups}{TypeEmitter.ModuleName(TypeEmitter.ContentFile)}\";";
        if (import.Length > Width)
        {
            throw Fail(compiledRelative + "#", "the compiled path is too deep for a one-line type import");
        }

        var text = new StringBuilder()
            .Append(Header).Append("\n\n")
            .Append(import).Append("\n\n");
        var head = $"export const {ExportName} = ";
        var tail = $" satisfies {TypeEmitter.RootAlias};";
        if (root.Members.Count == 0)
        {
            return text.Append(head).Append("{}").Append(tail).Append('\n').ToString();
        }

        text.Append(head).Append("{\n");
        Members(text, root, 2);
        return text.Append('}').Append(tail).Append('\n').ToString();
    }

    private static void Members(StringBuilder text, Obj obj, int indent)
    {
        foreach (var (key, value) in obj.Members)
        {
            Place(text, indent, key + ": ", value, key.Length <= ShortKey);
        }
    }

    // One value at the given indentation, after an optional "key: " prefix, followed by a comma.
    private static void Place(StringBuilder text, int indent, string prefix, Value value, bool shortKey)
    {
        var pad = Spaces(indent);
        var flat = Flat(value);
        var atomLike = value is Atom or Obj { Members.Count: 0 } or Arr { Items.Count: 0 };

        // The layout keeps a boolean or an unsigned number beside its key at any width.
        var unbreakable = value is Atom { Token: "true" or "false" } or Atom { IsNumber: true, Token: [not '-', ..] };
        if (flat is not null && (pad.Length + prefix.Length + flat.Length + 1 <= Width || (atomLike && (shortKey || unbreakable || prefix.Length == 0))))
        {
            text.Append(pad).Append(prefix).Append(flat).Append(",\n");
            return;
        }

        switch (value)
        {
            case Obj obj when obj.Members.Count > 0:
                text.Append(pad).Append(prefix).Append("{\n");
                Members(text, obj, indent + 2);
                text.Append(pad).Append("},\n");
                break;
            case Arr arr when arr.Items.Count > 0:
                text.Append(pad).Append(prefix).Append("[\n");
                if (Concise(arr))
                {
                    Fill(text, arr, indent + 2);
                }
                else
                {
                    foreach (var item in arr.Items)
                    {
                        Place(text, indent + 2, string.Empty, item, shortKey: false);
                    }
                }

                text.Append(pad).Append("],\n");
                break;
            default:
                // An atom, {} or [] too long for its line moves under its key.
                text.Append(pad).Append(prefix.TrimEnd()).Append('\n')
                    .Append(Spaces(indent + 2)).Append(flat).Append(",\n");
                break;
        }
    }

    // The one-line form, or null where the layout always breaks: a non-empty object, or an array
    // of two or more arrays that each hold two or more items.
    private static string? Flat(Value value)
    {
        switch (value)
        {
            case Atom atom:
                return atom.Token;
            case Obj obj:
                return obj.Members.Count == 0 ? "{}" : null;
            case Arr arr:
                if (arr.Items.Count > 1 && arr.Items.All(i => i is Arr { Items.Count: > 1 }))
                {
                    return null;
                }

                var items = arr.Items.Select(Flat).ToList();
                return items.Any(i => i is null) ? null : "[" + string.Join(", ", items) + "]";
            default:
                throw new InvalidOperationException("unknown witness value");
        }
    }

    // The layout packs an array of two or more numbers as many to a line as fit.
    private static bool Concise(Arr arr) => arr.Items.Count > 1 && arr.Items.All(i => i is Atom { IsNumber: true });

    private static void Fill(StringBuilder text, Arr arr, int indent)
    {
        var line = new StringBuilder(Spaces(indent));
        var first = true;
        foreach (var token in arr.Items.Cast<Atom>().Select(a => a.Token))
        {
            if (!first && line.Length + 2 + token.Length + 1 > Width)
            {
                text.Append(line).Append(",\n");
                line.Clear().Append(Spaces(indent)).Append(token);
            }
            else
            {
                line.Append(first ? string.Empty : ", ").Append(token);
            }

            first = false;
        }

        text.Append(line).Append(",\n");
    }

    private abstract record Value;

    private sealed record Atom(string Token, bool IsNumber) : Value;

    private sealed record Obj(IReadOnlyList<(string Key, Value Value)> Members) : Value;

    private sealed record Arr(IReadOnlyList<Value> Items) : Value;
}
