import ts from "typescript";

/** Every kind a compiled record can be, as the compiler's manifest names it. */
export const recordKinds = [
  "chapter",
  "part",
  "aliases",
  "patterns",
  "glossary",
  "error",
  "hints-catalogue",
] as const;
export type RecordKind = (typeof recordKinds)[number];

const isKind = (value: unknown): value is RecordKind =>
  recordKinds.some((kind) => kind === value);

/** Every kind a part can be; the compiler states it beside the record kind. */
export const partKinds = [
  "syntax",
  "build",
  "idioms",
  "gotchas",
  "library",
  "cards",
  "drill",
  "hints",
] as const;
export type PartKind = (typeof partKinds)[number];

const isPartKind = (value: unknown): value is PartKind =>
  partKinds.some((kind) => kind === value);

/** A record's identity: its kind and, for a part alone, its part kind. */
export interface RecordIdentity {
  readonly kind: RecordKind;
  readonly part: PartKind | null;
}

export interface ContentRecord extends RecordIdentity {
  readonly path: string;
  readonly text: string;
}

// The part kind a payload states for itself, or null when it is no object stating one.
function statedPartKind(payload: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  return isObject(parsed) ? parsed["kind"] : null;
}

declare module "vitest" {
  export interface ProvidedContext {
    contentRecords: readonly ContentRecord[];
  }
}

// A web-relative compiled payload path: forward slashes, no dot segments, never the manifest.
const recordPath =
  /^compiled\/(?:[a-z0-9][a-z0-9.-]*\/)*[a-z0-9][a-z0-9.-]*\.json$/u;
const manifestPath = "compiled/manifest.json";

const fail = (reason: string): never => {
  throw new Error(`test-records envelope refused: ${reason}`);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);

// JSON.parse keeps the last of two equal keys, so the parse tree is checked for repeats first.
function duplicateKey(text: string): string | null {
  const file = ts.parseJsonText("envelope.json", text);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set<string>();
      for (const property of node.properties) {
        // Strict JSON already passed, so every key is a string literal; text is its decoded value.
        if (!ts.isPropertyAssignment(property)) continue;
        if (!ts.isStringLiteral(property.name)) continue;
        const name = property.name.text;
        if (seen.has(name)) found = name;
        seen.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/**
 * Accepts the compiler's test-records output exactly as the transport contract states, or
 * throws: a nonzero exit discards stdout whatever it holds, and the record paths must be exactly
 * the expected set, so a dropped, added or renamed record is refused.
 */
export function acceptEnvelope(
  stdout: Uint8Array,
  exit: number | null,
  expected: readonly string[],
): readonly ContentRecord[] {
  if (exit !== 0) fail(`exit ${String(exit)}; stdout discarded`);
  if (stdout[0] === 0xef && stdout[1] === 0xbb && stdout[2] === 0xbf)
    fail("stdout starts with a byte-order mark");
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      stdout,
    );
  } catch {
    fail("stdout is not valid UTF-8");
  }
  // JSON.parse admits surrounding whitespace, and the protocol has none.
  if (!text.startsWith("{") || !text.endsWith("}"))
    fail("stdout is not exactly one JSON object");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`stdout is not one complete JSON document (${String(error)})`);
  }
  const repeated = duplicateKey(text);
  if (repeated !== null) fail(`key ${repeated} is repeated`);
  if (!isObject(parsed) || !hasExactKeys(parsed, ["version", "records"]))
    return fail("the envelope must hold exactly version and records");
  const { version, records } = parsed;
  if (version !== 3) fail("the envelope version must be 3");
  if (!Array.isArray(records) || records.length === 0)
    return fail("records must be a non-empty array");
  const accepted: ContentRecord[] = [];
  for (const record of records) {
    // Only a part states a part kind, so a part kind on any other record is an extra key.
    const keys =
      isObject(record) && record["kind"] === "part"
        ? ["path", "kind", "part", "text"]
        : ["path", "kind", "text"];
    if (!isObject(record) || !hasExactKeys(record, keys))
      return fail(
        "each record must hold exactly path, kind and text, and a part its part kind after kind",
      );
    const { path, kind, text: payload } = record;
    const part = record["part"];
    if (typeof path !== "string" || typeof payload !== "string")
      return fail("path and text must be strings");
    if (!isKind(kind))
      return fail(`record kind ${JSON.stringify(kind)} is not a known kind`);
    if (path === manifestPath) fail("the manifest is not a record");
    if (!recordPath.test(path) || path.split("/").some((s) => /^\.+$/u.test(s)))
      fail(
        `record path ${JSON.stringify(path)} is not a compiled payload path`,
      );
    const previous = accepted.at(-1);
    // Ordinal order is UTF-16 code-unit order, which is how JavaScript compares strings.
    if (previous !== undefined && !(previous.path < path))
      fail(
        previous.path === path
          ? `record path ${path} is repeated`
          : `record path ${path} is out of ordinal order`,
      );
    if (kind !== "part") {
      accepted.push({ path, kind, part: null, text: payload });
      continue;
    }
    if (!isPartKind(part))
      return fail(`part kind ${JSON.stringify(part)} is not a known kind`);
    if (statedPartKind(payload) !== part)
      fail(`${path} is certified as a ${part} part and states another kind`);
    accepted.push({ path, kind, part, text: payload });
  }
  const wanted = [...expected].sort();
  if (
    accepted.length !== wanted.length ||
    accepted.some((r, i) => r.path !== wanted[i])
  )
    fail(
      `records are not exactly the ${String(wanted.length)} compiled payload files`,
    );
  return accepted;
}
