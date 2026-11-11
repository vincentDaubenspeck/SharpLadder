import ts from "typescript";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fail(reason: string): never {
  throw new Error(`live names refused: ${reason}`);
}

const text = (value: unknown, what: string): string =>
  typeof value === "string" ? value : fail(`${what} is not text`);

const list = (value: unknown, what: string): unknown[] =>
  Array.isArray(value) ? (value as unknown[]) : fail(`${what} is not a list`);

// A record as its text has it. An object built from the text alone would list digit-only names
// by number and keep only the last of a repeated name, so every check here starts from this.
type Entries = readonly (readonly [string, Written])[];
type Written =
  | { readonly kind: "object"; readonly entries: Entries }
  | { readonly kind: "list"; readonly items: readonly Written[] }
  | { readonly kind: "value"; readonly value: unknown };

const plain = (written: Written): unknown =>
  written.kind === "value"
    ? written.value
    : written.kind === "list"
      ? written.items.map(plain)
      : Object.fromEntries(written.entries.map(([k, v]) => [k, plain(v)]));

// JSON.parse decides what is JSON and what every token means; the syntax tree supplies only the
// order and the repeats that parsing loses.
function written(source: string): Written {
  const whole: unknown = JSON.parse(source);
  const file = ts.parseJsonText("record.json", source);
  const token = (node: ts.Node): unknown => JSON.parse(node.getText(file));
  const walk = (node: ts.Node): Written => {
    if (ts.isArrayLiteralExpression(node))
      return { kind: "list", items: node.elements.map(walk) };
    if (!ts.isObjectLiteralExpression(node))
      return { kind: "value", value: token(node) };
    const names = new Set<string>();
    const entries = node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property))
        throw new Error("an entry is not a name and a value");
      const name = token(property.name);
      if (typeof name !== "string") throw new Error("a name is not text");
      if (names.has(name))
        throw new Error(`the name ${JSON.stringify(name)} is repeated`);
      names.add(name);
      return [name, walk(property.initializer)] as const;
    });
    return { kind: "object", entries };
  };
  const [statement, ...more] = file.statements;
  if (statement === undefined || more.length > 0)
    throw new Error("the text is not one value");
  const tree = walk(statement.expression);
  // Fails closed if the two readers ever disagree about what the text holds.
  if (JSON.stringify(plain(tree)) !== JSON.stringify(whole))
    throw new Error("the text reads two ways");
  return tree;
}

/** The names in use across the chapter and part records of one compiled set. */
export interface LiveNames {
  readonly slugs: ReadonlySet<string>;
  readonly ids: ReadonlySet<string>;
  readonly sectionIds: ReadonlySet<string>;
}

/**
 * Collects the live names from the text of chapter and part records: chapter slugs, every ID a
 * record declares, and the IDs that are sections. A record of any other shape, or one that
 * writes a name twice, throws, so a name can never go missing quietly and make a retired one
 * look free.
 */
export function liveNames(sources: readonly string[]): LiveNames {
  const slugs = new Set<string>();
  const ids = new Set<string>();
  const sectionIds = new Set<string>();
  const blocks = (body: unknown, what: string): void => {
    for (const block of list(body, what)) {
      if (!isObject(block)) fail(`${what} holds a block that is not an object`);
      if (block["id"] !== undefined) ids.add(text(block["id"], "a block id"));
    }
  };
  for (const source of sources) {
    let doc: unknown;
    try {
      doc = plain(written(source));
    } catch (reason) {
      const why = reason instanceof Error ? reason.message : String(reason);
      fail(`a record is not one value with each name once: ${why}`);
    }
    if (!isObject(doc)) fail("a record is not an object");
    if (doc["type"] === "chapter") {
      slugs.add(text(doc["slug"], "a chapter slug"));
      ids.add(text(doc["id"], "a chapter id"));
      blocks(doc["intro"], "an intro");
    } else if (doc["type"] !== "part")
      fail("a record is not a chapter or part");
    for (const section of list(doc["sections"], "sections")) {
      if (!isObject(section)) fail("a section is not an object");
      const id = text(section["id"], "a section id");
      ids.add(id);
      sectionIds.add(id);
      blocks(section["body"], "a section body");
    }
  }
  return { slugs, ids, sectionIds };
}

// The entries of an object that holds exactly the given names, in any order, each once.
function closed(
  node: Written,
  names: readonly string[],
  what: string,
): Map<string, Written> {
  if (node.kind !== "object") throw new Error(`${what} is not an object`);
  const found = new Map(node.entries);
  const stray = [...found.keys()].find((name) => !names.includes(name));
  if (stray !== undefined)
    throw new Error(`${what} holds the unknown name ${JSON.stringify(stray)}`);
  const missing = names.find((name) => !found.has(name));
  if (missing !== undefined) throw new Error(`${what} lacks ${missing}`);
  return found;
}

const stated = (node: Written | undefined, what: string): string => {
  if (node?.kind !== "value" || typeof node.value !== "string")
    throw new Error(`${what} is not text`);
  return node.value;
};

function refused(what: string, reason: unknown): never {
  const why = reason instanceof Error ? reason.message : String(reason);
  throw new Error(`the record is not ${what}: ${why}`);
}

type Aliases = readonly (readonly [string, string])[];

/** An alias registry exactly as written: both maps, entries in the order of the text. */
export interface AliasRecord {
  readonly slugs: Aliases;
  readonly ids: Aliases;
}

/**
 * Reads the text of an alias registry: one object holding slugs and ids, each once, each a map
 * from text to text with no name repeated. Anything else throws. Whether a name or a target is
 * well formed is the schema's finding, not this reader's.
 */
export function aliasRecord(source: string): AliasRecord {
  try {
    const root = closed(written(source), ["slugs", "ids"], "the record");
    const map = (name: string): Aliases => {
      const node = root.get(name);
      if (node?.kind !== "object") throw new Error(`${name} is not a map`);
      return node.entries.map(
        ([key, target]) => [key, stated(target, `${name}: ${key}`)] as const,
      );
    };
    return { slugs: map("slugs"), ids: map("ids") };
  } catch (reason) {
    refused("an alias registry", reason);
  }
}

/** One pattern exactly as written. */
export interface PatternEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

/**
 * Reads the text of a pattern registry: one object holding only patterns, a list of objects that
 * each hold an id, a title and a summary as text, each once. Anything else throws.
 */
export function patternRecord(source: string): readonly PatternEntry[] {
  try {
    const node = closed(written(source), ["patterns"], "the record").get(
      "patterns",
    );
    if (node?.kind !== "list") throw new Error("patterns is not a list");
    return node.items.map((item, index) => {
      const what = `pattern ${String(index + 1)}`;
      const entry = closed(item, ["id", "title", "summary"], what);
      const field = (name: string): string =>
        stated(entry.get(name), `${what}: ${name}`);
      return {
        id: field("id"),
        title: field("title"),
        summary: field("summary"),
      };
    });
  } catch (reason) {
    refused("a pattern registry", reason);
  }
}

// JavaScript compares strings by UTF-16 code unit, which is the ordinal order the compiler writes.
const ordered = (names: readonly string[]): boolean =>
  names.every((name, i) => i === 0 || (names[i - 1] ?? "") < name);

const spaces = (
  record: AliasRecord,
  live: LiveNames,
): [string, Aliases, ReadonlySet<string>, ReadonlySet<string>][] => [
  ["slugs", record.slugs, live.slugs, live.slugs],
  ["ids", record.ids, live.ids, live.sectionIds],
];

/**
 * What an alias registry fails to prove about where its aliases end: every key maps in one step
 * to a live name of its own kind (a slug to a chapter slug, an id to a section id), never to
 * another alias.
 */
export function aliasEndProblems(
  record: AliasRecord,
  live: LiveNames,
): string[] {
  const problems: string[] = [];
  for (const [name, map, , ends] of spaces(record, live)) {
    const keys = new Set(map.map(([key]) => key));
    for (const [key, target] of map) {
      if (keys.has(target))
        problems.push(`${name}: ${key} ends at the alias ${target}`);
      else if (!ends.has(target))
        problems.push(`${name}: ${key} ends at ${target}, which is not live`);
    }
  }
  return problems;
}

/** The alias maps whose keys are not written in ordinal order. */
export function aliasOrderProblems(record: AliasRecord): string[] {
  return [["slugs", record.slugs] as const, ["ids", record.ids] as const]
    .filter(([, map]) => !ordered(map.map(([key]) => key)))
    .map(([name]) => `${name}: keys are out of order`);
}

/** The live names with a pattern registry's ids counted among the ids in use. */
export function withPatternIds(
  live: LiveNames,
  patterns: readonly PatternEntry[],
): LiveNames {
  return { ...live, ids: new Set([...live.ids, ...patterns.map((p) => p.id)]) };
}

/** The alias keys that name something still in use, which may never be retired. */
export function aliasKeyProblems(
  record: AliasRecord,
  live: LiveNames,
): string[] {
  return spaces(record, live).flatMap(([name, map, inUse]) =>
    map
      .filter(([key]) => inUse.has(key))
      .map(([key]) => `${name}: ${key} is in use`),
  );
}

/** What a pattern registry fails to prove about its ids: pat- names, unique, in order, unused. */
export function patternIdProblems(
  patterns: readonly PatternEntry[],
  live: LiveNames,
): string[] {
  const problems: string[] = [];
  const ids: string[] = [];
  for (const [index, { id }] of patterns.entries()) {
    if (!id.startsWith("pat-"))
      problems.push(`pattern ${String(index + 1)}: the id is not a pat- name`);
    else if (live.ids.has(id)) problems.push(`${id}: the id is in use`);
    else ids.push(id);
  }
  if (!ordered(ids)) problems.push("pattern ids are repeated or out of order");
  return problems;
}

/**
 * Matches text that shows something: at least one character outside the blank list. The list is
 * written out, as it is in the schema and the compiler, because the white-space shorthand of a
 * regular expression names a different set in each runtime.
 */
export const shown =
  // eslint-disable-next-line no-control-regex -- the blank list names tab and the line breaks.
  /[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/u;

/** The pattern titles and summaries that have nothing to show. */
export function patternTextProblems(
  patterns: readonly PatternEntry[],
): string[] {
  return patterns.flatMap((entry, index) =>
    (["title", "summary"] as const)
      .filter((field) => !shown.test(entry[field]))
      .map((field) => `pattern ${String(index + 1)}: ${field} shows nothing`),
  );
}
