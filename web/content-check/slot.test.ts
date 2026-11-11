// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { isStoredForm, serialiseTexts, slotOf } from "./slot.ts";

interface Accepted {
  readonly name: string;
  readonly stored: boolean;
  readonly texts: readonly (readonly number[])[];
  readonly canonical: string;
  readonly slot: string;
}

interface Rejected {
  readonly name: string;
  readonly texts: readonly (readonly number[])[];
}

// The compiler's tests read the same file; its expected bytes come from RFC 8785, not from
// either writer, so agreeing with it is agreeing with the compiler.
const vectors = JSON.parse(
  readFileSync(
    join(
      dirname(dirname(import.meta.dirname)),
      "tools",
      "SharpLadder.Content.Tests",
      "fixtures",
      "slot",
      "vectors.json",
    ),
    "utf8",
  ),
) as { accepted: Accepted[]; rejected: Rejected[] };

// Texts are stored as UTF-16 code units, so a lone surrogate survives the file format.
const strings = (texts: readonly (readonly number[])[]) =>
  texts.map((units) => String.fromCharCode(...units));

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("audio slot", () => {
  it("has both kinds of vector", () => {
    expect(vectors.accepted.length).toBeGreaterThanOrEqual(14);
    expect(vectors.rejected.length).toBeGreaterThanOrEqual(8);
  });

  it.each(vectors.accepted)("writes the expected bytes: $name", (vector) => {
    expect(hex(serialiseTexts(strings(vector.texts)))).toBe(vector.canonical);
  });

  it.each(vectors.accepted)("gives the expected slot: $name", (vector) => {
    const texts = strings(vector.texts);
    expect(texts.every(isStoredForm)).toBe(vector.stored);
    if (vector.stored) expect(slotOf(texts)).toBe(vector.slot);
    else expect(() => slotOf(texts)).toThrow("not in its stored form");
  });

  it.each(vectors.rejected)("refuses a lone surrogate: $name", (vector) => {
    const texts = strings(vector.texts);
    expect(() => serialiseTexts(texts)).toThrow("lone surrogate");
    expect(() => slotOf(texts)).toThrow("lone surrogate");
    expect(texts.every(isStoredForm)).toBe(false);
  });

  it("refuses everything that is not a dense array of primitive strings", () => {
    const sparse = ["a", "b", "c"];
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- A hole is the case under test.
    delete sparse[1];
    const longer: string[] = ["a"];
    longer.length = 2;
    const inputs: unknown[] = [
      undefined,
      null,
      "a",
      { 0: "a", length: 1 },
      new Set(["a"]),
      sparse,
      longer,
      ["a", 1],
      ["a", null],
      ["a", undefined],
      ["a", ["b"]],
      ["a", { toJSON: () => "b" }],
      ["a", new String("b")],
      new Uint8Array([1]),
    ];
    for (const input of inputs) {
      expect(() => serialiseTexts(input)).toThrow("audio slot refused");
      expect(() => slotOf(input)).toThrow("audio slot refused");
    }
  });

  it("copies the texts, so an array that answers for itself changes nothing", () => {
    const texts = Object.assign(["a", "b"], { toJSON: () => ["x"] });
    expect(hex(serialiseTexts(texts))).toBe(hex(serialiseTexts(["a", "b"])));
    expect(slotOf(texts)).toBe(slotOf(["a", "b"]));
  });

  it.each([0xfffe, 0xffff, 0xfdd0, 0xfdef, 0x1fffe, 0x10ffff])(
    "refuses the noncharacter %i in stored text",
    (point) => {
      const text = `a${String.fromCodePoint(point)}`;
      expect(isStoredForm(text)).toBe(false);
      expect(() => slotOf([text])).toThrow("not in its stored form");
    },
  );

  it.each([0xfdcf, 0xfdf0, 0xfffd, 0x10000, 0x10fffd])(
    "admits %i, the neighbour of a noncharacter",
    (point) => {
      expect(slotOf([String.fromCodePoint(point)])).toMatch(
        /^sha256:[0-9a-f]{64}$/u,
      );
    },
  );

  it("changes with segment order and with a split text", () => {
    expect(slotOf(["a", "b"])).not.toBe(slotOf(["b", "a"]));
    expect(slotOf(['a","b'])).not.toBe(slotOf(["a", "b"]));
  });

  it.each(["a\rb", "a\r\nb", "é", "Å"])(
    "refuses text that is not in stored form: %j",
    (text) => {
      expect(() => slotOf(["fine", text])).toThrow("not in its stored form");
    },
  );
});
