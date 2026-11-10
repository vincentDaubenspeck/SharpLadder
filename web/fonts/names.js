// Name records are read twice, by lib-font and by a direct parse, and must agree before any is trusted.
import { Font } from "lib-font";
import { FontError } from "./sfnt.js";

// Every ID a renamed font must clear of a reserved name.
const reservedNameIds = [1, 2, 3, 4, 6, 16, 17, 18, 20, 21, 22];
// Copyright, licence description and licence URL.
export const legalNameIds = [0, 13, 14];

const macRoman = new TextDecoder("macintosh", { fatal: true });
const utf16 = new TextDecoder("utf-16be", { fatal: true });

/** Only these platform/encoding pairs are decoded; any other pair fails closed. */
function decodeName(bytes, platform, encoding) {
  const unicode =
    (platform === 0 && encoding >= 0 && encoding <= 4) ||
    (platform === 3 && (encoding === 1 || encoding === 10));
  if (unicode) {
    if (bytes.length % 2 !== 0)
      throw new FontError("UTF-16 name has an odd length");
    try {
      return utf16.decode(bytes);
    } catch {
      throw new FontError("UTF-16 name is malformed");
    }
  }
  if (platform === 1 && encoding === 0) return macRoman.decode(bytes);
  throw new FontError(`name encoding ${platform}/${encoding} is not supported`);
}

/** Every record of a raw name table in order, duplicates kept; format 1 is not admitted. */
export function parseNameTable(table) {
  if (table.length < 6) throw new FontError("name table is truncated");
  const format = table.readUInt16BE(0);
  if (format !== 0)
    throw new FontError(`name table format ${format} is not admitted`);
  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  if (table.length < 6 + 12 * count)
    throw new FontError("name records are truncated");
  const records = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 12 * i;
    const [platform, encoding, language, nameId, length, offset] = [
      0, 2, 4, 6, 8, 10,
    ].map((k) => table.readUInt16BE(at + k));
    const start = strings + offset;
    if (start + length > table.length)
      throw new FontError(`name ${nameId} is truncated`);
    const text = decodeName(
      table.subarray(start, start + length),
      platform,
      encoding,
    );
    records.push({ platform, encoding, language, nameId, text });
  }
  return records;
}

/** lib-font's records, with Mac Roman strings re-decoded from the bytes it read one per character. */
export async function libFontNames(bytes, fileName) {
  const font = new Font(fileName);
  await new Promise((resolve, reject) => {
    font.onload = resolve;
    font.onerror = (event) =>
      reject(new FontError(String(event.detail?.message ?? event.detail)));
    font.fromDataBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      fileName,
    );
  });
  const table = font.opentype.tables.name;
  if (table.format !== 0)
    throw new FontError(`name table format ${table.format} is not admitted`);
  return table.nameRecords.map((record) => {
    let text = record.string;
    if (record.platformID === 1 && record.encodingID === 0) {
      text = macRoman.decode(Uint8Array.from(text, (c) => c.codePointAt(0)));
    }
    return {
      platform: record.platformID,
      encoding: record.encodingID,
      language: record.languageID,
      nameId: record.nameID,
      text,
    };
  });
}

const key = (r) =>
  JSON.stringify([r.platform, r.encoding, r.language, r.nameId, r.text]);

/** The two readers must list the same records, multiplicity included. */
export function sameRecords(direct, viaLibFont) {
  if (direct.length !== viaLibFont.length) return false;
  const a = direct.map(key).sort();
  const b = viaLibFont.map(key).sort();
  return a.every((value, i) => value === b[i]);
}

const squeeze = (text) => text.toLowerCase().replace(/[\s-]/gu, "");

/** Records that keep a reserved name, literally or with spaces and hyphens removed, any case. */
export function reservedNameHits(records, reservedNames) {
  const hits = [];
  for (const record of records) {
    if (!reservedNameIds.includes(record.nameId)) continue;
    for (const name of reservedNames) {
      const literal = record.text.toLowerCase().includes(name.toLowerCase());
      if (literal || squeeze(record.text).includes(squeeze(name)))
        hits.push(
          `name ${record.nameId} (${record.platform}/${record.encoding}) keeps ${name}`,
        );
    }
  }
  return hits;
}
