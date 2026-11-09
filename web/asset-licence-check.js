// Package checks never see a non-package file that reaches the build output, so this lane does.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Ajv from "ajv";
import { inside } from "./source-check/paths.js";

const web = import.meta.dirname;
const repo = join(web, "..");
const licencesDir = "web/assets/licences";
const inventoryPath = `${licencesDir}/asset-inventory.json`;
// The schema is policy, so it always comes from this checkout, never from the tree checked.
const schema = JSON.parse(
  readFileSync(join(web, "asset-licence.schema.json"), "utf8"),
);
const validate = new Ajv({ allErrors: true, jsonPointers: true }).compile(
  schema,
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex64 = /^[0-9a-f]{64}$/u;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
// Case-insensitive file systems would merge these names, so they count as one path.
const caseKey = (path) => path.normalize("NFC").toLowerCase();
const collapse = (text) => text.replace(/\s+/gu, " ");
const nameKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/gu, "");

const help = `Usage: node asset-licence-check.js [--root <repo>] [--output <dir> --owned <file>]

Metadata mode (the default) validates the asset inventory and its licence texts
and needs no build. Its success is never a shipping acceptance.

Output mode also requires <dir> to hold exactly the build-guard-owned files named
in <file>, {"files": {"<dist path>": "<sha256>"}}, plus every shipped asset file
and licence text.`;

const defaults = {
  lstat: lstatSync,
  readdir: readdirSync,
  readFile: readFileSync,
  realpath: realpathSync.native,
};

/** Returns why a declared relative path is unsafe, or null when it is canonical. */
function pathProblem(path) {
  if (typeof path !== "string" || path === "") return "is empty";
  if (path.includes("\\")) return "uses a backslash separator";
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path)) return "is absolute";
  for (const segment of path.split("/")) {
    if (segment === "") return "has an empty segment";
    if (segment === "." || segment === "..") return "has a dot segment";
    // Windows drops a trailing dot or space, so two spellings would name one file.
    if (/[. ]$/u.test(segment)) return "has a segment ending in a dot or space";
    if (segment.includes(":")) return "has a colon";
  }
  return null;
}

/** JSON.parse keeps only the last of two equal keys, so a repeated key could hide an entry. */
function parseJson(text) {
  const value = JSON.parse(text);
  // The text is valid JSON here, so a string followed by a colon is always an object key.
  const colon = /\s*:/uy;
  const frames = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") frames.push(new Set());
    else if (c === "[") frames.push(null);
    else if (c === "}" || c === "]") frames.pop();
    else if (c === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      colon.lastIndex = end + 1;
      const keys = frames.at(-1);
      if (keys && colon.test(text)) {
        const key = JSON.parse(text.slice(i, end + 1));
        if (keys.has(key))
          throw new Error(`duplicate key ${JSON.stringify(key)}`);
        keys.add(key);
      }
      i = end;
    }
  }
  return value;
}

/** A link or a non-canonical spelling anywhere on the path could read a file outside the tree. */
function readRepoFile(io, rootReal, rel) {
  const unsafe = pathProblem(rel);
  if (unsafe) throw new Error(`${rel} ${unsafe}`);
  let path = rootReal;
  for (const segment of rel.split("/")) {
    path = join(path, segment);
    if (io.lstat(path).isSymbolicLink())
      throw new Error(`${rel} passes through a link or junction`);
  }
  const real = io.realpath(path);
  if (real !== path || !inside(rootReal, real))
    throw new Error(`${rel} does not resolve to its own canonical path`);
  if (!io.lstat(path).isFile()) throw new Error(`${rel} is not a regular file`);
  return io.readFile(path);
}

/** Anything but a regular file could change what is served without changing a hash. */
function walkFiles(io, top, label, problems) {
  const files = new Map();
  const keys = new Map();
  const visit = (dir, prefix) => {
    const entries = io.readdir(dir, { withFileTypes: true });
    for (const entry of [...entries].sort(byName)) {
      const rel = `${prefix}${entry.name}`;
      const path = join(dir, entry.name);
      const key = caseKey(rel);
      if (keys.has(key)) {
        problems.push(`${label}/${rel} collides in case with ${keys.get(key)}`);
        continue;
      }
      keys.set(key, rel);
      const stat = io.lstat(path);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        problems.push(`${label}/${rel} is a link or junction`);
      } else if (io.realpath(path) !== path) {
        problems.push(`${label}/${rel} does not resolve to its own path`);
      } else if (stat.isDirectory()) {
        visit(path, `${rel}/`);
      } else if (stat.isFile()) {
        files.set(rel, sha256(io.readFile(path)));
      } else {
        problems.push(`${label}/${rel} is not a regular file`);
      }
    }
  };
  visit(top, "");
  return files;
}

/** A real directory, never a link; its canonical path is what every later check builds on. */
function realDirectory(io, dir, label) {
  let stat;
  try {
    stat = io.lstat(dir);
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(`${label} does not exist`, { cause: error });
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`${label} is not a real directory`);
  return io.realpath(dir);
}

// The licence body defines the term too, and the notice itself names the licence in mixed case.
const bodyMarker = "SIL OPEN FONT LICENSE Version 1.1";
const rfnTerm = /reserved font name/giu;
// Reviewed literals; each exempts only the term occurrence it contains, never another one.
const negativeDeclarations = [
  "with no Reserved Font Name",
  "with no Reserved Font Names",
];

/** Edits to the text or the list must both be made deliberately; this is not proof of review. */
function declarationHash(licenceSha256, reservedFontNames) {
  return sha256(
    Buffer.from(licenceSha256 + JSON.stringify(reservedFontNames), "utf8"),
  );
}

/** A repeated marker leaves the boundary ambiguous, so no notice is trusted. */
function noticeOf(text) {
  const first = text.indexOf(bodyMarker);
  if (first < 0 || text.indexOf(bodyMarker, first + 1) >= 0) return null;
  return text.slice(0, first);
}

/** A negative literal exempts only its own occurrence, so a later reservation still counts. */
function reservesAName(notice) {
  for (const match of notice.matchAll(rfnTerm)) {
    const covered = negativeDeclarations.some((negative) => {
      const start = match.index - negative.indexOf("Reserved Font Name");
      return start >= 0 && notice.startsWith(negative, start);
    });
    if (!covered) return true;
  }
  return false;
}

function checkRecord(io, rootReal, asset, production, problems) {
  const at = `asset ${asset.id}`;
  const originals = new Map();
  for (const file of asset.originalFiles) {
    if (originals.has(file.id))
      problems.push(`${at}: original file id ${file.id} is not unique`);
    originals.set(file.id, file);
    const unsafe = pathProblem(file.acquisitionPath);
    if (unsafe) problems.push(`${at}: acquisitionPath ${unsafe}`);
  }
  const modified = asset.transformation.kind !== "none";
  for (const input of asset.transformation.inputs ?? []) {
    if (!originals.has(input))
      problems.push(`${at}: transformation input ${input} is not an original`);
  }
  for (const file of asset.distributedFiles) {
    const original = originals.get(file.fromOriginal);
    if (!original)
      problems.push(`${at}: ${file.distPath} names no original file`);
    else if (!modified && original.sha256 !== file.sha256)
      problems.push(
        `${at}: ${file.distPath} is untransformed but differs from its original`,
      );
  }

  const expected = `${licencesDir}/${asset.id}/OFL.txt`;
  if (asset.licenceText.sourcePath !== expected) {
    problems.push(`${at}: licence text must be stored at ${expected}`);
  } else {
    let text = null;
    try {
      const bytes = readRepoFile(io, rootReal, expected);
      if (sha256(bytes) !== asset.licenceText.sha256)
        problems.push(`${at}: licence text hash does not match ${expected}`);
      // Exact text: whitespace changes must not forge the marker, a literal or a name.
      text = bytes.toString("utf8");
    } catch (error) {
      problems.push(`${at}: cannot read licence text: ${error.message}`);
    }
    const notice = text === null ? null : noticeOf(text);
    if (text !== null && notice === null)
      problems.push(
        `${at}: the licence text must hold "${bodyMarker}" exactly once`,
      );
    if (notice !== null) {
      if (!collapse(notice).includes(collapse(asset.copyright)))
        problems.push(`${at}: the licence text does not carry the copyright`);
      // The list is a reviewed declaration; these checks catch inconsistency, not omissions.
      for (const name of asset.reservedFontNames) {
        if (!notice.includes(name))
          problems.push(`${at}: reserved name ${name} is not in the notice`);
      }
      if (asset.reservedFontNames.length === 0 && reservesAName(notice))
        problems.push(
          `${at}: the notice reserves a font name but the list is empty`,
        );
    }
  }
  if (
    asset.declarationHash !==
    declarationHash(asset.licenceText.sha256, asset.reservedFontNames)
  )
    problems.push(
      `${at}: declarationHash does not match the licence hash and reserved names`,
    );

  if (!asset.shipped) return;
  // A modified font may not keep a reserved name; the flag and string alone are only claims.
  if (modified && asset.reservedFontNames.length > 0) {
    if (!asset.renamedIdentity)
      problems.push(
        `${at}: a modified font with a reserved name is not renamed`,
      );
    const shipped = nameKey(asset.distributedFamilyName);
    for (const name of asset.reservedFontNames) {
      if (shipped.includes(nameKey(name)))
        problems.push(`${at}: distributed family keeps reserved name ${name}`);
    }
  }
  if (modified)
    problems.push(
      `${at}: modified fonts cannot ship until binary naming verification lands`,
    );
  if (production)
    problems.push(`${at}: no font ships until the build guard admits fonts`);
}

function checkMetadata(io, rootReal, production, problems) {
  let inventory;
  try {
    const bytes = readRepoFile(io, rootReal, inventoryPath);
    inventory = parseJson(bytes.toString("utf8"));
  } catch (error) {
    problems.push(`${inventoryPath}: ${error.message}`);
    return null;
  }
  if (!validate(inventory)) {
    for (const e of validate.errors)
      problems.push(`${inventoryPath}${e.dataPath}: ${e.message}`);
    return null;
  }
  const ids = new Set();
  for (const asset of inventory.assets) {
    if (ids.has(asset.id)) problems.push(`asset id ${asset.id} is not unique`);
    ids.add(asset.id);
    checkRecord(io, rootReal, asset, production, problems);
  }

  // The licence folder holds the inventory and the declared texts, nothing unreviewed.
  const declared = new Set([
    inventoryPath,
    ...inventory.assets.map((a) => a.licenceText.sourcePath),
  ]);
  try {
    const top = realDirectory(
      io,
      join(rootReal, ...licencesDir.split("/")),
      licencesDir,
    );
    for (const rel of walkFiles(io, top, licencesDir, problems).keys()) {
      if (!declared.has(`${licencesDir}/${rel}`))
        problems.push(`${licencesDir}/${rel} is not declared in the inventory`);
    }
  } catch (error) {
    problems.push(`cannot list ${licencesDir}: ${error.message}`);
  }
  return assetOutputs(inventory, problems);
}

/** Every output path has one owner, keyed by case so a case-insensitive host cannot merge two. */
function claim(claims, path, hash, owner, problems) {
  const unsafe = pathProblem(path);
  if (unsafe) {
    problems.push(`${owner}: output path ${path} ${unsafe}`);
    return;
  }
  const key = caseKey(path);
  const held = claims.get(key);
  if (held) {
    const [first, second] =
      owner === "the build guard" ? [owner, held.owner] : [held.owner, owner];
    problems.push(`${path} is owned by both ${first} and ${second}`);
    return;
  }
  claims.set(key, { path, hash, owner });
}

/** Declared paths are policy, so they are judged without waiting for a build. */
function assetOutputs(inventory, problems) {
  const claims = new Map();
  for (const asset of inventory.assets.filter((a) => a.shipped)) {
    for (const file of asset.distributedFiles)
      claim(claims, file.distPath, file.sha256, `asset ${asset.id}`, problems);
    claim(
      claims,
      asset.licenceText.distributionPath,
      asset.licenceText.sha256,
      `asset ${asset.id} licence text`,
      problems,
    );
  }
  return claims;
}

function checkOutput(io, assetClaims, output, owned, problems) {
  if (owned === null) {
    problems.push("output mode needs the build-guard-owned outputs (--owned)");
    return;
  }
  const claims = new Map(assetClaims);
  for (const [path, hash] of owned)
    claim(claims, path, hash, "the build guard", problems);
  const expected = new Map(
    [...claims.values()].map(({ path, hash }) => [path, hash]),
  );
  let actual;
  try {
    const top = realDirectory(io, output, "output directory");
    actual = walkFiles(io, top, "output", problems);
  } catch (error) {
    problems.push(`cannot read the output: ${error.message}`);
    return;
  }
  for (const [path, hash] of actual) {
    const want = expected.get(path);
    if (want === undefined) problems.push(`output has an unowned file ${path}`);
    else if (want !== hash)
      problems.push(`output ${path} differs from its hash`);
  }
  for (const path of expected.keys()) {
    if (!actual.has(path)) problems.push(`output is missing ${path}`);
  }
}

function readOwned(file) {
  const record = parseJson(readFileSync(file, "utf8"));
  const files = record?.files;
  if (
    Object.keys(record ?? {}).join() !== "files" ||
    typeof files !== "object" ||
    files === null ||
    Array.isArray(files)
  )
    throw new Error('expected {"files": {"<dist path>": "<sha256>"}}');
  for (const [path, hash] of Object.entries(files)) {
    if (typeof hash !== "string" || !hex64.test(hash))
      throw new Error(`${path} has no SHA-256`);
  }
  return new Map(Object.entries(files));
}

/**
 * Returns the problems found; an empty list in metadata mode says nothing about shipping.
 * Production records are those of this checkout; fixtures pass another root.
 */
export function checkAssets(
  { root = repo, output = null, owned = null } = {},
  seams = {},
) {
  const io = { ...defaults, ...seams };
  const problems = [];
  let rootReal;
  try {
    rootReal = realDirectory(io, resolve(root), "repository root");
  } catch (error) {
    return [`cannot use the repository root: ${error.message}`];
  }
  const production = rootReal === realpathSync.native(repo);
  const claims = checkMetadata(io, rootReal, production, problems);
  if (output !== null && claims !== null)
    checkOutput(io, claims, resolve(output), owned, problems);
  return problems;
}

const invoked =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));

if (invoked) {
  let problems;
  let mode = "metadata";
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string" },
        output: { type: "string" },
        owned: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      mode = "help";
      problems = [];
    } else {
      if ((values.output === undefined) !== (values.owned === undefined))
        throw new Error("--output and --owned go together");
      if (values.output !== undefined) mode = "output";
      problems = checkAssets({
        root: values.root,
        output: values.output ?? null,
        owned: values.owned === undefined ? null : readOwned(values.owned),
      });
    }
  } catch (error) {
    problems = [error instanceof Error ? error.message : String(error)];
  }
  for (const p of problems) console.log(p);
  if (problems.length === 0) {
    const success = {
      help,
      metadata: "asset inventory metadata valid (not a shipping acceptance)",
      output: "asset output closure valid",
    };
    console.log(success[mode]);
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
