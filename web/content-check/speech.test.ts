// @vitest-environment node
import { describe, expect, inject, it } from "vitest";
import { slotOf } from "./slot.ts";
import { slotProblems } from "./slots.ts";

// Records come only from the compiler-backed global setup; without them this file fails to
// load, so no record is skipped into a pass.
const records = inject("contentRecords").filter(
  (r) => r.kind === "chapter" || r.kind === "part",
);
if (records.length === 0)
  throw new Error("the global setup provided no content records");

describe.each(records.map((r) => [r.path, r.text] as const))(
  "the speech of %s",
  (_, text) => {
    it("recomputes every audio slot from its segment texts", () => {
      expect(slotProblems(JSON.parse(text))).toEqual([]);
    });
  },
);

describe("the slot check", () => {
  const empty = slotOf([]);
  const section = (segments: unknown, audio: unknown = empty) => ({
    sections: [{ spoken: { segments, audio } }],
  });
  const wrong = "section 1: the slot is not the hash of its segment texts";

  it("holds a section with two segments somewhere in the records", () => {
    const counts = records.flatMap((r) => {
      const doc = JSON.parse(r.text) as {
        sections: { spoken: { segments: unknown[] } }[];
      };
      return doc.sections.map((s) => s.spoken.segments.length);
    });
    expect(Math.max(...counts)).toBeGreaterThan(1);
    expect(counts).toContain(0);
  });

  it("accepts an empty section and a section whose slot matches", () => {
    expect(slotProblems(section([]))).toEqual([]);
    expect(
      slotProblems(section([{ text: "a" }, { text: "b" }], slotOf(["a", "b"]))),
    ).toEqual([]);
    expect(slotProblems({ sections: [] })).toEqual([]);
  });

  it.each([
    ["a changed text", section([{ text: "a" }], slotOf(["b"]))],
    ["a dropped segment", section([{ text: "a" }], slotOf(["a", "b"]))],
    [
      "an added segment",
      section([{ text: "a" }, { text: "b" }], slotOf(["a"])),
    ],
    [
      "reordered segments",
      section([{ text: "b" }, { text: "a" }], slotOf(["a", "b"])),
    ],
    ["texts joined into one", section([{ text: "ab" }], slotOf(["a", "b"]))],
    ["the empty slot on a spoken section", section([{ text: "a" }])],
    ["a slot in upper case", section([], empty.toUpperCase())],
    ["a slot that is not a string", section([], 1)],
    ["a missing slot", { sections: [{ spoken: { segments: [] } }] }],
  ])("reports %s", (_, doc) => {
    expect(slotProblems(doc)).toEqual([wrong]);
  });

  it.each([
    ["a record that is not an object", null, "the record has no sections"],
    ["a record without sections", {}, "the record has no sections"],
    [
      "sections that are not a list",
      { sections: {} },
      "the record has no sections",
    ],
    [
      "a section without speech",
      { sections: [{}] },
      "section 1: no spoken segments",
    ],
    [
      "a section that is not an object",
      { sections: [1] },
      "section 1: no spoken segments",
    ],
    [
      "segments that are not a list",
      { sections: [{ spoken: { segments: "a", audio: empty } }] },
      "section 1: no spoken segments",
    ],
    ["a segment without text", section([{}]), "text 0 is not a string"],
    [
      "a segment that is not an object",
      section(["a"]),
      "text 0 is not a string",
    ],
    [
      "a text with a carriage return",
      section([{ text: "a\r" }]),
      "not in its stored form",
    ],
    [
      "a decomposed text",
      section([{ text: "e\u0301" }]),
      "not in its stored form",
    ],
    ["a lone surrogate", section([{ text: "\ud800" }]), "lone surrogate"],
  ])("reports %s", (_, doc, fragment) => {
    const problems = slotProblems(doc);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(fragment);
  });

  it("names the section that fails among sections that pass", () => {
    const doc = {
      sections: [
        { spoken: { segments: [], audio: empty } },
        { spoken: { segments: [{ text: "a" }], audio: empty } },
      ],
    };
    expect(slotProblems(doc)).toEqual([
      "section 2: the slot is not the hash of its segment texts",
    ]);
  });
});
