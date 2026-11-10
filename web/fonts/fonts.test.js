// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  conversionProblems,
  decode,
  encode,
  preservationProblems,
} from "./convert.js";
import { inspectFont, toRanges, verifyEntry } from "./metadata.js";
import { parseNameTable, reservedNameHits } from "./names.js";
import { sfntTables } from "./sfnt.js";

const web = join(import.meta.dirname, "..");
const repo = join(web, "..");
const read = (rel) => readFileSync(join(repo, ...rel.split("/")));
const inventory = JSON.parse(read("web/assets/licences/asset-inventory.json"));
const entries = inventory.assets.flatMap((a) =>
  a.distributedFiles.map((f) => [a, f]),
);
const schema = JSON.parse(read("web/asset-licence.schema.json"));
const ajv = new Ajv({ allErrors: true, jsonPointers: true });
ajv.addSchema(schema, "inventory");
const validFile = (file) =>
  ajv.validate("inventory#/definitions/distributedFile", file);
const copy = (value) => JSON.parse(JSON.stringify(value));

/** A format-0 name table from [platform, encoding, language, nameId, bytes] records. */
function nameTable(records, format = 0) {
  const strings = Buffer.concat(records.map((r) => r[4]));
  const head = Buffer.alloc(6 + 12 * records.length);
  head.writeUInt16BE(format, 0);
  head.writeUInt16BE(records.length, 2);
  head.writeUInt16BE(head.length, 4);
  let offset = 0;
  records.forEach(([p, e, l, n, bytes], i) => {
    [p, e, l, n, bytes.length, offset].forEach((v, k) =>
      head.writeUInt16BE(v, 6 + 12 * i + 2 * k),
    );
    offset += bytes.length;
  });
  return Buffer.concat([head, strings]);
}
const utf16 = (text) => Buffer.from(text, "utf16le").swap16();

describe("binary-metadata verifier", () => {
  it.each(entries.map(([a, f]) => [a.id, f]))(
    "accepts the shipped %s file",
    async (_, file) => {
      expect(validFile(file)).toBe(true);
      expect(await verifyEntry(file, read(file.sourcePath), "font")).toEqual(
        [],
      );
    },
  );

  it("rejects each face field, the length and the coverage when they contradict the font", async () => {
    const [, file] = entries[0];
    const bytes = read(file.sourcePath);
    const cases = [
      [(f) => (f.byteLength += 1), /byteLength/u],
      [(f) => (f.face.weightRange = [200, 900]), /weightRange/u],
      [(f) => (f.face.style = "italic"), /style/u],
      [(f) => (f.face.stretch = 100), /stretch/u],
      [(f) => (f.face.format = "woff"), /container/u],
      [(f) => f.coverage.pop(), /coverage/u],
    ];
    for (const [change, pattern] of cases) {
      const wrong = copy(file);
      change(wrong);
      expect((await verifyEntry(wrong, bytes, "font")).join("\n")).toMatch(
        pattern,
      );
    }
  });

  it("rejects a truncated file and a file that is not a font", async () => {
    const [, file] = entries[2];
    const bytes = read(file.sourcePath);
    expect(
      await verifyEntry(file, bytes.subarray(0, 4000), "font"),
    ).not.toEqual([]);
    expect(
      await verifyEntry(file, Buffer.from("not a font at all"), "font"),
    ).not.toEqual([]);
  });

  it("rejects each missing field and each unknown field in the schema", () => {
    const [, file] = entries[0];
    for (const field of Object.keys(file)) {
      const wrong = copy(file);
      delete wrong[field];
      expect(validFile(wrong), field).toBe(false);
    }
    for (const field of Object.keys(file.face)) {
      const wrong = copy(file);
      delete wrong.face[field];
      expect(validFile(wrong), field).toBe(false);
    }
    expect(validFile({ ...copy(file), subset: true })).toBe(false);
    expect(
      validFile({ ...copy(file), face: { ...file.face, display: "swap" } }),
    ).toBe(false);
  });

  it("merges adjacent code points into unicode-range tokens", () => {
    expect(toRanges([0x41, 0x43, 0x42, 0x20, 0x1f600])).toEqual([
      "U+0020",
      "U+0041-0043",
      "U+1F600",
    ]);
  });
});

describe("name records", () => {
  it("keeps Mac and Windows records of one ID apart and keeps duplicates", () => {
    const table = nameTable([
      [1, 0, 0, 1, Buffer.from("Sample Code", "latin1")],
      [3, 1, 1033, 1, utf16("Other Face")],
      [3, 1, 1033, 1, utf16("Other Face")],
    ]);
    const records = parseNameTable(table);
    expect(records.map((r) => r.text)).toEqual([
      "Sample Code",
      "Other Face",
      "Other Face",
    ]);
    expect(reservedNameHits(records, ["Sample Code"])).toHaveLength(1);
  });

  it("finds a reserved name in any case and with spaces or hyphens removed", () => {
    for (const text of ["SAMPLE CODE Bold", "SampleCode", "sample-code"]) {
      const records = parseNameTable(nameTable([[3, 1, 1033, 4, utf16(text)]]));
      expect(reservedNameHits(records, ["Sample Code"]), text).toHaveLength(1);
    }
    const unrelated = parseNameTable(
      nameTable([[3, 1, 1033, 0, utf16("Sample Code")]]),
    );
    expect(reservedNameHits(unrelated, ["Sample Code"])).toEqual([]);
  });

  it("fails closed on unsupported encodings, malformed UTF-16 and format 1", () => {
    expect(() =>
      parseNameTable(nameTable([[3, 0, 1033, 1, utf16("x")]])),
    ).toThrow(/not supported/u);
    expect(() =>
      parseNameTable(nameTable([[1, 1, 0, 1, Buffer.from("x")]])),
    ).toThrow(/not supported/u);
    expect(() =>
      parseNameTable(nameTable([[3, 1, 1033, 1, Buffer.from([0, 65, 0])]])),
    ).toThrow(/odd/u);
    expect(() =>
      parseNameTable(
        nameTable([[3, 1, 1033, 1, Buffer.from([0xd8, 0, 0, 65])]]),
      ),
    ).toThrow(/malformed/u);
    expect(() => parseNameTable(nameTable([], 1))).toThrow(/format 1/u);
  });
});

describe("compression-only conversion", () => {
  const [asset] = inventory.assets.filter(
    (a) => a.transformation.kind === "woff2",
  );
  const original = read(`web/assets/fonts/${asset.id}/variable.ttf`);

  it("reproduces every recorded conversion with its preservation checks", async () => {
    expect(await conversionProblems(inventory, read)).toEqual([]);
  }, 120_000);

  it("is deterministic across two runs", async () => {
    expect((await encode(original)).equals(await encode(original))).toBe(true);
  }, 60_000);

  it("fails a changed tool version or option", async () => {
    for (const change of [
      (t) => (t.version = "2.6.2"),
      (t) => (t.options = ["--subset"]),
    ]) {
      const wrong = copy(inventory);
      change(wrong.assets.find((a) => a.id === asset.id).transformation);
      expect((await conversionProblems(wrong, read)).join("\n")).toMatch(
        /pinned/u,
      );
    }
  });

  it("fails any table change other than the documented reconstruction differences", async () => {
    const woff2 = read(asset.distributedFiles[0].sourcePath);
    const decoded = await decode(woff2);
    expect(preservationProblems(original, woff2, decoded)).toEqual([]);
    const at = (tag) =>
      sfntTables(decoded).get(tag).byteOffset - decoded.byteOffset;
    const flipped = (offset) => {
      const bytes = Buffer.from(decoded);
      bytes[offset] ^= 1;
      return bytes;
    };
    expect(
      preservationProblems(original, woff2, flipped(at("GSUB") + 20)).join(),
    ).toMatch(/GSUB changed/u);
    expect(
      preservationProblems(original, woff2, flipped(at("head") + 17)).join(),
    ).toMatch(/bit-11/u);
    expect(
      preservationProblems(original, woff2, flipped(at("head") + 11)).join(),
    ).toMatch(/checkSumAdjustment/u);
    expect(
      preservationProblems(original, woff2, flipped(at("head") + 4)).join(),
    ).toMatch(/head byte 4/u);
  }, 60_000);

  it("keeps the original's coverage and legal name records", async () => {
    const before = await inspectFont(original);
    const after = await inspectFont(read(asset.distributedFiles[0].sourcePath));
    expect(after.coverage).toEqual(before.coverage);
    const legal = (n) => n.filter((r) => [0, 13, 14].includes(r.nameId));
    expect(legal(after.names)).toEqual(legal(before.names));
    expect(legal(after.names).length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
