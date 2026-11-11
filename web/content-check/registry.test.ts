// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, inject, it } from "vitest";
import {
  aliasEndProblems,
  aliasKeyProblems,
  aliasOrderProblems,
  aliasRecord,
  liveNames,
  patternIdProblems,
  patternRecord,
  patternTextProblems,
  shown,
  withPatternIds,
} from "./registry.ts";

// Records come only from the compiler-backed global setup; without them this file fails to
// load, so no record is skipped into a pass.
const records = inject("contentRecords");
if (records.length === 0)
  throw new Error("the global setup provided no content records");

const texts = (kinds: readonly string[]): string[] =>
  records.filter((r) => kinds.includes(r.kind)).map((r) => r.text);
const of = (kind: string) =>
  records.filter((r) => r.kind === kind).map((r) => [r.path, r.text] as const);

// The names the registries are judged against come from the same certified envelope.
const live = liveNames(texts(["chapter", "part"]));
// A pattern id is in use too, so no alias may retire one.
const named = of("patterns").reduce(
  (names, [, text]) => withPatternIds(names, patternRecord(text)),
  live,
);

describe.each(of("aliases"))("the aliases of %s", (_, text) => {
  it("ends every alias at a live name of its kind", () => {
    expect(aliasEndProblems(aliasRecord(text), live)).toEqual([]);
    expect(aliasOrderProblems(aliasRecord(text))).toEqual([]);
  });

  it("retires no name that is in use", () => {
    expect(aliasKeyProblems(aliasRecord(text), named)).toEqual([]);
  });
});

describe.each(of("patterns"))("the patterns of %s", (_, text) => {
  it("lists unique pattern ids in order", () => {
    expect(patternIdProblems(patternRecord(text), live)).toEqual([]);
  });

  it("keeps every title and summary as text with something to show", () => {
    expect(patternTextProblems(patternRecord(text))).toEqual([]);
  });
});

describe("the compiled registries", () => {
  it("are one alias record and one pattern record", () => {
    expect(of("aliases")).toHaveLength(1);
    expect(of("patterns")).toHaveLength(1);
  });

  // An empty registry would pass every case above without proving any of them.
  it("hold aliases into chapter and part files, and patterns", () => {
    const aliases = of("aliases").map(([, text]) => aliasRecord(text));
    const patterns = of("patterns").flatMap(([, text]) => patternRecord(text));
    const partSections = liveNames(texts(["part"])).sectionIds;
    const targets = aliases.flatMap((a) => a.ids.map(([, target]) => target));
    expect(aliases.flatMap((a) => a.slugs.map(([key]) => key))).toEqual(
      expect.arrayContaining(["2", "10", "fixture-old"]),
    );
    expect(targets.some((t) => partSections.has(t))).toBe(true);
    expect(targets.some((t) => !partSections.has(t))).toBe(true);
    expect(aliases.flatMap((a) => a.ids.map(([key]) => key))).toContain(
      "constructor",
    );
    expect(patterns.length).toBeGreaterThan(1);
  });
});

describe("live names", () => {
  const written = (value: unknown): string => JSON.stringify(value);
  const chapter = {
    type: "chapter",
    id: "ch-a",
    slug: "a",
    intro: [{ type: "code", id: "intro-code" }, { type: "paragraph" }],
    sections: [{ id: "start", body: [{ type: "text", id: "start-text" }] }],
  };
  const part = { type: "part", sections: [{ id: "syn-one", body: [] }] };

  it("collects slugs, every id and the section ids", () => {
    const names = liveNames([chapter, part].map(written));
    expect([...names.slugs]).toEqual(["a"]);
    expect([...names.ids].sort()).toEqual([
      "ch-a",
      "intro-code",
      "start",
      "start-text",
      "syn-one",
    ]);
    expect([...names.sectionIds].sort()).toEqual(["start", "syn-one"]);
  });

  it.each([
    ["a record that is not an object", [null]],
    ["a record of another type", [{ type: "aliases", sections: [] }]],
    ["a chapter without a slug", [{ ...chapter, slug: undefined }]],
    ["a chapter without an id", [{ ...chapter, id: 1 }]],
    ["a chapter without an intro", [{ ...chapter, intro: undefined }]],
    ["a record without sections", [{ type: "part" }]],
    ["a section that is not an object", [{ type: "part", sections: [1] }]],
    ["a section without an id", [{ type: "part", sections: [{ body: [] }] }]],
    ["a section without a body", [{ type: "part", sections: [{ id: "a" }] }]],
    [
      "a block that is not an object",
      [{ type: "part", sections: [{ id: "a", body: ["x"] }] }],
    ],
    [
      "a block id that is not text",
      [{ type: "part", sections: [{ id: "a", body: [{ id: 1 }] }] }],
    ],
  ])("refuses %s", (_, docs) => {
    expect(() => liveNames(docs.map(written))).toThrow(/live names refused/u);
  });

  it("takes names an object would trip over, and a negative zero", () => {
    const text =
      '{"type":"part","toString":-0,"valueOf":{"__proto__":0},"sections":[{"id":"constructor","body":[]}]}';
    expect([...liveNames([text]).ids]).toEqual(["constructor"]);
  });

  it.each([
    ["text that is not JSON", '{"type":"part","sections":[]'],
    ["sections written twice", '{"type":"part","sections":[],"sections":[]}'],
    [
      "a chapter id written twice",
      '{"type":"chapter","id":"ch-a","id":"ch-b","slug":"a","intro":[],"sections":[]}',
    ],
    [
      "a section id written twice under an escape",
      '{"type":"part","sections":[{"id":"a","\\u0069d":"b","body":[]}]}',
    ],
    [
      "a block id written twice",
      '{"type":"part","sections":[{"id":"a","body":[{"id":"b","id":"c"}]}]}',
    ],
    [
      "nesting too deep to read",
      `{"type":"part","sections":${"[".repeat(200000)}${"]".repeat(200000)}}`,
    ],
  ])("refuses %s", (_, text) => {
    expect(() => liveNames([text])).toThrow(
      /live names refused: a record is not one value with each name once: /u,
    );
  });
});

describe("the alias checks", () => {
  const names = {
    slugs: new Set(["a", "b"]),
    ids: new Set(["ch-a", "start", "syn-one", "syn-code", "constructor-x"]),
    sectionIds: new Set(["start", "syn-one"]),
  };
  const registry = (slugs: object, ids: object) =>
    aliasRecord(JSON.stringify({ slugs, ids }));
  const json = aliasRecord;

  it("accepts aliases that end at live names of their kind", () => {
    const record = registry(
      { old: "a", older: "a" },
      { begin: "start", constructor: "syn-one", first: "syn-one" },
    );
    expect(aliasEndProblems(record, names)).toEqual([]);
    expect(aliasKeyProblems(record, names)).toEqual([]);
    expect(aliasEndProblems(registry({}, {}), names)).toEqual([]);
  });

  it.each([
    [
      "a chain left unflattened",
      registry({}, { a: "b", b: "start" }),
      "ids: a ends at the alias b",
    ],
    ["a self alias", registry({}, { a: "a" }), "ids: a ends at the alias a"],
    [
      "a dangling id",
      registry({}, { a: "gone" }),
      "ids: a ends at gone, which is not live",
    ],
    [
      "an id that ends at a code block",
      registry({}, { a: "syn-code" }),
      "ids: a ends at syn-code, which is not live",
    ],
    [
      "an id that ends at a chapter id",
      registry({}, { a: "ch-a" }),
      "ids: a ends at ch-a, which is not live",
    ],
    [
      "an id that ends at a slug",
      registry({}, { old: "a" }),
      "ids: old ends at a, which is not live",
    ],
    [
      "a slug that ends at a section",
      registry({ old: "start" }, {}),
      "slugs: old ends at start, which is not live",
    ],
    [
      "a dangling slug",
      registry({ old: "gone" }, {}),
      "slugs: old ends at gone, which is not live",
    ],
    [
      "a target named like an object member",
      registry({}, { a: "toString" }),
      "ids: a ends at toString, which is not live",
    ],
    [
      "a target named constructor",
      registry({}, { a: "constructor" }),
      "ids: a ends at constructor, which is not live",
    ],
    [
      "a prototype key",
      json('{"slugs":{},"ids":{"__proto__":"gone"}}'),
      "ids: __proto__ ends at gone, which is not live",
    ],
  ])("reports %s", (_, record, problem) => {
    expect(aliasEndProblems(record, names)).toContain(problem);
  });

  it("judges digit-only slugs like any other name", () => {
    const record = json('{"slugs":{"10":"a","2":"a"},"ids":{}}');
    expect(aliasEndProblems(record, names)).toEqual([]);
    expect(aliasKeyProblems(record, names)).toEqual([]);
    expect(
      aliasEndProblems(json('{"slugs":{"10":"2","2":"a"},"ids":{}}'), names),
    ).toEqual(["slugs: 10 ends at the alias 2"]);
  });

  it.each([
    ['{"slugs":{},"ids":{}}', []],
    ['{"slugs":{"a":"x","b":"x"},"ids":{"a-c":"x","a0":"x","ab":"x"}}', []],
    // Ordinal order puts "10" before "2"; an object would list them by number.
    ['{"slugs":{"10":"x","1a":"x","2":"x"},"ids":{}}', []],
    ['{"slugs":{"2":"x","10":"x"},"ids":{}}', ["slugs: keys are out of order"]],
    ['{"slugs":{},"ids":{"b":"x","a":"x"}}', ["ids: keys are out of order"]],
    ['{"slugs":{},"ids":{"ab":"x","a-c":"x"}}', ["ids: keys are out of order"]],
    [
      '{"slugs":{"b":"x","a":"x"},"ids":{"b":"x","\\u0061":"x"}}',
      ["slugs: keys are out of order", "ids: keys are out of order"],
    ],
    ['{"ids":{"b":"x","a":"x"},"slugs":{}}', ["ids: keys are out of order"]],
  ])("reads key order from the text of %s", (text, problems) => {
    expect(aliasOrderProblems(aliasRecord(text))).toEqual(problems);
  });

  it("keeps the entries as written, whatever an object would make of them", () => {
    const record = aliasRecord(
      ' {"ids" : {"__proto__":"x","2":"y","10":"\\u007A"}, "slugs":{"\\u0061":"b"}}\n',
    );
    expect(record.ids).toEqual([
      ["__proto__", "x"],
      ["2", "y"],
      ["10", "z"],
    ]);
    expect(record.slugs).toEqual([["a", "b"]]);
    expect(
      aliasRecord('{"slugs":{"toString":"x","valueOf":"y"},"ids":{}}').slugs,
    ).toEqual([
      ["toString", "x"],
      ["valueOf", "y"],
    ]);
    expect(aliasRecord('{"slugs":{"":"\\ud800"},"ids":{}}').slugs).toEqual([
      ["", "\ud800"],
    ]);
  });

  it.each([
    ["nothing", ""],
    ["text that is not JSON", '{"slugs":{},"ids":{}'],
    ["a comment", '{"slugs":{},"ids":{}}//'],
    ["a trailing comma", '{"slugs":{},"ids":{},}'],
    ["an unquoted name", '{slugs:{},"ids":{}}'],
    ["single quotes", "{'slugs':{},\"ids\":{}}"],
    ["two values", '{"slugs":{},"ids":{}}{"slugs":{},"ids":{}}'],
    ["null", "null"],
    ["a list", "[]"],
    ["a record without ids", '{"slugs":{}}'],
    ["a record without slugs", '{"ids":{}}'],
    ["slugs as a list", '{"slugs":[],"ids":{}}'],
    ["ids as text", '{"slugs":{},"ids":""}'],
    ["a third map", '{"slugs":{},"ids":{},"more":{}}'],
    ["a third name that is not a map", '{"slugs":{},"ids":{},"more":0}'],
    ["a third name that is a list", '{"slugs":{},"ids":{},"more":[]}'],
    [
      "a repeated map that hides keys out of order",
      '{"slugs":{"2":"x","10":"x"},"ids":{},"slugs":{}}',
    ],
    ["a repeated map of another kind", '{"slugs":{},"ids":{},"slugs":[]}'],
    ["a map repeated under an escape", '{"slugs":{},"ids":{},"\\u0069ds":{}}'],
    ["a repeated key", '{"slugs":{},"ids":{"a":"x","a":"y"}}'],
    [
      "a key repeated under an escape",
      '{"slugs":{},"ids":{"a":"x","\\u0061":"x"}}',
    ],
    [
      "a repeated prototype key",
      '{"slugs":{"__proto__":"x","__proto__":"x"},"ids":{}}',
    ],
    ["a target that is not text", '{"slugs":{},"ids":{"a":1}}'],
    ["a target that is a map", '{"slugs":{},"ids":{"a":{}}}'],
    ["a pattern registry", '{"patterns":[]}'],
  ])("refuses %s as an alias registry", (_, text) => {
    expect(() => aliasRecord(text)).toThrow(/not an alias registry: /u);
  });

  it("refuses nesting too deep to read instead of reading part of it", () => {
    const deep = `{"slugs":{},"ids":{"a":${"[".repeat(200000)}${"]".repeat(200000)}}}`;
    expect(() => aliasRecord(deep)).toThrow(/not an alias registry: /u);
  });

  it("counts pattern ids among the names in use", () => {
    const patterns = patternRecord(
      '{"patterns":[{"id":"pat-one","title":"T","summary":"S"}]}',
    );
    const record = registry({}, { "pat-one": "start" });
    expect(aliasKeyProblems(record, names)).toEqual([]);
    const all = withPatternIds(names, patterns);
    expect(aliasKeyProblems(record, all)).toEqual(["ids: pat-one is in use"]);
    expect(all.sectionIds).toBe(names.sectionIds);
    expect(names.ids.has("pat-one")).toBe(false);
  });

  it.each([
    [
      "a live section id",
      registry({}, { start: "syn-one" }),
      "ids: start is in use",
    ],
    [
      "a live code block id",
      registry({}, { "syn-code": "start" }),
      "ids: syn-code is in use",
    ],
    [
      "a live chapter id",
      registry({}, { "ch-a": "start" }),
      "ids: ch-a is in use",
    ],
    ["a live slug", registry({ a: "b" }, {}), "slugs: a is in use"],
  ])("reports %s as a retired name", (_, record, problem) => {
    expect(aliasKeyProblems(record, names)).toEqual([problem]);
  });

  it("keeps the two kinds of name apart", () => {
    const record = registry({ start: "a" }, { a: "start" });
    expect(aliasKeyProblems(record, names)).toEqual([]);
    expect(aliasEndProblems(record, names)).toEqual([]);
  });
});

describe("the pattern checks", () => {
  const names = {
    slugs: new Set<string>(),
    ids: new Set(["start", "pat-taken"]),
    sectionIds: new Set(["start"]),
  };
  const pattern = (
    id: unknown,
    title: unknown = "T",
    summary: unknown = "S",
  ) => ({
    id,
    title,
    summary,
  });
  const registry = (...patterns: unknown[]) =>
    patternRecord(JSON.stringify({ patterns }));

  it("accepts ordered pat- ids and any text that shows something", () => {
    const record = registry(
      pattern("pat-a", "**kept** as written", "one\ntwo\n"),
      pattern("pat-b"),
    );
    expect(patternIdProblems(record, names)).toEqual([]);
    expect(patternTextProblems(record)).toEqual([]);
    expect(patternIdProblems(registry(), names)).toEqual([]);
  });

  it.each([
    [
      "an id without the prefix",
      registry(pattern("a")),
      "pattern 1: the id is not a pat- name",
    ],
    [
      "a repeated id",
      registry(pattern("pat-a"), pattern("pat-a")),
      "pattern ids are repeated or out of order",
    ],
    [
      "ids out of order",
      registry(pattern("pat-b"), pattern("pat-a")),
      "pattern ids are repeated or out of order",
    ],
    [
      "an id already in use",
      registry(pattern("pat-taken")),
      "pat-taken: the id is in use",
    ],
  ])("reports %s", (_, record, problem) => {
    expect(patternIdProblems(record, names)).toEqual([problem]);
  });

  it.each([
    [
      "an empty title",
      registry(pattern("pat-a", "")),
      "pattern 1: title shows nothing",
    ],
    [
      "a blank title",
      registry(pattern("pat-a", " \n\t")),
      "pattern 1: title shows nothing",
    ],
    [
      "a title of blanks from either runtime's list",
      registry(pattern("pat-a", "\u0085\u00a0\u2028\ufeff")),
      "pattern 1: title shows nothing",
    ],
    [
      "a blank summary in the second",
      registry(pattern("pat-a"), pattern("pat-b", "T", " ")),
      "pattern 2: summary shows nothing",
    ],
  ])("reports %s", (_, record, problem) => {
    expect(patternTextProblems(record)).toEqual([problem]);
  });

  it("takes text that mixes blanks with something shown", () => {
    const record = registry(
      pattern("pat-a", "\ufeffT", " \u200b "),
      pattern("pat-b", "\ud83d\ude00", "\ud800"),
    );
    expect(patternTextProblems(record)).toEqual([]);
  });

  // The compiler's tests hold the same sweep against the same schema line.
  it("agrees with the schema on every code unit", () => {
    const schema = JSON.parse(
      readFileSync(
        join(
          dirname(dirname(import.meta.dirname)),
          "content",
          "schema",
          "patterns.schema.json",
        ),
        "utf8",
      ),
    ) as { definitions: { plainText: { pattern: string } } };
    const stated = new RegExp(schema.definitions.plainText.pattern, "u");
    const blank: number[] = [];
    const differs: number[] = [];
    for (let unit = 0; unit < 0x10000; unit++) {
      const text = String.fromCharCode(unit);
      const shows = shown.test(text);
      if (stated.test(text) !== shows) differs.push(unit);
      if (!shows) blank.push(unit);
    }
    expect(differs).toEqual([]);
    expect(blank).toEqual([
      0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
      0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028,
      0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    ]);
    expect(shown.test("")).toBe(false);
    expect(stated.test("")).toBe(false);
  });

  const one = '{"id":"pat-a","title":"T","summary":"S"}';
  it("keeps the patterns as written", () => {
    expect(patternRecord(`{"patterns":[${one}]}`)).toEqual([
      { id: "pat-a", title: "T", summary: "S" },
    ]);
    expect(patternRecord('{"patterns":[]}')).toEqual([]);
  });

  it.each([
    ["nothing", ""],
    ["null", "null"],
    ["a record without patterns", "{}"],
    ["patterns as an object", '{"patterns":{}}'],
    ["a pattern that is not an object", '{"patterns":["pat-a"]}'],
    ["a second name", `{"patterns":[${one}],"more":[]}`],
    ["a repeated list", `{"patterns":[],"patterns":[${one}]}`],
    [
      "an id that is not text",
      '{"patterns":[{"id":1,"title":"T","summary":"S"}]}',
    ],
    ["a missing id", '{"patterns":[{"title":"T","summary":"S"}]}'],
    [
      "a title that is not text",
      '{"patterns":[{"id":"pat-a","title":["T"],"summary":"S"}]}',
    ],
    ["a missing summary", '{"patterns":[{"id":"pat-a","title":"T"}]}'],
    [
      "an unknown field",
      '{"patterns":[{"id":"pat-a","title":"T","summary":"S","more":1}]}',
    ],
    [
      "a repeated id",
      '{"patterns":[{"id":"pat-a","id":"pat-b","title":"T","summary":"S"}]}',
    ],
    [
      "a field repeated under an escape",
      '{"patterns":[{"id":"pat-a","\\u0069d":"pat-b","title":"T","summary":"S"}]}',
    ],
    ["an alias registry", '{"slugs":{},"ids":{}}'],
  ])("refuses %s as a pattern registry", (_, text) => {
    expect(() => patternRecord(text)).toThrow(/not a pattern registry: /u);
  });
});
