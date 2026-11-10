// Declared face metadata is a claim; this reads the shipped bytes and says whether the claim holds.
import { create } from "fontkit";
import {
  legalNameIds,
  libFontNames,
  parseNameTable,
  sameRecords,
} from "./names.js";
import { containerOf, FontError, sfntTables, woff2Tables } from "./sfnt.js";

// OS/2 usWidthClass to CSS font-stretch, by table from the OpenType specification, never by value.
const widthClassPercent = new Map([
  [1, 50],
  [2, 62.5],
  [3, 75],
  [4, 87.5],
  [5, 100],
  [6, 112.5],
  [7, 125],
  [8, 150],
  [9, 200],
]);

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, "0");

/** Sorted code points as unicode-range tokens, adjacent points merged. */
export function toRanges(codePoints) {
  const sorted = [...new Set(codePoints)].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    ranges.push(
      i === j ? `U+${hex(sorted[i])}` : `U+${hex(sorted[i])}-${hex(sorted[j])}`,
    );
    i = j + 1;
  }
  return ranges;
}

function rawTables(bytes) {
  return containerOf(bytes) === "woff2"
    ? woff2Tables(bytes).tables
    : sfntTables(bytes);
}

/**
 * Coverage is every Unicode scalar the cmap maps to a glyph other than .notdef. Variation
 * sequences (cmap format 14) are not coverage, so a font carrying them fails closed.
 */
function coverageOf(font) {
  for (const { table } of font.cmap.tables) {
    if (table.version === 14)
      throw new FontError("cmap variation sequences are not admitted");
  }
  const points = font.characterSet.filter(
    (cp) => (cp < 0xd800 || cp > 0xdfff) && font.glyphForCodePoint(cp).id !== 0,
  );
  return toRanges(points);
}

function styleOf(font) {
  const italic = font["OS/2"].fsSelection.italic;
  if (italic !== font.head.macStyle.italic)
    throw new FontError("OS/2 and head disagree on italic");
  if (font["OS/2"].fsSelection.oblique)
    throw new FontError("oblique faces are not admitted");
  return italic ? "italic" : "normal";
}

/** Reads the facts a face declaration is judged against, from the exact bytes. */
export async function inspectFont(bytes, fileName = "font") {
  const format = containerOf(bytes);
  let font;
  try {
    font = create(bytes);
  } catch (error) {
    throw new FontError(`fontkit cannot read the font: ${error.message}`);
  }
  const axes = font.variationAxes;
  for (const tag of Object.keys(axes)) {
    if (tag !== "wght" && tag !== "wdth")
      throw new FontError(`axis ${tag} is not admitted`);
  }
  const weightRange = axes.wght
    ? [axes.wght.min, axes.wght.max]
    : [font["OS/2"].usWeightClass, font["OS/2"].usWeightClass];
  let stretch;
  if (axes.wdth) stretch = [axes.wdth.min, axes.wdth.max];
  else {
    stretch = widthClassPercent.get(font["OS/2"].usWidthClass);
    if (stretch === undefined)
      throw new FontError("OS/2 width class is out of range");
  }
  const table = rawTables(bytes).get("name");
  if (table === undefined) throw new FontError("name table is missing");
  const names = parseNameTable(table);
  if (!sameRecords(names, await libFontNames(bytes, fileName)))
    throw new FontError(
      "lib-font and the direct parse disagree on the name records",
    );
  return {
    format,
    weightRange,
    style: styleOf(font),
    stretch,
    coverage: coverageOf(font),
    names,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Problems with one distributedFiles entry against its own bytes. */
export async function verifyEntry(entry, bytes, label) {
  let facts;
  try {
    facts = await inspectFont(bytes, label);
  } catch (error) {
    return [`${label}: ${error.message}`];
  }
  const problems = [];
  if (entry.byteLength !== bytes.length)
    problems.push(
      `${label}: byteLength ${entry.byteLength} differs from the file (${bytes.length})`,
    );
  if (facts.format !== entry.face.format)
    problems.push(
      `${label}: container is ${facts.format}, not ${entry.face.format}`,
    );
  for (const field of ["weightRange", "style", "stretch"]) {
    if (!same(facts[field], entry.face[field]))
      problems.push(
        `${label}: face ${field} ${JSON.stringify(entry.face[field])} differs from the font (${JSON.stringify(facts[field])})`,
      );
  }
  if (!same(facts.coverage, entry.coverage))
    problems.push(`${label}: declared coverage differs from the font's cmap`);
  for (const id of legalNameIds) {
    if (!facts.names.some((r) => r.nameId === id && r.text.trim() !== ""))
      problems.push(`${label}: name ${id} (legal metadata) is missing`);
  }
  return problems;
}

/** A converted file must keep every legal name record of its original, byte for byte in text. */
export function legalRecordsKept(original, converted) {
  const pick = (records) =>
    records
      .filter((r) => legalNameIds.includes(r.nameId))
      .map((r) => JSON.stringify(r))
      .sort();
  return same(pick(original), pick(converted));
}
