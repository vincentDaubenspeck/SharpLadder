import { describe, expect, it } from "vitest";
import {
  isValidPosition,
  move,
  type WalkPosition,
  type WalkRequest,
  type WalkShape,
} from "../content/walk-position.ts";

// Sequence 1 has three steps and sequence 2 one; frozen, so a write to it throws.
const walk: WalkShape = Object.freeze([
  Object.freeze({ steps: Object.freeze(["a", "b", "c"]) }),
  Object.freeze({ steps: Object.freeze(["d"]) }),
]);

const at = (sequence: number, step: number): WalkPosition =>
  Object.freeze({ sequence, step });

const prev: WalkRequest = { cause: "prev" };
const next: WalkRequest = { cause: "next" };
const select = (sequence: number): WalkRequest => ({
  cause: "sequence",
  sequence,
});

// Zero and the negatives would name a sequence counted from the end, and a fraction or NaN a
// truncated one, if the guard before the lookup were gone.
const unknownSequences = [0, 3, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];
const badSteps = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 4];

describe("isValidPosition", () => {
  it.each([
    [1, 0],
    [1, 3],
    [2, 0],
    [2, 1],
  ])("admits sequence %s step %s", (sequence, step) => {
    expect(isValidPosition(walk, at(sequence, step))).toBe(true);
  });

  it.each(unknownSequences)("refuses the sequence %s", (sequence) => {
    expect(isValidPosition(walk, at(sequence, 0))).toBe(false);
  });

  it.each(badSteps)("refuses the step %s in sequence 1", (step) => {
    expect(isValidPosition(walk, at(1, step))).toBe(false);
  });

  it("refuses a step past the end of a shorter sequence", () => {
    expect(isValidPosition(walk, at(2, 2))).toBe(false);
  });
});

describe("move", () => {
  it("steps on and back by one", () => {
    expect(move(walk, at(1, 0), next)).toStrictEqual({
      kind: "moved",
      position: { sequence: 1, step: 1 },
      cause: "next",
    });
    expect(move(walk, at(1, 3), prev)).toStrictEqual({
      kind: "moved",
      position: { sequence: 1, step: 2 },
      cause: "prev",
    });
    expect(move(walk, at(2, 0), next)).toStrictEqual({
      kind: "moved",
      position: { sequence: 2, step: 1 },
      cause: "next",
    });
  });

  it("changes nothing at either bound", () => {
    expect(move(walk, at(1, 0), prev)).toStrictEqual({ kind: "unchanged" });
    expect(move(walk, at(1, 3), next)).toStrictEqual({ kind: "unchanged" });
    expect(move(walk, at(2, 0), prev)).toStrictEqual({ kind: "unchanged" });
    expect(move(walk, at(2, 1), next)).toStrictEqual({ kind: "unchanged" });
  });

  it.each([
    ...unknownSequences.map((sequence) => at(sequence, 0)),
    ...badSteps.map((step) => at(1, step)),
    at(2, 2),
  ])("makes up no position from $sequence, $step", (from) => {
    expect(move(walk, from, prev)).toStrictEqual({ kind: "invalid" });
    expect(move(walk, from, next)).toStrictEqual({ kind: "invalid" });
  });

  it("goes to the Start of a selected sequence", () => {
    expect(move(walk, at(1, 2), select(2))).toStrictEqual({
      kind: "moved",
      position: { sequence: 2, step: 0 },
      cause: "sequence",
    });
  });

  it("counts selecting the current sequence as a switch", () => {
    expect(move(walk, at(1, 0), select(1))).toStrictEqual({
      kind: "moved",
      position: { sequence: 1, step: 0 },
      cause: "sequence",
    });
    expect(move(walk, at(2, 1), select(2))).toStrictEqual({
      kind: "moved",
      position: { sequence: 2, step: 0 },
      cause: "sequence",
    });
  });

  it("reaches one position by two causes", () => {
    const back = move(walk, at(1, 1), prev);
    const reselect = move(walk, at(1, 1), select(1));
    expect(back).toStrictEqual({
      kind: "moved",
      position: { sequence: 1, step: 0 },
      cause: "prev",
    });
    expect(reselect).toStrictEqual({
      kind: "moved",
      position: { sequence: 1, step: 0 },
      cause: "sequence",
    });
  });

  it.each([at(9, 9), at(1, 4), at(1, Number.NaN)])(
    "recovers from $sequence, $step by a selection",
    (from) => {
      expect(move(walk, from, select(1))).toStrictEqual({
        kind: "moved",
        position: { sequence: 1, step: 0 },
        cause: "sequence",
      });
    },
  );

  it.each(unknownSequences)("fails closed on selecting %s", (sequence) => {
    expect(move(walk, at(1, 1), select(sequence))).toStrictEqual({
      kind: "invalid",
    });
  });
});

// Its lookup throws, so a refusal shows the upper bound was checked before any read.
const unreadable: WalkShape = Object.assign(
  [{ steps: ["a"] }, { steps: ["b"] }],
  {
    at: (): never => {
      throw new Error("the walk was read");
    },
  },
);
const pastTheEnd = [3, Number.MAX_SAFE_INTEGER];

describe("the upper bound", () => {
  it("reads the last sequence the walk has", () => {
    expect(() => isValidPosition(unreadable, at(2, 0))).toThrow(
      "the walk was read",
    );
    expect(() => move(unreadable, at(1, 0), select(2))).toThrow(
      "the walk was read",
    );
  });

  it.each(pastTheEnd)("refuses the sequence %s without reading", (sequence) => {
    expect(isValidPosition(unreadable, at(sequence, 0))).toBe(false);
  });

  it.each(pastTheEnd)(
    "fails closed on selecting %s without reading",
    (sequence) => {
      expect(move(unreadable, at(1, 0), select(sequence))).toStrictEqual({
        kind: "invalid",
      });
    },
  );
});
