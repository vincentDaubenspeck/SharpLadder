// Node half of the rendered-font evidence: build record, served-byte hashes, system faces, baselines.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const web = join(import.meta.dirname, "..");

/** One shipped face as the asset inventory records it. */
export interface Face {
  family: string;
  distPath: string;
  sha256: string;
  byteLength: number;
  weight: [number, number];
  style: string;
  stretch: [number, number];
  coverage: [number, number][];
}
export type Role = "ui" | "display" | "code";
interface Expected {
  kind: "shipped" | "system";
  family: string;
}
export interface Environment {
  name: string;
  testOnly: boolean;
  drop: string[];
  expect: Record<Role, Expected>;
}
/**
 * What determines a role's rendering, and so selects its reviewed baseline: host platform and
 * architecture, pinned engine build, project profile, font environment, role, face and its bytes
 * (for a system face, the installed file's hash), witness texts and the font settings applied.
 */
export interface BaselineIdentity {
  platform: string;
  arch: string;
  engine: string;
  engineVersion: string;
  project: string;
  environment: string;
  role: Role;
  face: string;
  faceSha256: string;
  witness: string;
  glyphText: string;
  size: string;
  glyphSize: string;
  weight: string;
  style: string;
  stretch: string;
  featureSettings: string;
  variationSettings: string;
  opticalSizing: string;
  ligatures: string;
}
/** What a reviewed run observed; drift is reported for review and never fails on its own. */
export interface BaselineEvidence {
  os: string;
  signature: number[];
  platformFonts: string[] | null;
  glyphSha256: string;
}
export interface Baseline {
  identity: BaselineIdentity;
  evidence: BaselineEvidence;
}
interface Drift {
  field: keyof BaselineEvidence;
  reviewed: unknown;
  observed: unknown;
}
export type Review =
  | { known: true; drift: Drift[] }
  | { known: false; nearest: (keyof BaselineIdentity)[][] };

const identityFields: (keyof BaselineIdentity)[] = [
  "platform",
  "arch",
  "engine",
  "engineVersion",
  "project",
  "environment",
  "role",
  "face",
  "faceSha256",
  "witness",
  "glyphText",
  "size",
  "glyphSize",
  "weight",
  "style",
  "stretch",
  "featureSettings",
  "variationSettings",
  "opticalSizing",
  "ligatures",
];
const evidenceFields: (keyof BaselineEvidence)[] = [
  "os",
  "signature",
  "platformFonts",
  "glyphSha256",
];
const roleSet = new Set<string>(["ui", "display", "code"]);
const hex64 = /^[0-9a-f]{64}$/;

interface InventoryFile {
  distPath: string;
  sha256: string;
  byteLength: number;
  coverage: string[];
  face?: {
    format?: string;
    familyAlias?: unknown;
    weightRange: [number, number];
    style: string;
    stretch: number | [number, number];
  };
}
interface Inventory {
  assets: {
    id: string;
    shipped?: boolean;
    distributedFiles?: InventoryFile[];
  }[];
}

/** Hex SHA-256 of a byte array. */
export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Base64 of a byte array, so served bytes can cross into the page unchanged. */
export const base64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

const range = (entry: string): [number, number] => {
  const match = /^U\+([0-9A-F]{4,6})(?:-([0-9A-F]{4,6}))?$/.exec(entry);
  if (match === null)
    throw new Error(
      `font record: coverage entry ${entry} is not U+XXXX[-XXXX]`,
    );
  const low = Number.parseInt(match[1] ?? "", 16);
  const high = Number.parseInt(match[2] ?? match[1] ?? "", 16);
  if (high < low) throw new Error(`font record: coverage ${entry} is reversed`);
  return [low, high];
};

/**
 * Every shipped face from the committed asset inventory, the record the build's own admission
 * checks against; a shipped asset without exactly one woff2 face, or a repeated family, fails.
 */
export function shippedFaces(
  inventory: Inventory = JSON.parse(
    readFileSync(
      join(web, "assets", "licences", "asset-inventory.json"),
      "utf8",
    ),
  ) as Inventory,
): Face[] {
  const faces: Face[] = [];
  for (const asset of inventory.assets) {
    if (asset.shipped !== true) continue;
    const files = asset.distributedFiles ?? [];
    if (files.length !== 1)
      throw new Error(`font record: ${asset.id} must ship exactly one file`);
    const [file] = files;
    const face = file?.face;
    if (
      file === undefined ||
      face?.format !== "woff2" ||
      typeof face.familyAlias !== "string"
    )
      throw new Error(`font record: ${asset.id} has no woff2 face`);
    const family = face.familyAlias;
    if (faces.some((known) => known.family === family))
      throw new Error(`font record: family ${family} repeats`);
    faces.push({
      family,
      distPath: file.distPath,
      sha256: file.sha256,
      byteLength: file.byteLength,
      weight: face.weightRange,
      style: face.style,
      stretch: Array.isArray(face.stretch)
        ? face.stretch
        : [face.stretch, face.stretch],
      coverage: file.coverage.map(range),
    });
  }
  if (faces.length === 0) throw new Error("font record: no shipped face");
  return faces;
}

/** Whether a face's recorded coverage contains a code point. */
export const covers = (face: Face, codePoint: number): boolean =>
  face.coverage.some(([low, high]) => codePoint >= low && codePoint <= high);

/** The served bytes must be the recorded bytes; anything else is refused before it is used. */
export function authenticate(face: Face, bytes: Uint8Array): string {
  const actual = sha256(bytes);
  if (bytes.length !== face.byteLength || actual !== face.sha256)
    throw new Error(
      `font bytes for ${face.family}: ${String(bytes.length)} B ${actual}, record ${String(face.byteLength)} B ${face.sha256}`,
    );
  return actual;
}

// The Windows reference faces are named instances of one installed variable file.
const windowsSystem = ["Segoe UI Variable Text", "Segoe UI Variable Display"];

/**
 * The font environments of a platform (brief section 4.1). An environment names the face each
 * role must render and the families its test-only stack drops; an unknown platform fails.
 */
export function environments(
  platform: string = process.platform,
): Environment[] {
  const shipped: Record<Role, string> = {
    ui: "Noto Sans",
    display: "Noto Sans Display",
    code: "SL Code",
  };
  const asShipped = (
    families: Record<Role, string>,
  ): Record<Role, Expected> => ({
    ui: { kind: "shipped", family: families.ui },
    display: { kind: "shipped", family: families.display },
    code: { kind: "shipped", family: families.code },
  });
  if (platform === "linux")
    return [
      {
        name: "linux-shipped",
        testOnly: false,
        drop: [],
        expect: asShipped(shipped),
      },
    ];
  if (platform === "win32")
    return [
      {
        name: "windows-reference",
        testOnly: false,
        drop: [],
        expect: {
          ui: { kind: "system", family: "Segoe UI Variable Text" },
          display: { kind: "system", family: "Segoe UI Variable Display" },
          code: { kind: "shipped", family: "SL Code" },
        },
      },
      {
        name: "windows-fallback",
        testOnly: true,
        drop: windowsSystem,
        expect: asShipped(shipped),
      },
    ];
  throw new Error(
    `font environments: no environment is defined for ${platform}`,
  );
}

/** Installed system families a platform's stacks name, measured as candidates. */
export const systemFamilies = (
  platform: string = process.platform,
): string[] => (platform === "win32" ? windowsSystem : []);

/**
 * The identity of the installed Windows reference face: the hash of its file. An absent file
 * fails the reference environment instead of letting it become the fallback.
 */
export function systemFace(
  file: string = join(
    process.env["WINDIR"] ?? "C:\\Windows",
    "Fonts",
    "SegUIVar.ttf",
  ),
): string {
  if (!existsSync(file))
    throw new Error(`reference environment: installed face ${file} is absent`);
  return sha256(readFileSync(file));
}

/** The operating system or image identity a baseline belongs to: the Linux distribution, or the Windows build. */
function osIdentity(platform: string): string {
  if (platform !== "linux") return `${platform} ${release()}`;
  const fields = Object.fromEntries(
    readFileSync("/etc/os-release", "utf8")
      .split("\n")
      .map((line) => /^([A-Z_]+)=(?:"([^"]*)"|(.*))$/u.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2] ?? match[3]]),
  ) as Record<string, string | undefined>;
  return `${fields["ID"] ?? "unknown"} ${fields["VERSION_ID"] ?? "unknown"}`;
}

/** The host the evidence was measured on. */
export const host = (): {
  platform: string;
  arch: string;
  release: string;
  os: string;
} => ({
  platform: process.platform,
  arch: process.arch,
  release: release(),
  os: osIdentity(process.platform),
});

// Keys are sorted so the same measurements always give the same bytes.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;

/** Writes one evidence record as canonical JSON and returns the text. */
export function writeEvidence(path: string, record: unknown): string {
  const text = `${JSON.stringify(canonical(record), null, 2)}\n`;
  writeFileSync(path, text);
  return text;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function exactKeys(value: unknown, keys: string[], where: string) {
  if (!isRecord(value))
    throw new Error(`font baselines: ${where} is not an object`);
  const actual = Object.keys(value);
  for (const key of keys)
    if (!actual.includes(key))
      throw new Error(`font baselines: ${where} lacks ${key}`);
  for (const key of actual)
    if (!keys.includes(key))
      throw new Error(`font baselines: ${where} has unknown key ${key}`);
  return value;
}

const text = (value: unknown, where: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`font baselines: ${where} is blank or not a string`);
  return value;
};

const hash = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !hex64.test(value))
    throw new Error(`font baselines: ${where} is not a lowercase SHA-256`);
  return value;
};

/** One line per identity, in field order, so two entries for one identity compare equal. */
const identityKey = (identity: BaselineIdentity): string =>
  JSON.stringify(identityFields.map((field) => identity[field]));

/**
 * Checks the reviewed baseline file's shape and returns its entries; an unknown or missing key,
 * a wrong type or two entries for one identity fail the whole file.
 */
export function parseBaselines(source: string): Baseline[] {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (error) {
    throw new Error(`font baselines: not JSON (${String(error)})`, {
      cause: error,
    });
  }
  const file = exactKeys(data, ["entries"], "the file");
  if (!Array.isArray(file["entries"]))
    throw new Error("font baselines: entries is not an array");
  const seen = new Set<string>();
  return file["entries"].map((raw: unknown, i) => {
    const where = `entry ${String(i)}`;
    const entry = exactKeys(raw, ["identity", "evidence"], where);
    const id = exactKeys(
      entry["identity"],
      identityFields,
      `${where} identity`,
    );
    const ev = exactKeys(
      entry["evidence"],
      evidenceFields,
      `${where} evidence`,
    );
    for (const field of identityFields)
      if (field === "faceSha256") hash(id[field], `${where} faceSha256`);
      else text(id[field], `${where} ${field}`);
    if (!roleSet.has(String(id["role"])))
      throw new Error(
        `font baselines: ${where} role is not ui, display or code`,
      );
    text(ev["os"], `${where} os`);
    hash(ev["glyphSha256"], `${where} glyphSha256`);
    const signature = ev["signature"];
    if (
      !Array.isArray(signature) ||
      signature.length === 0 ||
      !signature.every(
        (w) => typeof w === "number" && Number.isFinite(w) && w > 0,
      )
    )
      throw new Error(
        `font baselines: ${where} signature is not positive advances`,
      );
    const fonts = ev["platformFonts"];
    if (
      fonts !== null &&
      !(Array.isArray(fonts) && fonts.every((f) => typeof f === "string"))
    )
      throw new Error(
        `font baselines: ${where} platformFonts is not null or strings`,
      );
    const baseline = entry as unknown as Baseline;
    const key = identityKey(baseline.identity);
    if (seen.has(key))
      throw new Error(`font baselines: ${where} repeats identity ${key}`);
    seen.add(key);
    return baseline;
  });
}

/**
 * The baseline file text for these entries, validated by the same parser that reads the reviewed
 * file, so a reviewer can append them unchanged; a duplicate identity fails here.
 */
export function observedText(entries: Baseline[]): string {
  const text = `${JSON.stringify({ entries }, null, 2)}\n`;
  parseBaselines(text);
  return text;
}

/** Writes the observed entries of one run to an evidence path, never to the reviewed file. */
export function writeObserved(path: string, entries: Baseline[]): string {
  if (path.endsWith("font-baselines.json"))
    throw new Error(
      "font baselines: observed entries never go to the reviewed file",
    );
  const text = observedText(entries);
  writeFileSync(path, text);
  return text;
}

/** Joins the observed files of a run into one file in the baseline shape. */
export const mergeObserved = (sources: string[]): string =>
  observedText(sources.flatMap((source) => parseBaselines(source)));

/** The reviewed baselines in web/browser/font-baselines.json, validated. */
export const loadBaselines = (): Baseline[] =>
  parseBaselines(
    readFileSync(join(web, "browser", "font-baselines.json"), "utf8"),
  );

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Looks a measured role up by identity. An unknown identity is not admitted; for a known one,
 * every evidence field that differs is returned as drift to report, never to fail.
 */
export function review(
  entries: Baseline[],
  identity: BaselineIdentity,
  observed: BaselineEvidence,
): Review {
  const key = identityKey(identity);
  const found = entries.find((entry) => identityKey(entry.identity) === key);
  if (found === undefined)
    return {
      known: false,
      // The differing fields of each entry for the same role and project show what moved.
      nearest: entries
        .filter(
          (entry) =>
            entry.identity.project === identity.project &&
            entry.identity.environment === identity.environment &&
            entry.identity.role === identity.role,
        )
        .map((entry) =>
          identityFields.filter(
            (field) => entry.identity[field] !== identity[field],
          ),
        ),
    };
  return {
    known: true,
    drift: evidenceFields
      .filter((field) => !sameValue(found.evidence[field], observed[field]))
      .map((field) => ({
        field,
        reviewed: found.evidence[field],
        observed: observed[field],
      })),
  };
}
