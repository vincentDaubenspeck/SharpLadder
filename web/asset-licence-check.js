// Package checks never see a non-package file that reaches the build output, so this lane does.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Ajv from "ajv";
import { ident, parse, walk } from "css-tree";
import { publicBase } from "./build-guard/contract.js";
import { minifySheet } from "./build-guard/provenance.js";
import { tokenPolicyProblems } from "./build-guard/token-policy.js";
import { conversionProblems } from "./fonts/convert.js";
import { verifyEntry } from "./fonts/metadata.js";
import { inside } from "./source-check/paths.js";

const web = import.meta.dirname;
const repo = join(web, "..");
const licencesDir = "web/assets/licences";
const inventoryPath = `${licencesDir}/asset-inventory.json`;
// After a reviewed binding change, record the values the metadata check reports for the new faces.
const sliceRecordPath = `${licencesDir}/font-slice.json`;
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

/** The same link-free canonical read, for checks that bind a source path to the inventory. */
export const readInRepo = (rootReal, rel) =>
  readRepoFile(defaults, rootReal, rel);

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
        files.set(rel, io.readFile(path));
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

function checkRecord(io, rootReal, asset, problems) {
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
  // No subsetter is pinned, so a subset output could not be reproduced.
  if (asset.transformation.kind === "subset")
    problems.push(
      `${at}: a subset font cannot ship without a pinned subset tool`,
    );
}

function checkMetadata(io, rootReal, problems) {
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
    checkRecord(io, rootReal, asset, problems);
  }

  // The licence folder holds the inventory and the declared texts, nothing unreviewed.
  const declared = new Set([
    inventoryPath,
    sliceRecordPath,
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
  const expected = generateFaces(inventory);
  problems.push(...expected.problems);
  if (expected.bytes !== null)
    checkSliceRecord(io, rootReal, expected, problems);
  return { claims: assetOutputs(inventory, problems), inventory, expected };
}

/** Shipped bytes are judged against their declared face, and converted ones are reproduced. */
async function checkFonts(io, rootReal, inventory, reproduce, problems) {
  for (const asset of inventory.assets.filter((a) => a.shipped)) {
    for (const file of asset.distributedFiles) {
      const label = `asset ${asset.id}: ${file.sourcePath}`;
      if (file.face.familyAlias !== asset.distributedFamilyName)
        problems.push(
          `${label}: face alias is not the distributed family name`,
        );
      let bytes;
      try {
        bytes = readRepoFile(io, rootReal, file.sourcePath);
      } catch (error) {
        problems.push(`${label}: cannot read: ${error.message}`);
        continue;
      }
      if (sha256(bytes) !== file.sha256)
        problems.push(`${label}: bytes differ from the recorded hash`);
      problems.push(...(await verifyEntry(file, bytes, label)));
    }
  }
  if (!reproduce) return;
  const read = (rel) => readRepoFile(io, rootReal, rel);
  try {
    problems.push(...(await conversionProblems(inventory, read)));
  } catch (error) {
    problems.push(`font conversion cannot run: ${error.message}`);
  }
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

/** Every character outside a small plain set is a hex escape, so no binding text becomes syntax. */
export const cssString = (text) =>
  `"${[...text]
    .map((c) =>
      /^[A-Za-z0-9 ._/-]$/u.test(c) ? c : `\\${c.codePointAt(0).toString(16)} `,
    )
    .join("")}"`;

const faceStyles = new Set(["normal", "italic"]);
const faceFormats = new Set(["woff2"]);
// Each segment starts with a letter or digit, so the URL has no dot segment, query or escape.
const plainDistPath =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u;
// A control character in a family alias is invisible in review, so it is refused.
const hasControl = (text) =>
  [...text].some((c) => {
    const n = c.codePointAt(0);
    return n < 0x20 || (n >= 0x7f && n <= 0x9f);
  });

/** One CSS number or two separated by U+0020; an equal pair is one, never left to the minifier. */
function faceRange(value, [low, high], unit, label, problems) {
  const pair = Array.isArray(value) ? value : [value, value];
  if (
    pair.length !== 2 ||
    !pair.every((n) => typeof n === "number" && Number.isFinite(n)) ||
    pair[0] < low ||
    pair[1] > high ||
    pair[0] > pair[1]
  ) {
    problems.push(`${label} is not an ascending range within ${low}-${high}`);
    return null;
  }
  return pair[0] === pair[1]
    ? `${pair[0]}${unit}`
    : `${pair[0]}${unit} ${pair[1]}${unit}`;
}

/**
 * The expected @font-face bytes, from the validated inventory bindings and the reviewed public
 * base alone, in inventory order and through C2's own minifier; emitted CSS is never an input.
 */
export function generateFaces(inventory) {
  const problems = [];
  const rules = [];
  const urls = new Set();
  const files = new Set();
  for (const asset of inventory.assets.filter((a) => a.shipped)) {
    for (const file of asset.distributedFiles) {
      const label = `asset ${asset.id}: ${file.distPath} face`;
      const face = file.face ?? {};
      if (files.has(file.distPath))
        problems.push(`${label}: the file is bound twice`);
      files.add(file.distPath);
      const family = face.familyAlias;
      if (
        typeof family !== "string" ||
        family === "" ||
        family.trim() !== family ||
        hasControl(family) ||
        !family.isWellFormed()
      )
        problems.push(`${label}: the family alias is not plain text`);
      if (!faceStyles.has(face.style))
        problems.push(`${label}: style ${String(face.style)} is unsupported`);
      if (!faceFormats.has(face.format))
        problems.push(`${label}: format ${String(face.format)} is unsupported`);
      const path = file.distPath;
      if (
        typeof path !== "string" ||
        !plainDistPath.test(path) ||
        !path.endsWith(`.${String(face.format)}`)
      )
        problems.push(`${label}: the dist path gives no plain URL`);
      const url = `${publicBase}${path}`;
      if (urls.has(url)) problems.push(`${label}: URL ${url} is not unique`);
      urls.add(url);
      const weight = faceRange(
        face.weightRange,
        [1, 1000],
        "",
        `${label}: weight`,
        problems,
      );
      const stretch = faceRange(
        face.stretch,
        [50, 200],
        "%",
        `${label}: stretch`,
        problems,
      );
      if (problems.length > 0) continue;
      rules.push(
        `@font-face {\n  font-family: ${cssString(family)};\n  src: url(${cssString(url)}) format("${face.format}");\n  font-weight: ${weight};\n  font-style: ${face.style};\n  font-stretch: ${stretch};\n  font-display: swap;\n}\n`,
      );
    }
  }
  if (problems.length > 0) return { problems, bytes: null, count: 0 };
  if (rules.length === 0) return { problems, bytes: Buffer.alloc(0), count: 0 };
  try {
    return {
      problems,
      bytes: Buffer.from(minifySheet(rules.join("\n")), "utf8"),
      count: rules.length,
    };
  } catch (error) {
    return {
      problems: [`the expected faces do not compile: ${error.message}`],
      bytes: null,
      count: 0,
    };
  }
}

/** The recorded hash and length of the expected faces, one value for every platform's CI. */
function checkSliceRecord(io, rootReal, expected, problems) {
  let record;
  try {
    record = parseJson(
      readRepoFile(io, rootReal, sliceRecordPath).toString("utf8"),
    );
  } catch (error) {
    problems.push(`${sliceRecordPath}: ${error.message}`);
    return;
  }
  if (
    Object.keys(record ?? {}).join() !== "sha256,byteLength" ||
    typeof record.sha256 !== "string" ||
    !hex64.test(record.sha256) ||
    !Number.isInteger(record.byteLength)
  ) {
    problems.push(
      `${sliceRecordPath}: expected {"sha256": "<hex>", "byteLength": <integer>}`,
    );
    return;
  }
  if (
    record.sha256 !== sha256(expected.bytes) ||
    record.byteLength !== expected.bytes.length
  )
    problems.push(
      `${sliceRecordPath}: the expected faces are ${expected.bytes.length} bytes with sha256 ${sha256(expected.bytes)}, not the recorded value`,
    );
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const bom = Buffer.from([0xef, 0xbb, 0xbf]);
const canonicalHeader = Buffer.from("@layer base{");
const closeBrace = 0x7d;
const semicolon = 0x3b;
const atName = (node) => ident.decode(node.name).toLowerCase();
const bareIdent = (raw) =>
  ident.decode(raw.replace(/\/\*[\s\S]*?\*\//gu, "").trim());

/**
 * Structure of one emitted stylesheet, judged on its original text before anything is
 * normalised: returns the byte span of its trailing faces, or null.
 */
function sheetFaces(bytes, count, label, problems) {
  if (bytes.subarray(0, 3).equals(bom)) {
    problems.push(`${label} starts with a byte-order mark`);
    return null;
  }
  if (/^@charset/iu.test(bytes.subarray(0, 8).toString("latin1"))) {
    problems.push(`${label} starts with @charset`);
    return null;
  }
  let text;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    problems.push(`${label} is not strict UTF-8`);
    return null;
  }
  const errors = [];
  let ast;
  try {
    ast = parse(text, {
      positions: true,
      parseAtrulePrelude: false,
      parseRulePrelude: false,
      parseValue: false,
      parseCustomProperty: false,
      onParseError: (error) => errors.push(error.message),
    });
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length > 0) {
    problems.push(`${label} does not parse: ${errors.join("; ")}`);
    return null;
  }
  // Parser offsets count UTF-16 units; slicing and comparison are in bytes.
  const at = (offset) => Buffer.byteLength(text.slice(0, offset), "utf8");
  const faces = [];
  let charset = false;
  walk(ast, {
    visit: "Atrule",
    enter(node) {
      const name = atName(node);
      if (name === "font-face") faces.push(node);
      else if (name === "charset") charset = true;
    },
  });
  if (charset) {
    problems.push(`${label} holds an @charset rule`);
    return null;
  }
  if (faces.length === 0) return { slice: null, faces: 0 };
  const found = problems.length;
  const fail = (why) => problems.push(`${label}: ${why}`);
  if (faces.length !== count)
    fail(`${faces.length} @font-face rules, ${count} bound`);
  const bases = ast.children
    .toArray()
    .filter(
      (node) =>
        node.type === "Atrule" &&
        atName(node) === "layer" &&
        node.block &&
        node.prelude?.type === "Raw" &&
        bareIdent(node.prelude.value) === "base",
    );
  if (bases.length !== 1) {
    fail(`${bases.length} top-level @layer base blocks, not one`);
    return null;
  }
  const [base] = bases;
  const open = at(base.block.loc.start.offset);
  const start = at(base.loc.start.offset);
  if (!bytes.subarray(start, open + 1).equals(canonicalHeader))
    fail("the @layer base header is not the canonical @layer base{");
  const kids = base.block.children.toArray();
  const trailing = kids.slice(Math.max(kids.length - count, 0));
  if (
    trailing.length !== count ||
    faces.some((face) => !trailing.includes(face))
  )
    fail(
      "an @font-face is not among the trailing children of the top-level @layer base",
    );
  if (problems.length > found) return null;
  for (const face of trailing) {
    const end = at(face.loc.end.offset);
    if (
      !face.block ||
      bytes[end - 1] !== closeBrace ||
      face.block.children.toArray().some((d) => d.type !== "Declaration")
    )
      fail("an @font-face is not a closed block of declarations only");
  }
  for (let i = 1; i < trailing.length; i++)
    if (at(trailing[i - 1].loc.end.offset) !== at(trailing[i].loc.start.offset))
      fail("the @font-face rules are not contiguous");
  const first = at(trailing[0].loc.start.offset);
  const last = at(trailing.at(-1).loc.end.offset);
  const previous = kids[kids.length - count - 1];
  if (
    previous === undefined
      ? first !== open + 1
      : at(previous.loc.end.offset) !== first ||
        ![closeBrace, semicolon].includes(bytes[first - 1])
  )
    fail(
      "the byte before the first @font-face does not end the preceding rule",
    );
  const close = at(base.loc.end.offset);
  if (
    at(base.block.loc.end.offset) !== close ||
    close !== last + 1 ||
    bytes[last] !== closeBrace
  )
    fail("the @layer base block is not closed right after the last @font-face");
  if (problems.length > found) return null;
  return {
    slice: { start: first, end: last },
    faces: count,
  };
}

/**
 * Every shipped font loads through the one admitted slice: the original bytes of the trailing
 * faces of the top-level @layer base must equal the generated faces, with nothing normalised.
 */
function fontBindingProblems(checked, actual, problems) {
  const { expected } = checked;
  if (expected.bytes === null) {
    problems.push("no output is admitted without the expected faces");
    return null;
  }
  const holders = [];
  let slice = null;
  for (const [path, bytes] of actual) {
    if (!path.endsWith(".css")) continue;
    const label = `output ${path}`;
    const sheet = Buffer.from(bytes);
    const found = sheetFaces(sheet, expected.count, label, problems);
    let admitted = null;
    if (found?.slice) {
      holders.push(path);
      const { start, end } = found.slice;
      const bytesAt = sheet.subarray(start, end);
      if (bytesAt.equals(expected.bytes)) {
        admitted = found.slice;
        slice = {
          path,
          start,
          end,
          byteLength: end - start,
          sha256: sha256(bytesAt),
        };
      } else {
        let i = 0;
        while (i < bytesAt.length && bytesAt[i] === expected.bytes[i]) i++;
        problems.push(
          `${label}: the @font-face bytes at [${start}, ${end}) differ from the bound faces at byte ${start + i}`,
        );
      }
    }
    // The whole original sheet is scanned; only an exactly admitted slice skips the name checks.
    for (const problem of tokenPolicyProblems(sheet, admitted))
      problems.push(`${label}: ${problem}`);
  }
  if (holders.length > 1)
    problems.push(`@font-face rules are emitted in ${holders.join(", ")}`);
  if (expected.count > 0 && holders.length === 0)
    problems.push("no emitted stylesheet holds the bound @font-face rules");
  return slice;
}

/** Output bytes against the declared owners; the font binding is judged from the same bytes. */
function outputProblems(checked, actual, owned, problems) {
  const claims = new Map(checked.claims);
  for (const [path, hash] of owned)
    claim(claims, path, hash, "the build guard", problems);
  const expected = new Map(
    [...claims.values()].map(({ path, hash }) => [path, hash]),
  );
  for (const [path, bytes] of actual) {
    const want = expected.get(path);
    if (want === undefined) problems.push(`output has an unowned file ${path}`);
    else if (want !== sha256(bytes))
      problems.push(`output ${path} differs from its hash`);
  }
  for (const path of expected.keys()) {
    if (!actual.has(path)) problems.push(`output is missing ${path}`);
  }
  return fontBindingProblems(checked, actual, problems);
}

function checkOutput(io, checked, output, owned, problems) {
  if (owned === null) {
    problems.push("output mode needs the build-guard-owned outputs (--owned)");
    return;
  }
  let actual;
  try {
    const top = realDirectory(io, output, "output directory");
    actual = walkFiles(io, top, "output", problems);
  } catch (error) {
    problems.push(`cannot read the output: ${error.message}`);
    return;
  }
  outputProblems(checked, actual, owned, problems);
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

async function checkTree(io, root, reproduce, problems) {
  let rootReal;
  try {
    rootReal = realDirectory(io, resolve(root), "repository root");
  } catch (error) {
    problems.push(`cannot use the repository root: ${error.message}`);
    return null;
  }
  const result = checkMetadata(io, rootReal, problems);
  if (result === null) return null;
  await checkFonts(io, rootReal, result.inventory, reproduce, problems);
  return { ...result, rootReal };
}

/**
 * Returns the problems found; an empty list in metadata mode says nothing about shipping.
 * Production records are those of this checkout; fixtures pass another root.
 */
export async function checkAssets(
  { root = repo, output = null, owned = null } = {},
  seams = {},
) {
  const io = { ...defaults, ...seams };
  const problems = [];
  const result = await checkTree(io, root, true, problems);
  if (result === null) return problems;
  if (output !== null)
    checkOutput(io, result, resolve(output), owned, problems);
  return problems;
}

/**
 * The build guard's entry to the same policy: it emits the licence texts this returns and
 * submits its in-memory output to check(). Conversion is reproduced by the metadata lane.
 */
export async function assetAdmission({ root }) {
  const problems = [];
  const result = await checkTree(defaults, root, false, problems);
  if (result === null || problems.length > 0) return { problems };
  const licenceTexts = [];
  for (const asset of result.inventory.assets.filter((a) => a.shipped)) {
    const { sourcePath, sha256: hash, distributionPath } = asset.licenceText;
    const bytes = readRepoFile(defaults, result.rootReal, sourcePath);
    if (sha256(bytes) !== hash)
      return {
        problems: [`asset ${asset.id}: licence text changed while read`],
      };
    licenceTexts.push({ path: distributionPath, bytes });
  }
  const admit = (actual, owned) => {
    const found = [];
    const slice = outputProblems(result, actual, owned, found);
    return { problems: found, slice };
  };
  const check = (actual, owned) => admit(actual, owned).problems;
  return { problems, licenceTexts, check, admit, inventory: result.inventory };
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
      problems = await checkAssets({
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
