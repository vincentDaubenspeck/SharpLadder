import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import valueParser from "postcss-value-parser";
import { readInRepo } from "../asset-licence-check.js";
import { verifyEntry } from "../fonts/metadata.js";
import { shown } from "../source-check/paths.js";

const required = [
  "font-family",
  "src",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-display",
];
const optional = new Set(["unicode-range"]);

// Only a plain file name directly under fonts/ is a canonical relative path.
const fontUrl = /^\.\/fonts\/[a-z0-9]+(?:-[a-z0-9]+)*\.woff2$/u;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const significant = (nodes) => nodes.filter((n) => n.type !== "space");
const isLayer = (node, name) =>
  node?.type === "atrule" &&
  node.name.toLowerCase() === "layer" &&
  node.nodes !== undefined &&
  node.params.trim() === name;

/** Why a quoted src path is not the canonical form, naming the first forbidden feature. */
function urlProblem(path) {
  if ([...path].some((c) => c.codePointAt(0) < 0x20 || c === "\u007f"))
    return "a URL-control character";
  if (path.includes("%")) return "a percent escape";
  if (path.includes("\\")) return "a backslash";
  if (/^[a-z][a-z0-9+.-]*:/iu.test(path)) return "a scheme";
  if (path.startsWith("//")) return "a protocol-relative path";
  if (path.startsWith("/")) return "an absolute path";
  if (path.includes("?")) return "a query";
  if (path.includes("#")) return "a fragment";
  if (path.split("/").includes("..")) return "a .. segment";
  if (!fontUrl.test(path))
    return "a path outside the canonical ./fonts/<name>.woff2 form";
  return undefined;
}

function number(node) {
  const n = node && valueParser.unit(node.value);
  return n && n.unit === "" && /^\d+$/u.test(n.number)
    ? Number(n.number)
    : undefined;
}

function percentage(node) {
  const n = node && valueParser.unit(node.value);
  return n && n.unit === "%" && /^\d+(?:\.\d+)?$/u.test(n.number)
    ? Number(n.number)
    : undefined;
}

/** One value or an ascending pair, each read by the given parser and kept inside bounds. */
function range(nodes, read, [low, high]) {
  const words = significant(nodes);
  if (
    words.length < 1 ||
    words.length > 2 ||
    words.some((w) => w.type !== "word")
  )
    return undefined;
  const values = words.map(read);
  if (values.some((v) => v === undefined || v < low || v > high))
    return undefined;
  if (values.length === 2 && values[0] > values[1]) return undefined;
  return values;
}

/** The src value must be exactly url("<path>") format("woff2"). */
function source(nodes) {
  const parts = significant(nodes);
  if (parts.some((p) => p.type === "div"))
    return { why: "src must hold exactly one source" };
  const [url, format] = parts;
  if (url?.type !== "function" || url.value.toLowerCase() !== "url")
    return { why: "src must start with url()" };
  const inner = significant(url.nodes);
  if (inner.length !== 1 || inner[0].type !== "string")
    return { why: "the src url() must hold one quoted path" };
  const path = inner[0].value;
  const unsafe = urlProblem(path);
  if (unsafe) return { why: `the src path has ${unsafe}` };
  const label = significant(format?.nodes ?? []);
  if (
    parts.length !== 2 ||
    format.type !== "function" ||
    format.value !== "format" ||
    label.length !== 1 ||
    label[0].type !== "string" ||
    label[0].value !== "woff2"
  )
    return { why: 'src must end with format("woff2")' };
  return { path };
}

function unicodeRange(nodes) {
  const tokens = [];
  for (const [i, n] of nodes.entries()) {
    if (i % 2 === 1) {
      if (n.type !== "div" || n.value !== ",") return undefined;
    } else if (n.type === "unicode-range") tokens.push(n.value.toUpperCase());
    else return undefined;
  }
  return tokens;
}

const bound = new Map();
/** Metadata parsing is costly and pure in the bytes, so each file is inspected once per run. */
async function metadataProblems(entry, bytes, label) {
  const key = sha256(bytes) + JSON.stringify(entry);
  if (!bound.has(key)) bound.set(key, verifyEntry(entry, bytes, label));
  return bound.get(key);
}

function shippedFiles(inventoryFile) {
  const inventory = JSON.parse(readFileSync(inventoryFile, "utf8"));
  const files = new Map();
  for (const asset of inventory.assets) {
    for (const file of asset.distributedFiles ?? [])
      files.set(file.sourcePath, { asset, file });
  }
  return files;
}

/**
 * F1 and F2: @font-face only in fonts.css, inside its one @layer base block, each face bound
 * by path and hash to one shipped distributed file whose parsed metadata it matches.
 */
export async function checkFontFaces(root, { isFonts, options, fail }) {
  const faces = [];
  root.walkAtRules((at) => {
    if (at.name.toLowerCase() !== "font-face") return;
    if (!isFonts) return fail(at, "@font-face is allowed only in fonts.css");
    if (!isLayer(at.parent, "base") || at.parent.parent?.type !== "root")
      return fail(
        at,
        "@font-face must be a direct child of the @layer base block",
      );
    faces.push(at);
    return undefined;
  });
  if (!isFonts) return;

  const top = root.nodes.filter((n) => n.type !== "comment");
  if (top.length !== 1 || !isLayer(top[0], "base"))
    fail(root, "fonts.css must be exactly one @layer base block");
  for (const block of top.filter((n) => isLayer(n, "base"))) {
    for (const node of block.nodes) {
      if (node.type === "comment") continue;
      if (node.type !== "atrule" || node.name.toLowerCase() !== "font-face")
        fail(node, "fonts.css holds only @font-face rules");
    }
  }

  let files;
  let repoReal;
  try {
    files = shippedFiles(options.inventoryFile);
    repoReal = realpathSync.native(options.repoRoot);
  } catch (error) {
    fail(root, `the asset inventory cannot be read: ${error.message}`);
    return;
  }

  const keys = new Set();
  const bindings = new Map();
  for (const face of faces) {
    const seen = new Map();
    let complete = true;
    for (const node of face.nodes ?? []) {
      if (node.type !== "decl") {
        fail(node, "nested rule inside @font-face");
        complete = false;
        continue;
      }
      const name = node.prop.toLowerCase();
      if (node.important) fail(node, "!important on a font descriptor");
      if (!required.includes(name) && !optional.has(name)) {
        fail(node, `descriptor ${node.prop} is not admitted`);
        continue;
      }
      if (seen.has(name)) {
        fail(node, `descriptor ${name} is repeated`);
        complete = false;
      }
      seen.set(name, node);
    }
    for (const name of required) {
      if (!seen.has(name)) {
        fail(face, `descriptor ${name} is missing`);
        complete = false;
      }
    }
    if (!complete) continue;

    const value = (name) => {
      const decl = seen.get(name);
      const raw = decl.raws.value?.raw ?? decl.value;
      return raw.includes("\\") ? undefined : valueParser(raw).nodes;
    };
    const parsed = {};
    let valid = true;
    const reject = (name, why) => {
      fail(seen.get(name), why);
      valid = false;
    };
    for (const name of seen.keys()) {
      if (value(name) === undefined) reject(name, `escape in ${name}`);
    }
    if (!valid) continue;

    const family = significant(value("font-family"));
    if (
      family.length !== 1 ||
      family[0].type !== "string" ||
      family[0].quote !== '"'
    )
      reject("font-family", "font-family must be one double-quoted name");
    else parsed.family = family[0].value;
    const src = source(value("src"));
    if (src.why) reject("src", src.why);
    else parsed.path = src.path;
    parsed.weight = range(value("font-weight"), number, [1, 1000]);
    if (!parsed.weight)
      reject(
        "font-weight",
        "font-weight must be a number or an ascending pair in 1-1000",
      );
    const style = significant(value("font-style"));
    if (style.length !== 1 || !["normal", "italic"].includes(style[0].value))
      reject("font-style", "font-style must be normal or italic");
    else parsed.style = style[0].value;
    parsed.stretch = range(value("font-stretch"), percentage, [50, 200]);
    if (!parsed.stretch)
      reject(
        "font-stretch",
        "font-stretch must be a percentage or an ascending pair in 50%-200%",
      );
    const display = significant(value("font-display"));
    if (display.length !== 1 || display[0].value !== "swap")
      reject("font-display", "font-display must be swap");
    if (seen.has("unicode-range")) {
      parsed.coverage = unicodeRange(significant(value("unicode-range")));
      if (!parsed.coverage)
        reject("unicode-range", "unicode-range must be a list of ranges");
    }
    if (!valid) continue;

    const key = JSON.stringify([
      parsed.family,
      parsed.weight,
      parsed.style,
      parsed.stretch,
    ]);
    if (keys.has(key))
      fail(
        face,
        "two @font-face rules share family, weight, style and stretch",
      );
    keys.add(key);

    // Only the stylesheet is resolved, as when it was matched to fonts.css; links below it stay
    // visible to readInRepo.
    let rel;
    try {
      const sheet = realpathSync.native(root.source.input.file);
      rel = shown(repoReal, join(dirname(sheet), parsed.path));
    } catch {
      rel = undefined;
    }
    const owner = files.get(rel);
    if (!owner) {
      fail(
        seen.get("src"),
        `${parsed.path} is not a distributed file in the asset inventory`,
      );
      continue;
    }
    const { asset, file } = owner;
    if (!asset.shipped) {
      fail(
        seen.get("src"),
        `${parsed.path} belongs to the unshipped record ${asset.id}`,
      );
      continue;
    }
    if (bindings.has(rel))
      fail(face, `${parsed.path} is bound by two @font-face rules`);
    bindings.set(rel, face);
    let bytes;
    try {
      bytes = readInRepo(repoReal, rel);
    } catch (error) {
      fail(seen.get("src"), `${parsed.path} cannot be read: ${error.message}`);
      continue;
    }
    if (sha256(bytes) !== file.sha256) {
      fail(seen.get("src"), `${parsed.path} does not match its inventory hash`);
      continue;
    }
    const want = file.face;
    if (
      parsed.family !== want.familyAlias ||
      want.familyAlias !== asset.distributedFamilyName
    )
      reject(
        "font-family",
        `font-family "${parsed.family}" is not the bound face alias`,
      );
    const weight =
      parsed.weight.length === 1
        ? [parsed.weight[0], parsed.weight[0]]
        : parsed.weight;
    if (JSON.stringify(weight) !== JSON.stringify(want.weightRange))
      reject("font-weight", "font-weight differs from the bound face");
    if (parsed.style !== want.style)
      reject("font-style", "font-style differs from the bound face");
    const stretch = Array.isArray(want.stretch) ? want.stretch : [want.stretch];
    if (JSON.stringify(parsed.stretch) !== JSON.stringify(stretch))
      reject("font-stretch", "font-stretch differs from the bound face");
    if (
      parsed.coverage &&
      JSON.stringify(parsed.coverage) !== JSON.stringify(file.coverage)
    )
      reject(
        "unicode-range",
        "unicode-range differs from the declared coverage",
      );
    for (const problem of await metadataProblems(file, bytes, rel))
      fail(face, problem);
  }

  for (const [rel, { asset }] of files) {
    if (asset.shipped && !bindings.has(rel))
      fail(root, `shipped file ${rel} has no @font-face binding`);
  }
}
