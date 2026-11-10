// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  loadBaselines,
  mergeObserved,
  observedText,
  parseBaselines,
  review,
  writeObserved,
  type Baseline,
  type BaselineIdentity,
} from "./fonts.ts";

const identity: BaselineIdentity = {
  platform: "win32",
  arch: "x64",
  engine: "chromium",
  engineVersion: "158.0.8127.18",
  project: "desktop-chromium",
  environment: "windows-reference",
  role: "ui",
  face: "Segoe UI Variable Text",
  faceSha256: "a".repeat(64),
  witness: "Grow",
  glyphText: "Grow",
  size: "100px",
  glyphSize: "28px",
  weight: "400",
  style: "normal",
  stretch: "100%",
  featureSettings: "normal",
  variationSettings: "normal",
  opticalSizing: "auto",
  ligatures: "normal",
};
const evidence = {
  os: "win32 10.0.26300",
  signature: [60.5, 51.25],
  platformFonts: ["Segoe UI Variable|0|system|4"],
  glyphSha256: "b".repeat(64),
};
const entry = (): Baseline => ({
  identity: { ...identity },
  evidence: structuredClone(evidence),
});
const file = (entries: unknown[]) => JSON.stringify({ entries });
const mutated = (
  change: (raw: Record<string, Record<string, unknown>>) => void,
) => {
  const raw = entry() as unknown as Record<string, Record<string, unknown>>;
  change(raw);
  return file([raw]);
};
const fields = Object.keys(identity) as (keyof BaselineIdentity)[];

describe("font baseline file", () => {
  it("validates the committed entries, 30 Windows and 15 Linux", () => {
    const entries = loadBaselines();
    expect(entries).toHaveLength(45);
    expect(entries.filter((e) => e.identity.platform === "win32")).toHaveLength(
      30,
    );
    expect(entries.filter((e) => e.identity.platform === "linux")).toHaveLength(
      15,
    );
  });

  it("accepts a well-formed entry", () => {
    expect(parseBaselines(file([entry()]))).toEqual([entry()]);
  });

  it.each([
    ["not JSON", "{", "not JSON"],
    ["a top-level array", "[]", "the file is not an object"],
    ["no entries", "{}", "the file lacks entries"],
    [
      "an unknown top-level key",
      JSON.stringify({ entries: [], extra: 1 }),
      "unknown key extra",
    ],
    [
      "entries not an array",
      JSON.stringify({ entries: {} }),
      "entries is not an array",
    ],
    ["an entry that is not an object", file([1]), "entry 0 is not an object"],
    [
      "an unknown entry key",
      file([{ ...entry(), note: "x" }]),
      "entry 0 has unknown key note",
    ],
    ["no evidence", file([{ identity }]), "entry 0 lacks evidence"],
    [
      "a flat old-style entry",
      file([{ ...identity, ...evidence }]),
      "entry 0 lacks identity",
    ],
    [
      "an unknown identity key",
      mutated((r) => {
        r["identity"] = { ...r["identity"], os: "x" };
      }),
      "identity has unknown key os",
    ],
    [
      "an unknown evidence key",
      mutated((r) => {
        r["evidence"] = { ...r["evidence"], face: "x" };
      }),
      "evidence has unknown key face",
    ],
    [
      "a missing evidence key",
      mutated((r) => {
        delete r["evidence"]?.["os"];
      }),
      "evidence lacks os",
    ],
    [
      "a numeric field",
      mutated((r) => {
        if (r["identity"]) r["identity"]["weight"] = 400;
      }),
      "entry 0 weight is blank or not a string",
    ],
    [
      "a blank field",
      mutated((r) => {
        if (r["identity"]) r["identity"]["engineVersion"] = " ";
      }),
      "entry 0 engineVersion is blank or not a string",
    ],
    [
      "an uppercase face hash",
      mutated((r) => {
        if (r["identity"]) r["identity"]["faceSha256"] = "A".repeat(64);
      }),
      "faceSha256 is not a lowercase SHA-256",
    ],
    [
      "an unknown role",
      mutated((r) => {
        if (r["identity"]) r["identity"]["role"] = "body";
      }),
      "role is not ui, display or code",
    ],
    [
      "a blank os",
      mutated((r) => {
        if (r["evidence"]) r["evidence"]["os"] = "";
      }),
      "entry 0 os is blank or not a string",
    ],
    [
      "a short glyph hash",
      mutated((r) => {
        if (r["evidence"]) r["evidence"]["glyphSha256"] = "b";
      }),
      "glyphSha256 is not a lowercase SHA-256",
    ],
    [
      "an empty signature",
      mutated((r) => {
        if (r["evidence"]) r["evidence"]["signature"] = [];
      }),
      "signature is not positive advances",
    ],
    [
      "a zero advance",
      mutated((r) => {
        if (r["evidence"]) r["evidence"]["signature"] = [1, 0];
      }),
      "signature is not positive advances",
    ],
    [
      "a text advance",
      mutated((r) => {
        if (r["evidence"]) r["evidence"]["signature"] = ["1"];
      }),
      "signature is not positive advances",
    ],
    [
      "platform fonts as text",
      mutated((r) => {
        if (r["evidence"]) r["evidence"]["platformFonts"] = "x";
      }),
      "platformFonts is not null or strings",
    ],
    [
      "a number among platform fonts",
      mutated((r) => {
        if (r["evidence"]) r["evidence"]["platformFonts"] = [1];
      }),
      "platformFonts is not null or strings",
    ],
  ])("refuses %s", (_name, source, message) => {
    expect(() => parseBaselines(source)).toThrow(message);
  });

  it("accepts null platform fonts, which only Chromium reports", () => {
    const raw = entry();
    raw.evidence.platformFonts = null;
    expect(parseBaselines(file([raw]))).toHaveLength(1);
  });

  it("refuses two entries for one identity, even with different evidence", () => {
    const other = entry();
    other.evidence.os = "win32 10.0.26100";
    expect(() => parseBaselines(file([entry(), other]))).toThrow(
      "entry 1 repeats identity",
    );
  });

  it.each(fields)("keeps entries that differ only in %s apart", (field) => {
    const other = entry();
    other.identity = {
      ...identity,
      [field]:
        field === "faceSha256"
          ? "c".repeat(64)
          : field === "role"
            ? "code"
            : "other",
    };
    expect(parseBaselines(file([entry(), other]))).toHaveLength(2);
  });
});

describe("font baseline review", () => {
  it("admits the reviewed identity with no drift", () => {
    expect(review([entry()], identity, evidence)).toEqual({
      known: true,
      drift: [],
    });
  });

  it("admits an operating system change alone and reports the new string", () => {
    expect(
      review([entry()], identity, { ...evidence, os: "win32 10.0.26100" }),
    ).toEqual({
      known: true,
      drift: [
        { field: "os", reviewed: evidence.os, observed: "win32 10.0.26100" },
      ],
    });
  });

  it("reports a historical glyph hash change without refusing", () => {
    const result = review([entry()], identity, {
      ...evidence,
      glyphSha256: "d".repeat(64),
    });
    expect(result).toEqual({
      known: true,
      drift: [
        {
          field: "glyphSha256",
          reviewed: evidence.glyphSha256,
          observed: "d".repeat(64),
        },
      ],
    });
  });

  it("reports metric and platform-font changes without refusing", () => {
    const result = review([entry()], identity, {
      ...evidence,
      signature: [60.5, 51.5],
      platformFonts: null,
    });
    expect(result.known).toBe(true);
    expect(result.known && result.drift.map((d) => d.field)).toEqual([
      "signature",
      "platformFonts",
    ]);
  });

  it.each(fields)(
    "refuses an identity whose %s differs from every entry",
    (field) => {
      const moved = {
        ...identity,
        [field]:
          field === "faceSha256"
            ? "c".repeat(64)
            : field === "role"
              ? "display"
              : "other",
      };
      const result = review([entry()], moved, evidence);
      expect(result.known).toBe(false);
    },
  );

  it("names what moved for the nearest entries of the same role", () => {
    const moved = {
      ...identity,
      engineVersion: "159.0",
      faceSha256: "c".repeat(64),
    };
    expect(review([entry()], moved, evidence)).toEqual({
      known: false,
      nearest: [["engineVersion", "faceSha256"]],
    });
  });

  it("refuses everything when no entry is recorded", () => {
    expect(review([], identity, evidence)).toEqual({
      known: false,
      nearest: [],
    });
  });
});

describe("observed entries", () => {
  const other = (): Baseline => ({
    identity: { ...identity, project: "phone-chromium" },
    evidence: { ...evidence },
  });

  it("are written in the shape the reviewed file parses, in identity order", () => {
    const text = observedText([entry(), other()]);
    expect(parseBaselines(text)).toEqual([entry(), other()]);
    expect(
      Object.keys(
        (JSON.parse(text) as { entries: Baseline[] }).entries[0]?.identity ??
          {},
      ),
    ).toEqual(Object.keys(identity));
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("refuse a repeated identity", () => {
    expect(() => observedText([entry(), entry()])).toThrow(/repeats identity/);
  });

  it("never write to the reviewed file", () => {
    expect(() =>
      writeObserved(join("x", "browser", "font-baselines.json"), [entry()]),
    ).toThrow(/never go to the reviewed file/);
  });

  it("merge across files and refuse a malformed file", () => {
    const merged = mergeObserved([
      observedText([entry()]),
      observedText([other()]),
      observedText([]),
    ]);
    expect(parseBaselines(merged)).toHaveLength(2);
    expect(() => mergeObserved([observedText([entry()]), "{}"])).toThrow();
    expect(parseBaselines(mergeObserved([]))).toEqual([]);
  });
});
