// Reads font containers byte by byte, so table identity never depends on the converter it checks.
import { brotliDecompressSync } from "node:zlib";

/** A malformed font is rejected, never partly read. */
export class FontError extends Error {}

const need = (condition, message) => {
  if (!condition) throw new FontError(message);
};

/** Returns the container kind from the signature alone; anything else is not a font. */
export function containerOf(bytes) {
  need(bytes.length >= 12, "too short to be a font");
  const tag = bytes.toString("latin1", 0, 4);
  if (tag === "wOF2") return "woff2";
  if (bytes.readUInt32BE(0) === 0x00010000) return "truetype";
  if (tag === "OTTO") return "opentype";
  throw new FontError(`unknown container signature ${JSON.stringify(tag)}`);
}

/** Tables keyed by tag, each a bounds-checked view of the file. */
export function sfntTables(bytes) {
  need(containerOf(bytes) !== "woff2", "not an sfnt file");
  const count = bytes.readUInt16BE(4);
  need(bytes.length >= 12 + 16 * count, "table directory is truncated");
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    const tag = bytes.toString("latin1", at, at + 4);
    const offset = bytes.readUInt32BE(at + 8);
    const length = bytes.readUInt32BE(at + 12);
    need(offset + length <= bytes.length, `table ${tag} is truncated`);
    need(!tables.has(tag), `table ${tag} is repeated`);
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  return tables;
}

// The WOFF2 specification's known-tag table; index 63 means an explicit tag follows.
const knownTags = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
];

function base128(bytes, state) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    need(state.at < bytes.length, "table directory is truncated");
    const byte = bytes[state.at++];
    need(!(i === 0 && byte === 0x80), "UIntBase128 has a leading zero");
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      need(value <= 0xffffffff, "UIntBase128 overflows");
      return value;
    }
  }
  throw new FontError("UIntBase128 is longer than five bytes");
}

/**
 * Untransformed WOFF2 tables keyed by tag, taken from the brotli stream directly;
 * transformed tables are reported by tag only because their bytes are not the sfnt bytes.
 */
export function woff2Tables(bytes) {
  need(containerOf(bytes) === "woff2", "not a WOFF2 file");
  need(bytes.length >= 48, "WOFF2 header is truncated");
  need(
    bytes.toString("latin1", 4, 8) !== "ttcf",
    "font collections are not admitted",
  );
  need(
    bytes.readUInt32BE(8) === bytes.length,
    "WOFF2 length field differs from the file",
  );
  const count = bytes.readUInt16BE(12);
  const compressed = bytes.readUInt32BE(20);
  const state = { at: 48 };
  const entries = [];
  for (let i = 0; i < count; i++) {
    need(state.at < bytes.length, "table directory is truncated");
    const flags = bytes[state.at++];
    let tag = knownTags[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      need(state.at + 4 <= bytes.length, "table directory is truncated");
      tag = bytes.toString("latin1", state.at, state.at + 4);
      state.at += 4;
    }
    const version = flags >> 6;
    const length = base128(bytes, state);
    const glyphData = tag === "glyf" || tag === "loca";
    const transformed = glyphData ? version !== 3 : version !== 0;
    const stored = transformed ? base128(bytes, state) : length;
    entries.push({ tag, transformed, stored });
  }
  need(state.at + compressed <= bytes.length, "compressed stream is truncated");
  let stream;
  try {
    stream = brotliDecompressSync(
      bytes.subarray(state.at, state.at + compressed),
    );
  } catch (error) {
    throw new FontError(`compressed stream does not decode: ${error.message}`);
  }
  const tables = new Map();
  const transformed = new Set();
  let offset = 0;
  for (const { tag, transformed: isTransformed, stored } of entries) {
    need(!tables.has(tag) && !transformed.has(tag), `table ${tag} is repeated`);
    need(offset + stored <= stream.length, `table ${tag} is truncated`);
    if (isTransformed) transformed.add(tag);
    else tables.set(tag, stream.subarray(offset, offset + stored));
    offset += stored;
  }
  need(offset === stream.length, "compressed stream has trailing bytes");
  return { tables, transformed };
}

/** The OpenType table checksum: big-endian uint32 words, zero-padded. */
function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    let word = 0;
    for (let k = 0; k < 4; k++) word = word * 256 + (bytes[i + k] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}

/** The checkSumAdjustment a file must carry: 0xB1B0AFBA minus the sum with the field zeroed. */
export function expectedAdjustment(bytes) {
  const head = sfntTables(bytes).get("head");
  need(
    head !== undefined && head.length >= 54,
    "head table is missing or short",
  );
  const copy = Buffer.from(bytes);
  copy.writeUInt32BE(0, head.byteOffset - bytes.byteOffset + 8);
  return (0xb1b0afba - checksum(copy)) >>> 0;
}

function simpleGlyph(data, contours) {
  let at = 10;
  const ends = [];
  for (let i = 0; i < contours; i++, at += 2) ends.push(data.readUInt16BE(at));
  const instructionLength = data.readUInt16BE(at);
  at += 2;
  const instructions = data
    .subarray(at, at + instructionLength)
    .toString("hex");
  at += instructionLength;
  const points = contours === 0 ? 0 : ends.at(-1) + 1;
  const flags = [];
  while (flags.length < points) {
    const flag = data[at++];
    flags.push(flag);
    if (flag & 8) for (let r = data[at++]; r > 0; r--) flags.push(flag);
  }
  const axis = (short, same) => {
    const values = [];
    let value = 0;
    for (const flag of flags) {
      if (flag & short) value += flag & same ? data[at++] : -data[at++];
      else if (!(flag & same)) {
        value += data.readInt16BE(at);
        at += 2;
      }
      values.push(value);
    }
    return values;
  };
  const xs = axis(2, 16);
  const ys = axis(4, 32);
  need(at <= data.length, "glyph data is truncated");
  // Only on-curve and overlap bits carry meaning; the rest are encoding choices.
  const on = flags.map((flag) => flag & 1);
  const overlap = (flags[0] ?? 0) & 0x40;
  return { ends, instructions, on, overlap, xs, ys };
}

function compositeGlyph(data) {
  let at = 10;
  let flags;
  const parts = [];
  do {
    flags = data.readUInt16BE(at);
    const glyph = data.readUInt16BE(at + 2);
    at += 4;
    const argLength = flags & 1 ? 4 : 2;
    const scale = flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
    const args = data.subarray(at, at + argLength + scale).toString("hex");
    at += argLength + scale;
    // Bit 8 says whether instructions follow; the encoder may set it on another component.
    parts.push([flags & ~0x100, glyph, args]);
  } while (flags & 0x20);
  let instructions = "";
  if (flags & 0x100) {
    const length = data.readUInt16BE(at);
    instructions = data.subarray(at + 2, at + 2 + length).toString("hex");
  }
  return { parts, instructions };
}

/** One canonical record per glyph, unencoded glyphs included, independent of byte layout. */
export function glyphRecords(bytes) {
  const tables = sfntTables(bytes);
  const [head, maxp, loca, glyf] = ["head", "maxp", "loca", "glyf"].map(
    (tag) => {
      const table = tables.get(tag);
      need(table !== undefined, `table ${tag} is missing`);
      return table;
    },
  );
  const long = head.readInt16BE(50) === 1;
  const count = maxp.readUInt16BE(4);
  need(loca.length >= (count + 1) * (long ? 4 : 2), "loca table is truncated");
  const offset = (i) =>
    long ? loca.readUInt32BE(4 * i) : loca.readUInt16BE(2 * i) * 2;
  const records = [];
  for (let g = 0; g < count; g++) {
    const start = offset(g);
    const end = offset(g + 1);
    need(start <= end && end <= glyf.length, `glyph ${g} lies outside glyf`);
    if (start === end) {
      records.push("empty");
      continue;
    }
    const data = glyf.subarray(start, end);
    need(data.length >= 10, `glyph ${g} is truncated`);
    const contours = data.readInt16BE(0);
    const box = [2, 4, 6, 8].map((at) => data.readInt16BE(at));
    const body =
      contours >= 0 ? simpleGlyph(data, contours) : compositeGlyph(data);
    records.push(JSON.stringify({ contours, box, ...body }));
  }
  return records;
}
