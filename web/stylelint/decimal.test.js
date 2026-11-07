// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decimalToken,
  isOpaqueAlpha,
  isOutlineOffset,
  isThickness,
} from "./decimal.js";

describe("decimal token parser", () => {
  it.each([
    ["0", { negative: false, scaled: 0, unit: "" }],
    ["4px", { negative: false, scaled: 40000, unit: "px" }],
    ["3.9999PX", { negative: false, scaled: 39999, unit: "px" }],
    ["0.0001px", { negative: false, scaled: 1, unit: "px" }],
    ["999999.9999px", { negative: false, scaled: 9999999999, unit: "px" }],
  ])("reads %s exactly", (word, expected) => {
    expect(decimalToken(word)).toEqual(expected);
  });

  it.each([
    "1e-400px",
    "1e-7px",
    "40000000000000000001e-19px",
    "4e0px",
    "+2px",
    "00.5px",
    ".5px",
    "004px",
    "0e5",
    "0.0000px",
    "4.0000px",
    "1.50px",
    "4.00001px",
    "1000000px",
    "px",
    "",
  ])("rejects the spelling %s", (word) => {
    expect(decimalToken(word, { signed: true })).toBeUndefined();
  });

  it("allows a minus only in a signed position and never on zero", () => {
    expect(decimalToken("-3px")).toBeUndefined();
    expect(decimalToken("-3px", { signed: true })).toEqual({
      negative: true,
      scaled: 30000,
      unit: "px",
    });
    for (const zero of ["-0", "-0px", "-0.0px"])
      expect(decimalToken(zero, { signed: true })).toBeUndefined();
  });
});

describe("position checks", () => {
  it.each(["0", "1px", "1.5px", "2px", "3px", "4px", "3.9999px", "0.0001px"])(
    "thickness accepts %s",
    (word) => {
      expect(isThickness(word)).toBe(true);
    },
  );

  it.each([
    "0px",
    "0PX",
    "0.0px",
    "4.0001px",
    "1.px",
    "5px",
    "-1px",
    "-0",
    "-0px",
    "1",
    "0.5",
    "1em",
    "1rem",
    "1%",
    "thin",
    "medium",
    "thick",
  ])("thickness rejects %s", (word) => {
    expect(isThickness(word)).toBe(false);
  });

  it.each(["0", "2px", "-3px", "4px", "-4px", "-0.0001px"])(
    "outline-offset accepts %s",
    (word) => {
      expect(isOutlineOffset(word)).toBe(true);
    },
  );

  it.each([
    "0px",
    "0PX",
    "2em",
    "1e3px",
    "5px",
    "-5px",
    "-0",
    "-0px",
    "4.0001px",
    "1",
  ])("outline-offset rejects %s", (word) => {
    expect(isOutlineOffset(word)).toBe(false);
  });

  it.each([
    ["1", false],
    ["100%", true],
    ["1.0", false],
    ["100.0%", false],
    ["9999999999999999999e-17%", false],
    ["1e0", false],
    ["+1", false],
    ["01", false],
  ])("opaque alpha %s is %s", (word, expected) => {
    expect(isOpaqueAlpha(word)).toBe(expected);
  });
});
