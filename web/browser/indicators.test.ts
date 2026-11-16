// @vitest-environment node
import { describe, expect, it } from "vitest";
import { judge, type Indicators } from "./indicators.ts";

/** Measurements in the range a painted state gives, clear of every threshold. */
const painted: Indicators = {
  focusOutline: 1,
  nestedFocus: 0.7,
  nestedRing: 700,
  clippedFocus: 1,
  rungRing: 1,
  readLines: 2,
  readRing: 2000,
  stroke: 1,
  restBorder: 0,
  sourceVsDestination: 2900,
};

describe("indicator thresholds", () => {
  it("pass a state whose every indicator paints", () => {
    expect(judge(painted)).toEqual([]);
  });

  it.each([
    ["focusOutline", 0.5],
    ["nestedFocus", 0.3],
    ["nestedRing", 39],
    ["clippedFocus", 0.5],
    ["rungRing", 0.4],
    ["readLines", 1],
    ["readRing", 39],
    ["stroke", 0.7],
    ["restBorder", 1],
    ["sourceVsDestination", 19],
  ] as const)("fail %s alone at %d", (key, value) => {
    const fails = judge({ ...painted, [key]: value });
    expect(fails).toHaveLength(1);
    expect(fails[0]?.startsWith(`${key}=`)).toBe(true);
  });
});
