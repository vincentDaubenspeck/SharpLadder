// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalise, roleFailures } from "./acceptance.js";

const roles = [
  ["body", "1rem", "1.55", [["body", 10, "body", 10]]],
  ["hero", "clamp(2rem, 4vw, 3rem)", "1.06", [["h1", 20, "h1", 20]]],
];
const declarations = [
  { selector: "body", line: 10, prop: "font-size", value: "1rem" },
  { selector: "body", line: 10, prop: "line-height", value: "1.55" },
  {
    selector: "h1",
    line: 20,
    prop: "font-size",
    value: "clamp(2rem,4vw,3rem)",
  },
  { selector: "h1", line: 20, prop: "line-height", value: "1.06" },
];
const accept = (overrides) =>
  roleFailures({
    roles,
    authoredOnly: new Set(["hero"]),
    declarations,
    measured: new Set(["body"]),
    conflicts: [],
    ...overrides,
  });

describe("extractor role acceptance", () => {
  it("accepts measured roles and labelled authored-only evidence", () => {
    expect(accept()).toEqual([]);
  });

  it("fails a named role whose declaration is missing", () => {
    expect(accept({ declarations: declarations.slice(1) })).toEqual([
      "body: no font-size at body line 10 (missing or moved)",
    ]);
  });

  it("fails a named role whose declaration moved", () => {
    const moved = declarations.map((d) =>
      d.selector === "h1" && d.prop === "line-height" ? { ...d, line: 21 } : d,
    );
    expect(accept({ declarations: moved })).toEqual([
      "hero: no line-height at h1 line 20 (missing or moved)",
    ]);
  });

  it("fails a required role that was never measured", () => {
    expect(accept({ measured: new Set() })).toEqual(["body: never measured"]);
  });

  it("fails an unmeasured role outside the authored-only list", () => {
    expect(accept({ authoredOnly: new Set() })).toEqual([
      "hero: never measured",
    ]);
  });

  it("fails a bound value that differs from the contract", () => {
    const changed = declarations.map((d) =>
      d.selector === "body" && d.prop === "font-size"
        ? { ...d, value: "1.0625rem" }
        : d,
    );
    expect(accept({ declarations: changed })).toEqual([
      "body: font-size at body line 10 is 1.0625rem, contract 1rem",
    ]);
  });

  it("fails a measured conflict and ignores a spelling note", () => {
    const conflicts = [
      {
        name: "body",
        note: "role value differs from the contract",
        mockup: "1rem / 1.5",
      },
      { name: "body", note: "spelling differs", mockup: "1.0rem" },
    ];
    expect(accept({ conflicts })).toEqual([
      "body: role value differs from the contract (1rem / 1.5)",
    ]);
  });

  it("compares values without comments or spacing differences", () => {
    expect(normalise("clamp( 2rem , 4vw,/* x */3rem )")).toBe(
      normalise("clamp(2rem, 4vw, 3rem)"),
    );
  });
});
