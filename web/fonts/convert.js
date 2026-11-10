// Converted fonts are reproduced from their committed originals, so a recorded hash is never trusted alone.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { create } from "fontkit";
import { inspectFont, legalRecordsKept } from "./metadata.js";
import { reservedNameHits } from "./names.js";
import {
  expectedAdjustment,
  glyphRecords,
  sfntTables,
  woff2Tables,
} from "./sfnt.js";

const web = join(import.meta.dirname, "..");
const repo = join(web, "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The only admitted converter: the WOFF2 module alone, never the package's own TTF writer.
const converter = {
  tool: "fonteditor-core",
  version: "2.6.3",
  module: "woff2/index.js",
  // Third-party WASM build that was not reproduced; this pin records that assumption.
  wasmSha256:
    "afda7e08349046612a019713c8f3baae52ee9d064c712919af020cd2634dddd6",
  options: [],
};

/** Originals of converted records live at a fixed path per record and original id. */
const originalPath = (assetId, originalId) =>
  `web/assets/fonts/${assetId}/${originalId}.ttf`;

let loaded = null;

/** Loads the pinned module after checking its version and WASM bytes; any drift fails. */
async function woff2() {
  if (loaded) return loaded;
  const dir = join(web, "node_modules", converter.tool);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (pkg.version !== converter.version)
    throw new Error(
      `${converter.tool} ${pkg.version} is installed, ${converter.version} is pinned`,
    );
  const wasm = sha256(readFileSync(join(dir, "woff2", "woff2.wasm")));
  if (wasm !== converter.wasmSha256)
    throw new Error(
      `${converter.tool} woff2.wasm hash ${wasm} differs from its pin`,
    );
  const module = createRequire(import.meta.url)(join(dir, converter.module));
  await module.init();
  loaded = module;
  return module;
}

export async function encode(ttf) {
  return Buffer.from((await woff2()).encode(ttf));
}

export async function decode(bytes) {
  return Buffer.from((await woff2()).decode(bytes));
}

const glyphMetrics = (font, id) => {
  const glyph = font.getGlyph(id);
  const box = glyph.bbox;
  const path = glyph.path.commands
    .map((c) => c.command + c.args.join(","))
    .join(" ");
  return JSON.stringify([
    glyph.advanceWidth,
    box.minX,
    box.minY,
    box.maxX,
    box.maxY,
    path,
  ]);
};

const cmapOf = (font) =>
  font.characterSet.map((cp) => [cp, font.glyphForCodePoint(cp).id]);

/**
 * Compression-only means only documented WOFF2 reconstruction differences remain: glyf and loca
 * re-encoded, head with checkSumAdjustment recomputed and flags bit 11 set. Anything else fails.
 */
export function preservationProblems(original, woff2Bytes, decoded) {
  const problems = [];
  const a = sfntTables(original);
  const b = sfntTables(decoded);
  const tags = [...new Set([...a.keys(), ...b.keys()])].sort();
  for (const tag of tags) {
    if (!a.has(tag) || !b.has(tag))
      problems.push(`table ${tag} is not in both fonts`);
    else if (
      !["glyf", "loca", "head"].includes(tag) &&
      !a.get(tag).equals(b.get(tag))
    )
      problems.push(`table ${tag} changed`);
  }
  // The same comparison straight from the WOFF2 stream, without the converter's decoder.
  const { tables: stream, transformed } = woff2Tables(woff2Bytes);
  for (const tag of a.keys()) {
    if (transformed.has(tag) || tag === "head") continue;
    if (!stream.get(tag)?.equals(a.get(tag)))
      problems.push(`table ${tag} differs in the WOFF2 stream`);
  }
  const headA = a.get("head");
  const headB = b.get("head");
  if (headA && headB) {
    for (let i = 0; i < Math.max(headA.length, headB.length); i++) {
      const field = (i >= 8 && i < 12) || i === 16 || i === 17;
      if (!field && headA[i] !== headB[i])
        problems.push(`head byte ${i} changed`);
    }
    if (headB.readUInt16BE(16) !== (headA.readUInt16BE(16) | 0x800))
      problems.push("head flags differ by more than the bit-11 transition");
    if (headB.readUInt32BE(8) !== expectedAdjustment(decoded))
      problems.push("head checkSumAdjustment is not the recomputed checksum");
  }
  if (problems.length > 0) return problems;
  const glyphsA = glyphRecords(original);
  const glyphsB = glyphRecords(decoded);
  if (glyphsA.length !== glyphsB.length) return ["glyph count changed"];
  const fontA = create(original);
  const fontB = create(decoded);
  for (let g = 0; g < glyphsA.length; g++) {
    if (glyphsA[g] !== glyphsB[g])
      problems.push(`glyph ${g} structure changed`);
    else if (glyphMetrics(fontA, g) !== glyphMetrics(fontB, g))
      problems.push(`glyph ${g} outline or metrics changed`);
  }
  if (JSON.stringify(cmapOf(fontA)) !== JSON.stringify(cmapOf(fontB)))
    problems.push("cmap mapping changed");
  return problems;
}

/** Problems with every converted record of an inventory, each reproduced from its original. */
export async function conversionProblems(inventory, read, write = null) {
  const problems = [];
  for (const asset of inventory.assets) {
    const t = asset.transformation;
    if (t.kind !== "woff2") continue;
    const at = `asset ${asset.id}`;
    for (const field of ["tool", "version"]) {
      if (t[field] !== converter[field])
        problems.push(
          `${at}: transformation ${field} ${t[field]} is not the pinned ${converter[field]}`,
        );
    }
    if (JSON.stringify(t.options) !== JSON.stringify(converter.options))
      problems.push(
        `${at}: transformation options differ from the pinned options`,
      );
    if (problems.length > 0) continue;
    for (const file of asset.distributedFiles) {
      const label = `${at}: ${file.sourcePath}`;
      const pinned = asset.originalFiles.find(
        (o) => o.id === file.fromOriginal,
      );
      const original = read(originalPath(asset.id, file.fromOriginal));
      if (!pinned || sha256(original) !== pinned.sha256) {
        problems.push(`${label}: original does not match its pinned hash`);
        continue;
      }
      const output = await encode(original);
      if (write) write(file.sourcePath, output);
      else if (!read(file.sourcePath).equals(output))
        problems.push(
          `${label}: committed bytes differ from the reproduced conversion`,
        );
      if (sha256(output) !== file.sha256)
        problems.push(
          `${label}: reproduced hash ${sha256(output)} is not the recorded one`,
        );
      for (const p of preservationProblems(
        original,
        output,
        await decode(output),
      ))
        problems.push(`${label}: ${p}`);
      const before = await inspectFont(original, "original.ttf");
      const after = await inspectFont(output, "converted.woff2");
      if (JSON.stringify(before.coverage) !== JSON.stringify(after.coverage))
        problems.push(`${label}: coverage differs from the original`);
      if (!legalRecordsKept(before.names, after.names))
        problems.push(`${label}: legal name records were not kept`);
      for (const hit of reservedNameHits(after.names, asset.reservedFontNames))
        problems.push(`${label}: ${hit}`);
    }
  }
  return problems;
}

const invoked =
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (invoked) {
  const { values } = parseArgs({
    options: { write: { type: "boolean" } },
    strict: true,
  });
  const inventory = JSON.parse(
    readFileSync(
      join(repo, "web/assets/licences/asset-inventory.json"),
      "utf8",
    ),
  );
  const read = (rel) => readFileSync(join(repo, ...rel.split("/")));
  const write = values.write
    ? (rel, bytes) => writeFileSync(join(repo, ...rel.split("/")), bytes)
    : null;
  const problems = await conversionProblems(inventory, read, write);
  for (const p of problems) console.log(p);
  if (problems.length === 0)
    console.log("font conversions reproduced and preserved");
  process.exitCode = problems.length === 0 ? 0 : 1;
}
