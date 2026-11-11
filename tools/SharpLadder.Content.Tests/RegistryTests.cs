using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;

namespace SharpLadder.Content.Tests;

// The alias and pattern registries, compiled from real files beside two small chapters.
public sealed class RegistryTests
{
    private const string Chapter = "---\nid: ch-test\nslug: test\ntitle: Test\norder: 1\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n\n## Start {#start}\n\nText.\n";
    private const string Other = "---\nid: ch-other\nslug: other\ntitle: Other\norder: 2\ntargets: { csharp: 12, dotnet: 8 }\n---\n\nIntro text.\n\n## Other start {#other-start}\n\nText.\n";
    private const string Part = "---\nkind: syntax\nchapter: ch-test\norder: 1\n---\n\n## One {#syn-one}\n\n```csharp {#syn-code group=g spoken=\"Runs it\"}\nint x = 1;\n```\n\n## Two {#syn-two}\n\nText.\n";
    private const string NoAliases = "slugs: {}\nids: {}\n";
    private const string NoPatterns = "patterns: []\n";

    [Fact]
    public void EmptyRegistriesCompileToEmptyRecords()
    {
        var result = Compile(NoAliases, NoPatterns);

        Assert.Empty(result.Diagnostics);
        Assert.Equal("{\n  \"slugs\": {},\n  \"ids\": {}\n}\n", Text(result, "aliases.json"));
        Assert.Equal("{\n  \"patterns\": []\n}\n", Text(result, "patterns.json"));
        Assert.Equal(RecordKind.Aliases, result.Files.Single(f => f.RelativePath is "aliases.json").Kind);
        Assert.Equal(RecordKind.Patterns, result.Files.Single(f => f.RelativePath is "patterns.json").Kind);
    }

    [Fact]
    public void AliasesEndAtLiveNamesInChapterAndPartFiles()
    {
        var aliases = Aliases("slugs:\n  old-test: test\n  old-other: other\nids:\n  begin: start\n  syn-first: syn-one\n  other-begin: other-start\n");

        Assert.Equal("""{"old-other":"other","old-test":"test"}""", aliases["slugs"]!.ToJsonString());
        Assert.Equal("""{"begin":"start","other-begin":"other-start","syn-first":"syn-one"}""", aliases["ids"]!.ToJsonString());
    }

    [Theory]
    [InlineData("ids:\n  a: b\n  b: c\n  c: start\nslugs:\n  x: y\n  y: z\n  z: test\n")]
    [InlineData("slugs:\n  z: test\n  y: z\n  x: y\nids:\n  c: start\n  b: c\n  a: b\n")]
    [InlineData("slugs: { \"x\": 'y', y: z, z: test }\nids: { a: b, \"\\u0062\": c, c: \"st\\x61rt\" }\n")]
    public void ChainsAreFlattenedAndKeyOrderDoesNotChangeTheBytes(string yaml)
    {
        var result = Compile(yaml, NoPatterns);

        Assert.Empty(result.Diagnostics);
        Assert.Equal(
            "{\n  \"slugs\": {\n    \"x\": \"test\",\n    \"y\": \"test\",\n    \"z\": \"test\"\n  },\n  \"ids\": {\n    \"a\": \"start\",\n    \"b\": \"start\",\n    \"c\": \"start\"\n  }\n}\n",
            Text(result, "aliases.json"));
    }

    [Fact]
    public void DiamondOfAliasesEndsAtTheOneLiveName()
    {
        var aliases = Aliases("slugs: {}\nids:\n  top: left\n  left: base\n  right: base\n  base: syn-two\n  also: right\n");

        Assert.All(aliases["ids"]!.AsObject(), entry => Assert.Equal("syn-two", entry.Value!.GetValue<string>()));
        Assert.Equal(5, aliases["ids"]!.AsObject().Count);
    }

    // A culture-aware order would put "ab" before "a-c"; the registry is ordered by code unit.
    [Fact]
    public void KeysAreInOrdinalOrder()
    {
        var aliases = Aliases("slugs: {}\nids:\n  ab: start\n  a-c: start\n  a0: start\n  constructor: start\n  Z: start\n".Replace("  Z: start\n", string.Empty, StringComparison.Ordinal));

        Assert.Equal(["a-c", "a0", "ab", "constructor"], aliases["ids"]!.AsObject().Select(e => e.Key), StringComparer.Ordinal);
    }

    // The web check holds the same sweep against the same schema line.
    [Fact]
    public void BlankListAgreesWithTheSchemaOnEveryCodeUnit()
    {
        var schema = JsonNode.Parse(File.ReadAllText(Path.Combine(Repository.SchemaFolder, "patterns.schema.json")))!;
        var stated = new Regex((string)schema["definitions"]!["plainText"]!["pattern"]!, RegexOptions.None, TimeSpan.FromSeconds(1));
        int[] blanks = [0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
        var differs = new List<int>();
        for (var unit = 0; unit <= char.MaxValue; unit++)
        {
            var text = ((char)unit).ToString();
            var shows = Registries.ShowsSomething(text);
            if (stated.IsMatch(text) != shows || shows == blanks.Contains(unit))
            {
                differs.Add(unit);
            }
        }

        Assert.Empty(differs);
        Assert.False(Registries.ShowsSomething(string.Empty));
        Assert.True(Registries.ShowsSomething("\uFEFFa\u2028"));
    }

    [Fact]
    public void TextThatMixesBlanksWithSomethingShownIsKept()
    {
        var result = Compile(NoAliases, "patterns:\n  - { id: pat-a, title: \"T\\uFEFF\", summary: \"\\u200B\" }\n");

        Assert.Empty(result.Diagnostics);
    }

    // A reader that lists digit-only names by number would see these two the other way round.
    [Fact]
    public void DigitOnlySlugsAreTextInOrdinalOrder()
    {
        var result = Compile("slugs:\n  2: test\n  10: test\n  1a: test\nids: {}\n", NoPatterns);

        Assert.Empty(result.Diagnostics);
        Assert.Contains("\"slugs\": {\n    \"10\": \"test\",\n    \"1a\": \"test\",\n    \"2\": \"test\"\n  }", Text(result, "aliases.json"), StringComparison.Ordinal);
    }

    // The markers are refused on the events that carry them, so the same characters in a comment
    // or inside quotes are ordinary text.
    [Fact]
    public void MarkerCharactersInCommentsAndQuotesAreOrdinary()
    {
        var result = Compile(
            "# &anchor *alias !tag <<: merge\nslugs: {} # <<: &a\nids:\n  begin: start # *a\n",
            "patterns:\n  - id: pat-marks\n    title: \"&anchor *alias !tag <<: merge\"\n    summary: '<<'\n");

        Assert.Empty(result.Diagnostics);
        Assert.Equal("&anchor *alias !tag <<: merge", Patterns(result)[0]!["title"]!.GetValue<string>());
        Assert.Equal("<<", Patterns(result)[0]!["summary"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("slugs: {}\nids:\n  a: a\n", "aliases.yml:3: \"a\" leads back to \"a\"")]
    [InlineData("slugs: {}\nids:\n  a: b\n  b: a\n", "aliases.yml:3: \"a\" leads back to \"a\"")]
    [InlineData("slugs: {}\nids:\n  a: b\n  b: c\n  c: d\n  d: e\n  e: b\n", "leads back to")]
    [InlineData("slugs:\n  a: b\n  b: a\nids: {}\n", "aliases.yml:2: \"a\" leads back to \"a\"")]
    [InlineData("slugs: {}\nids:\n  start: syn-one\n", "aliases.yml:3: \"start\" is in use, so it cannot be retired")]
    [InlineData("slugs: {}\nids:\n  syn-code: syn-one\n", "\"syn-code\" is in use")]
    [InlineData("slugs: {}\nids:\n  ch-test: syn-one\n", "\"ch-test\" is in use")]
    [InlineData("slugs:\n  test: other\nids: {}\n", "aliases.yml:2: \"test\" is in use")]
    [InlineData("slugs: {}\nids:\n  a: gone\n", "aliases.yml:3: \"a\" ends at \"gone\", which is not a section id")]
    [InlineData("slugs: {}\nids:\n  a: b\n  b: gone\n", "\"a\" ends at \"gone\", which is not a section id")]
    [InlineData("slugs: {}\nids:\n  a: syn-code\n", "\"a\" ends at \"syn-code\", which is not a section id")]
    [InlineData("slugs: {}\nids:\n  a: ch-test\n", "\"a\" ends at \"ch-test\", which is not a section id")]
    [InlineData("slugs: {}\nids:\n  a: test\n", "\"a\" ends at \"test\", which is not a section id")]
    [InlineData("slugs:\n  a: gone\nids: {}\n", "aliases.yml:2: \"a\" ends at \"gone\", which is not a chapter slug")]
    [InlineData("slugs:\n  a: start\nids: {}\n", "\"a\" ends at \"start\", which is not a chapter slug")]
    [InlineData("slugs:\n  a: ch-test\nids: {}\n", "\"a\" ends at \"ch-test\", which is not a chapter slug")]
    public void AliasThatDoesNotEndAtALiveNameOfItsKindIsRefused(string yaml, string expected) =>
        AssertRefused(Compile(yaml, NoPatterns), "aliases.yml", expected);

    [Theory]
    [InlineData("slugs: {}\nids:\n  syn-one/b1: start\n", "retired id \"syn-one/b1\" is not lowercase letters")]
    [InlineData("slugs: {}\nids:\n  ladder-x/r1: start\n", "retired id \"ladder-x/r1\" is not lowercase letters")]
    [InlineData("slugs: {}\nids:\n  a: syn-one/b1\n", "target id \"syn-one/b1\" is not lowercase letters")]
    [InlineData("slugs: {}\nids:\n  Old: start\n", "retired id \"Old\"")]
    [InlineData("slugs: {}\nids:\n  1a: start\n", "retired id \"1a\"")]
    [InlineData("slugs: {}\nids:\n  \"\": start\n", "retired id \"\"")]
    [InlineData("slugs: {}\nids:\n  \"a\\n\": start\n", "retired id \"a\\n\"")]
    [InlineData("slugs: {}\nids:\n  a: \"start\\n\"\n", "target id \"start\\n\"")]
    [InlineData("slugs: {}\nids:\n  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: start\n", "retired id")]
    [InlineData("slugs:\n  old_test: test\nids: {}\n", "retired slug \"old_test\" is not lowercase letters and digits in hyphen-separated runs")]
    [InlineData("slugs:\n  -old: test\nids: {}\n", "retired slug \"-old\"")]
    [InlineData("slugs:\n  old--test: test\nids: {}\n", "retired slug \"old--test\"")]
    [InlineData("slugs:\n  Old: test\nids: {}\n", "retired slug \"Old\"")]
    [InlineData("slugs:\n  a: Test\nids: {}\n", "target slug \"Test\"")]
    [InlineData("slugs:\n  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: test\nids: {}\n", "retired slug")]
    public void AliasNameOutsideItsGrammarIsRefused(string yaml, string expected) =>
        AssertRefused(Compile(yaml, NoPatterns), "aliases.yml", expected);

    [Theory]
    [InlineData("slugs: {}\nids:\n  a: start\n  a: syn-one\n", "aliases.yml:4: duplicate key \"a\"")]
    [InlineData("slugs: {}\nids:\n  ab: start\n  \"a\\u0062\": syn-one\n", "aliases.yml:4: duplicate key \"ab\"")]
    [InlineData("slugs: {}\nids:\n  ab: start\n  'ab': syn-one\n", "duplicate key \"ab\"")]
    [InlineData("slugs: {}\nids: {}\nslugs: {}\n", "aliases.yml:3: duplicate key \"slugs\"")]
    [InlineData("slugs: {}\nids: { a: start, \"\\x61\": start }\n", "duplicate key \"a\"")]
    public void DuplicateKeyInAnySpellingIsRefused(string yaml, string expected) =>
        AssertRefused(Compile(yaml, NoPatterns), "aliases.yml", expected);

    [Theory]
    [InlineData("slugs: {}\nids:\n  a: &x start\n", "aliases.yml:3: an anchor (&name) is not accepted")]
    [InlineData("slugs: {}\nids:\n  a: &x start\n  b: *x\n", "an anchor (&name) is not accepted")]
    [InlineData("slugs: &m {}\nids: {}\n", "aliases.yml:1: an anchor (&name) is not accepted")]
    [InlineData("slugs: {}\nids:\n  &k a: start\n", "an anchor (&name) is not accepted")]
    [InlineData("slugs: {}\nids:\n  a: *x\n", "aliases.yml:")]
    [InlineData("slugs: {}\nids:\n  <<: { a: start }\n", "aliases.yml:3: the merge key (<<) is not accepted")]
    [InlineData("slugs: {}\nids:\n  a: !!str start\n", "aliases.yml:3: a tag (!name) is not accepted")]
    [InlineData("slugs: {}\nids: !!map {}\n", "a tag (!name) is not accepted")]
    [InlineData("slugs: {}\nids:\n  a: ! start\n", "a tag (!name) is not accepted")]
    [InlineData("slugs: {}\nids:\n  !!str a: start\n", "a tag (!name) is not accepted")]
    [InlineData("slugs: {}\nids:\n  a: !custom start\n", "a tag (!name) is not accepted")]
    [InlineData("slugs: {}\nids:\n  [a, b]: start\n", "a key must be plain text")]
    [InlineData("slugs: {}\nids:\n  { a: b }: start\n", "a key must be plain text")]
    public void AnchorAliasMergeKeyAndTagAreRefusedOnTheEventStream(string yaml, string expected) =>
        AssertRefused(Compile(yaml, NoPatterns), "aliases.yml", expected);

    [Theory]
    [InlineData("", "aliases.yml:1: the file holds no document")]
    [InlineData("\n\n  \n", "the file holds no document")]
    [InlineData("# only a comment\n", "the file holds no document")]
    [InlineData("---\n", "the document must be a mapping")]
    [InlineData("~\n", "the document must be a mapping")]
    [InlineData("null\n", "the document must be a mapping")]
    [InlineData("[]\n", "the document must be a mapping")]
    [InlineData("{}\n", "aliases.yml:1: slugs is missing")]
    [InlineData("slugs: {}\n", "ids is missing")]
    [InlineData("ids: {}\n", "slugs is missing")]
    [InlineData("slugs: {}\nids: {}\nextra: {}\n", "aliases.yml:3: unknown key \"extra\"; only slugs, ids are accepted")]
    [InlineData("Slugs: {}\nids: {}\n", "unknown key \"Slugs\"")]
    [InlineData("slugs:\nids: {}\n", "slugs must be a mapping of old to new; write {} for none")]
    [InlineData("slugs: []\nids: {}\n", "slugs must be a mapping of old to new")]
    [InlineData("slugs: {}\nids: none\n", "ids must be a mapping of old to new")]
    [InlineData("slugs: {}\nids:\n  a: [start]\n", "the target of \"a\" must be text")]
    [InlineData("slugs: {}\nids:\n  a: { b: start }\n", "the target of \"a\" must be text")]
    [InlineData("slugs: {}\nids:\n  a:\n", "target id \"\"")]
    [InlineData("slugs: {}\nids: {}\n---\nslugs: {}\nids: {}\n", "a second document is not accepted")]
    [InlineData("slugs: {}\nids: {a: {b: {c: {d: {e: {f: {g: {h: i}}}}}}}}\n", "nesting is too deep")]
    [InlineData("slugs: {}\nids: {\n", "aliases.yml:")]
    [InlineData("slugs: {}\nids:\n\ta: start\n", "aliases.yml:")]
    public void DocumentOutsideTheClosedShapeIsRefused(string yaml, string expected) =>
        AssertRefused(Compile(yaml, NoPatterns), "aliases.yml", expected);

    [Theory]
    [InlineData("aliases.yml", "bom", "aliases.yml:1: file starts with a byte order mark")]
    [InlineData("aliases.yml", "crlf", "aliases.yml:1: file holds a carriage return (CR)")]
    [InlineData("aliases.yml", "cr", "aliases.yml:1: file holds a carriage return (CR)")]
    [InlineData("aliases.yml", "utf8", "aliases.yml: file is not valid UTF-8")]
    [InlineData("patterns.yml", "bom", "patterns.yml:1: file starts with a byte order mark")]
    [InlineData("patterns.yml", "crlf", "patterns.yml:1: file holds a carriage return (CR)")]
    [InlineData("patterns.yml", "cr", "patterns.yml:1: file holds a carriage return (CR)")]
    [InlineData("patterns.yml", "utf8", "patterns.yml: file is not valid UTF-8")]
    public void RegistryBytesAreAdmittedBeforeAnyReaderSeesThem(string file, string change, string expected)
    {
        var good = Encoding.UTF8.GetBytes(file is "aliases.yml" ? NoAliases : NoPatterns);
        byte[] bytes = change switch
        {
            "bom" => [0xEF, 0xBB, 0xBF, .. good],
            "crlf" => Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(good).Replace("\n", "\r\n", StringComparison.Ordinal)),
            "cr" => Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(good).Replace('\n', '\r')),
            _ => [.. good, 0xFF, (byte)'\n'],
        };
        using var folder = Tree(NoAliases, NoPatterns);
        File.WriteAllBytes(Path.Combine(folder.Path, file), bytes);

        AssertRefused(Repository.CompileAsWritten(folder.Path), file, expected);
    }

    [Theory]
    [InlineData("aliases.yml")]
    [InlineData("patterns.yml")]
    public void MissingRegistryIsRefused(string file)
    {
        using var folder = Tree(NoAliases, NoPatterns);
        File.Delete(Path.Combine(folder.Path, file));

        var result = Repository.CompileAsWritten(folder.Path);

        Assert.Empty(result.Files);
        Assert.Contains($".: {file} is missing; the content root must hold it", result.Diagnostics.Select(d => d.ToString()), StringComparer.Ordinal);
    }

    [Theory]
    [InlineData("aliases.yml")]
    [InlineData("patterns.yml")]
    public void FolderInPlaceOfARegistryIsRefused(string file)
    {
        using var folder = Tree(NoAliases, NoPatterns);
        File.Delete(Path.Combine(folder.Path, file));
        Directory.CreateDirectory(Path.Combine(folder.Path, file));

        AssertRefused(Repository.CompileAsWritten(folder.Path), file, $"{file}: not a file");
    }

    [Theory]
    [InlineData("aliases.yml", "ALIASES.yml")]
    [InlineData("aliases.yml", "aliases.yaml")]
    [InlineData("patterns.yml", "Patterns.yml")]
    public void RegistryUnderAnotherSpellingIsNotTheRegistry(string file, string spelling)
    {
        using var folder = Tree(NoAliases, NoPatterns);
        var moved = Path.Combine(folder.Path, "moved");
        File.Move(Path.Combine(folder.Path, file), moved);
        File.Move(moved, Path.Combine(folder.Path, spelling));

        var result = Repository.CompileAsWritten(folder.Path);

        Assert.Empty(result.Files);
        Assert.Contains(result.Diagnostics, d => d.ToString().StartsWith(spelling + ": the content root holds only", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("See [this](#begin).\n", "chapters/c/part.md:17: link target \"#begin\" names the retired id \"begin\"; link to \"start\"")]
    [InlineData("See [this](#syn-first).\n", "link target \"#syn-first\" names the retired id \"syn-first\"; link to \"syn-one\"")]
    [InlineData("See [this](ch-test#syn-first).\n", "names the retired id \"syn-first\"; link to \"syn-one\"")]
    [InlineData("See [this](ch-other#other-begin).\n", "link target \"ch-other#other-begin\" names the retired id \"other-begin\"; link to \"other-start\"")]
    [InlineData("See [this](ch-other#other-older).\n", "names the retired id \"other-older\"; link to \"other-start\"")]
    public void LinkToARetiredIdIsRefusedAndNamesItsSuccessor(string paragraph, string expected)
    {
        const string Retired = "slugs: {}\nids:\n  begin: start\n  syn-first: syn-one\n  other-begin: other-start\n  other-older: other-begin\n";

        var result = Compile(Retired, NoPatterns, Part + "\n" + paragraph);

        Assert.Empty(result.Files);
        Assert.Contains(expected, Assert.Single(result.Diagnostics).ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void LinkToALiveIdInAnotherChapterStillCompilesBesideAliases()
    {
        var result = Compile("slugs: {}\nids:\n  other-begin: other-start\n", NoPatterns, Part + "\nSee [this](ch-other#other-start).\n");

        Assert.Empty(result.Diagnostics);
    }

    [Theory]
    [InlineData("patterns:\n  - { id: pat-b, title: B, summary: Second. }\n  - { id: pat-a, title: A, summary: First. }\n")]
    [InlineData("patterns:\n  - summary: First.\n    title: A\n    id: pat-a\n  - title: B\n    id: pat-b\n    summary: Second.\n")]
    public void PatternsAreOrderedByIdWhateverTheSourceOrder(string yaml)
    {
        var result = Compile(NoAliases, yaml);

        Assert.Empty(result.Diagnostics);
        Assert.Equal(
            "{\n  \"patterns\": [\n    {\n      \"id\": \"pat-a\",\n      \"title\": \"A\",\n      \"summary\": \"First.\"\n    },\n    {\n      \"id\": \"pat-b\",\n      \"title\": \"B\",\n      \"summary\": \"Second.\"\n    }\n  ]\n}\n",
            Text(result, "patterns.json"));
    }

    // Plain text is kept as written: no Markdown, no normalisation, no trimming, no type guessing.
    [Theory]
    [InlineData("\"**bold** and `code` and [a](#start)\"", "**bold** and `code` and [a](#start)")]
    [InlineData("\"<b>x</b> &amp;\"", "<b>x</b> &amp;")]
    [InlineData("123", "123")]
    [InlineData("true", "true")]
    [InlineData("~", "~")]
    [InlineData("null", "null")]
    [InlineData("\"  padded  \"", "  padded  ")]
    [InlineData("\"cafe\\u0301\"", "cafe\u0301")]
    [InlineData("\"one\\ntwo\"", "one\ntwo")]
    [InlineData("|\n      one\n      two\n", "one\ntwo\n")]
    [InlineData("\"tab\\there\"", "tab\there")]
    [InlineData("\"\\U0001F600\"", "\U0001F600")]
    public void PatternTextIsKeptAsWritten(string written, string stored)
    {
        var result = Compile(NoAliases, $"patterns:\n  - id: pat-a\n    title: {written.TrimEnd('\n')}\n    summary: {written}\n");

        Assert.Empty(result.Diagnostics);
        Assert.Equal(stored, Patterns(result)[0]!["title"]!.GetValue<string>());
        Assert.Equal(stored, Patterns(result)[0]!["summary"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("patterns:\n  - { id: hash-set, title: A, summary: B }\n", "patterns.yml:2: pattern id \"hash-set\" must start with pat- and is not lowercase letters")]
    [InlineData("patterns:\n  - { id: pat-A, title: A, summary: B }\n", "pattern id \"pat-A\" must start with pat-")]
    [InlineData("patterns:\n  - { id: PAT-a, title: A, summary: B }\n", "pattern id \"PAT-a\" must start with pat-")]
    [InlineData("patterns:\n  - { id: pat-a/b, title: A, summary: B }\n", "pattern id \"pat-a/b\" must start with pat-")]
    [InlineData("patterns:\n  - { id: \"pat-a\\n\", title: A, summary: B }\n", "pattern id \"pat-a\\n\" must start with pat-")]
    [InlineData("patterns:\n  - { id: pat-a, title: A, summary: B }\n  - { id: pat-a, title: C, summary: D }\n", "patterns.yml:3: duplicate id \"pat-a\" (first used at patterns.yml:2)")]
    [InlineData("patterns:\n  - { id: pat-a, title: A, summary: B, extra: C }\n", "unknown key \"extra\"; only id, title, summary are accepted")]
    [InlineData("patterns:\n  - { id: pat-a, title: A }\n", "summary is missing")]
    [InlineData("patterns:\n  - { id: pat-a, summary: B }\n", "title is missing")]
    [InlineData("patterns:\n  - { title: A, summary: B }\n", "id is missing")]
    [InlineData("patterns:\n  - { id: pat-a, title: \"\", summary: B }\n", "title is empty")]
    [InlineData("patterns:\n  - { id: pat-a, title: \"  \\n\\t \", summary: B }\n", "title is empty")]
    [InlineData("patterns:\n  - id: pat-a\n    title:\n    summary: B\n", "patterns.yml:3: title is empty")]
    [InlineData("patterns:\n  - { id: pat-a, title: A, summary: \"\\u2003\" }\n", "summary is empty")]
    [InlineData("patterns:\n  - { id: pat-a, title: \"\\uFEFF\", summary: B }\n", "title is empty")]
    [InlineData("patterns:\n  - { id: pat-a, title: A, summary: \"\\x85\\u2028 \\uFEFF\" }\n", "summary is empty")]
    [InlineData("patterns:\n  - { id: pat-a, title: [A], summary: B }\n", "title must be text")]
    [InlineData("patterns:\n  - { id: pat-a, title: A, summary: { b: c } }\n", "summary must be text")]
    [InlineData("patterns:\n  - { id: [pat-a], title: A, summary: B }\n", "id must be text")]
    [InlineData("patterns:\n  - { id: pat-a, title: \"a\\uFDD1\", summary: B }\n", "title holds a character that cannot be stored")]
    [InlineData("patterns:\n  - { id: pat-a, title: A, summary: \"\\uFDD0\" }\n", "summary holds a character that cannot be stored")]
    [InlineData("patterns:\n  - pat-a\n", "a pattern must be a mapping of id, title and summary")]
    [InlineData("patterns:\n  - [pat-a, A, B]\n", "a pattern must be a mapping of id, title and summary")]
    [InlineData("patterns: {}\n", "patterns must be a list; write [] for none")]
    [InlineData("patterns:\n", "patterns must be a list; write [] for none")]
    [InlineData("{}\n", "patterns is missing")]
    [InlineData("", "the file holds no document")]
    [InlineData("[]\n", "the document must be a mapping")]
    [InlineData("patterns: []\nextra: 1\n", "unknown key \"extra\"; only patterns are accepted")]
    [InlineData("patterns:\n  - &p { id: pat-a, title: A, summary: B }\n", "an anchor (&name) is not accepted")]
    [InlineData("patterns:\n  - { id: pat-a, title: A, summary: B }\n  - { <<: { id: pat-b }, title: A, summary: B }\n", "the merge key (<<) is not accepted")]
    [InlineData("patterns:\n  - { id: pat-a, title: !!str A, summary: B }\n", "a tag (!name) is not accepted")]
    public void PatternOutsideTheClosedShapeIsRefused(string yaml, string expected) =>
        AssertRefused(Compile(NoAliases, yaml), "patterns.yml", expected);

    [Fact]
    public void LoneSurrogateInPatternTextIsRefused()
    {
        var result = Compile(NoAliases, "patterns:\n  - { id: pat-a, title: \"a\\uD800\", summary: B }\n");

        Assert.Empty(result.Files);
        Assert.All(result.Diagnostics, d => Assert.StartsWith("patterns.yml:", d.ToString(), StringComparison.Ordinal));
        Assert.NotEmpty(result.Diagnostics);
    }

    // Pattern ids share the one ID table, so a section may not take a pattern's id, nor an alias retire it.
    [Fact]
    public void PatternIdsJoinTheSiteWideIdTable()
    {
        const string One = "patterns:\n  - { id: pat-a, title: A, summary: B }\n";

        var taken = Compile(NoAliases, One, Part + "\n## Three {#pat-a}\n\nText.\n");
        var retired = Compile("slugs: {}\nids:\n  pat-a: start\n", One);
        var target = Compile("slugs: {}\nids:\n  old: pat-a\n", One);

        AssertRefused(taken, "patterns.yml", "patterns.yml:2: duplicate id \"pat-a\" (first used at chapters/c/part.md:17)");
        AssertRefused(retired, "aliases.yml", "\"pat-a\" is in use, so it cannot be retired");
        AssertRefused(target, "aliases.yml", "\"old\" ends at \"pat-a\", which is not a section id");
    }

    [Fact]
    public void CompiledRegistriesMatchOnlyTheirOwnSchema()
    {
        var result = Compile("slugs:\n  old: test\nids:\n  begin: start\n", "patterns:\n  - { id: pat-a, title: A, summary: B }\n");
        var aliases = Text(result, "aliases.json");
        var patterns = Text(result, "patterns.json");
        var chapter = Text(result, "chapters/c/chapter.json");

        Assert.Null(Repository.Schema.Validate(aliases, RecordKind.Aliases));
        Assert.Null(Repository.Schema.Validate(patterns, RecordKind.Patterns));
        Assert.Null(Repository.Schema.Validate(chapter, RecordKind.Chapter));
        foreach (var kind in Enum.GetValues<RecordKind>())
        {
            Assert.Equal(kind is RecordKind.Aliases, Repository.Schema.Validate(aliases, kind) is null);
            Assert.Equal(kind is RecordKind.Patterns, Repository.Schema.Validate(patterns, kind) is null);
            Assert.Equal(kind is RecordKind.Chapter, Repository.Schema.Validate(chapter, kind) is null);
        }

        Assert.NotNull(Repository.Schema.Validate(aliases));
        Assert.NotNull(Repository.Schema.Validate(patterns));
    }

    [Theory]
    [InlineData("""{"slugs":{},"ids":{}}""", true)]
    [InlineData("""{"slugs":{"old":"test"},"ids":{"begin":"start"}}""", true)]
    [InlineData("""{"slugs":{}}""", false)]
    [InlineData("""{"ids":{}}""", false)]
    [InlineData("""{"slugs":{},"ids":{},"extra":{}}""", false)]
    [InlineData("""{"slugs":[],"ids":{}}""", false)]
    [InlineData("""{"slugs":{"Old":"test"},"ids":{}}""", false)]
    [InlineData("""{"slugs":{"old":"Test"},"ids":{}}""", false)]
    [InlineData("""{"slugs":{"old":"test\n"},"ids":{}}""", false)]
    [InlineData("""{"slugs":{"old\n":"test"},"ids":{}}""", false)]
    [InlineData("""{"slugs":{"old":1},"ids":{}}""", false)]
    [InlineData("""{"slugs":{},"ids":{"a/b1":"start"}}""", false)]
    [InlineData("""{"slugs":{},"ids":{"a":"start/b1"}}""", false)]
    [InlineData("""{"slugs":{},"ids":{"a":"start\n"}}""", false)]
    [InlineData("""{"slugs":{},"ids":{"a":null}}""", false)]
    [InlineData("""{"slugs":{},"ids":{"a":"x","a":"y"}}""", false)]
    public void AliasSchemaIsClosedWithTheSourceGrammarOnBothSides(string json, bool admitted) =>
        Assert.Equal(admitted, Repository.Schema.Validate(json, RecordKind.Aliases) is null);

    [Theory]
    [InlineData("""{"patterns":[]}""", true)]
    [InlineData("""{"patterns":[{"id":"pat-a","title":"A","summary":"one\ntwo\n"}]}""", true)]
    [InlineData("""{}""", false)]
    [InlineData("""{"patterns":{}}""", false)]
    [InlineData("""{"patterns":[],"extra":1}""", false)]
    [InlineData("""{"patterns":[{"id":"a","title":"A","summary":"B"}]}""", false)]
    [InlineData("""{"patterns":[{"id":"pat-A","title":"A","summary":"B"}]}""", false)]
    [InlineData("""{"patterns":[{"id":"x-pat-a","title":"A","summary":"B"}]}""", false)]
    [InlineData("""{"patterns":[{"id":"pat-a","title":"","summary":"B"}]}""", false)]
    [InlineData("""{"patterns":[{"id":"pat-a","title":" \n ","summary":"B"}]}""", false)]
    [InlineData("""{"patterns":[{"id":"pat-a","title":"A"}]}""", false)]
    [InlineData("""{"patterns":[{"id":"pat-a","title":"A","summary":"B","extra":1}]}""", false)]
    [InlineData("""{"patterns":[{"id":"pat-a","title":["A"],"summary":"B"}]}""", false)]
    public void PatternSchemaIsClosed(string json, bool admitted) =>
        Assert.Equal(admitted, Repository.Schema.Validate(json, RecordKind.Patterns) is null);

    private static void AssertRefused(CompileResult result, string file, string expected)
    {
        var lines = result.Diagnostics.Select(d => d.ToString()).ToList();
        Assert.Empty(result.Files);
        Assert.NotEmpty(lines);
        Assert.All(lines, l => Assert.StartsWith(file + ":", l, StringComparison.Ordinal));
        Assert.Contains(lines, l => l.Contains(expected, StringComparison.Ordinal));
    }

    private static JsonNode Aliases(string yaml)
    {
        var result = Compile(yaml, NoPatterns);
        Assert.Empty(result.Diagnostics);
        return JsonNode.Parse(Text(result, "aliases.json"))!;
    }

    private static JsonArray Patterns(CompileResult result) => JsonNode.Parse(Text(result, "patterns.json"))!["patterns"]!.AsArray();

    private static string Text(CompileResult result, string file) =>
        Encoding.UTF8.GetString(result.Files.Single(f => string.Equals(f.RelativePath, file, StringComparison.Ordinal)).Bytes);

    private static CompileResult Compile(string aliases, string patterns, string part = Part)
    {
        using var folder = Tree(aliases, patterns, part);
        return Repository.CompileAsWritten(folder.Path);
    }

    private static TempFolder Tree(string aliases, string patterns, string part = Part)
    {
        var folder = new TempFolder();
        var files = new[] { ("chapters/c/chapter.md", Chapter), ("chapters/c/part.md", part), ("chapters/d/chapter.md", Other), ("aliases.yml", aliases), ("patterns.yml", patterns) };
        foreach (var (path, text) in files)
        {
            var full = Path.Combine(folder.Path, path);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, new UTF8Encoding(false).GetBytes(text));
        }

        return folder;
    }
}
