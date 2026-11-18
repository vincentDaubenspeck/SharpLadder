import { describe, expect, inject, it } from "vitest";
import {
  replay,
  type ReplayState,
  type WalkCell,
  type WalkStepInput,
} from "../content/walk-replay.ts";

interface Sequence {
  readonly steps: readonly WalkStepInput[];
  readonly states: readonly ReplayState[];
  readonly order?: readonly number[];
}

interface Vector {
  readonly name: string;
  readonly cells: readonly WalkCell[];
  readonly sequences: readonly Sequence[];
}

type Shape = Readonly<Record<string, unknown>>;

const isShape = (value: unknown): value is Shape =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCell = (value: unknown): value is WalkCell =>
  value === null || typeof value === "number" || typeof value === "string";

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

// The object at `where` has every required key, and no key outside required and optional.
function fields(
  value: unknown,
  where: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Shape {
  if (!isShape(value)) throw new Error(`${where} is not an object`);
  const keys = Object.keys(value);
  const missing = required.filter((key) => !keys.includes(key));
  const extra = keys.filter(
    (key) => !required.includes(key) && !optional.includes(key),
  );
  if (missing.length > 0 || extra.length > 0)
    throw new Error(
      `${where} keys: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
    );
  return value;
}

function list<T>(
  value: unknown,
  where: string,
  each: (item: unknown, where: string) => T,
): readonly T[] {
  if (!Array.isArray(value)) throw new Error(`${where} is not an array`);
  return value.map((item, i) => each(item, `${where}[${String(i)}]`));
}

function check<T>(value: unknown, where: string, ok: (v: unknown) => v is T) {
  if (!ok(value)) throw new Error(`${where} is not the expected kind`);
  return value;
}

const isTrue = (value: unknown): value is true => value === true;

function step(value: unknown, where: string): WalkStepInput {
  const copy = isShape(value) && "src" in value;
  const shape = fields(value, where, ["dst", copy ? "src" : "value"], ["lost"]);
  const dst = check(shape["dst"], `${where}.dst`, isIndex);
  const lost =
    "lost" in shape
      ? { lost: check(shape["lost"], `${where}.lost`, isTrue) }
      : {};
  if (copy)
    return { dst, src: check(shape["src"], `${where}.src`, isIndex), ...lost };
  const literal = check(shape["value"], `${where}.value`, isCell);
  if (literal === null) throw new Error(`${where}.value is null`);
  return { dst, value: literal, ...lost };
}

function state(value: unknown, where: string): ReplayState {
  const shape = fields(value, where, ["slots"], ["last"]);
  const slots = list(shape["slots"], `${where}.slots`, (item, at) => {
    const slot = fields(item, at, ["value"], ["struck"]);
    const current = check(slot["value"], `${at}.value`, isCell);
    return "struck" in slot
      ? {
          value: current,
          struck: check(slot["struck"], `${at}.struck`, isCell),
        }
      : { value: current };
  });
  if (!("last" in shape)) return { slots };
  const last = fields(shape["last"], `${where}.last`, ["dst"], ["src"]);
  const dst = check(last["dst"], `${where}.last.dst`, isIndex);
  return "src" in last
    ? {
        slots,
        last: { src: check(last["src"], `${where}.last.src`, isIndex), dst },
      }
    : { slots, last: { dst } };
}

function sequence(value: unknown, where: string): Sequence {
  const shape = fields(value, where, ["steps", "states"], ["order"]);
  const parsed = {
    steps: list(shape["steps"], `${where}.steps`, step),
    states: list(shape["states"], `${where}.states`, state),
  };
  return "order" in shape
    ? {
        ...parsed,
        order: list(shape["order"], `${where}.order`, (n, at) =>
          check(n, at, isIndex),
        ),
      }
    : parsed;
}

// The compiler's tests read the same file and compile every input from source, so each vector
// here is one the compiler accepts; the states in it were worked out by hand.
const vectors: readonly Vector[] = list(
  fields(JSON.parse(inject("walkReplayVectors")), "vectors", ["replays"])[
    "replays"
  ],
  "replays",
  (value, where) => {
    const shape = fields(value, where, ["name", "cells", "sequences"]);
    return {
      name: check(
        shape["name"],
        `${where}.name`,
        (v): v is string => typeof v === "string",
      ),
      cells: list(shape["cells"], `${where}.cells`, (v, at) =>
        check(v, at, isCell),
      ),
      sequences: list(shape["sequences"], `${where}.sequences`, sequence),
    };
  },
);

// Frozen all the way down, so any write to an input throws.
function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

const cases = vectors.flatMap((vector) =>
  vector.sequences.map((s, i) => ({
    title: `${vector.name}, sequence ${String(i + 1)}`,
    cells: frozen(structuredClone(vector.cells)),
    ...s,
    steps: frozen(structuredClone(s.steps)),
  })),
);

// The prefix group already replays every vector in order, so only a stated order is replayed.
const ordered = cases.flatMap(({ order, ...c }) =>
  order === undefined ? [] : [{ ...c, order }],
);

describe("the walk-it replay vectors", () => {
  it("hold every planned vector once, each with a state per prefix", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(21);
    expect(new Set(vectors.map((v) => v.name)).size).toBe(vectors.length);
    for (const c of cases) expect(c.states).toHaveLength(c.steps.length + 1);
    expect(cases.some((c) => c.order !== undefined)).toBe(true);
  });
});

describe("replay", () => {
  it.each(cases)(
    "gives the hand-worked state for each prefix of $title",
    (c) => {
      for (let n = 0; n <= c.steps.length; n++)
        expect(replay(c.cells, c.steps, n)).toStrictEqual({
          kind: "state",
          ...c.states[n],
        });
    },
  );

  it.each(ordered)(
    "recomputes earlier prefixes after the final one of $title",
    (c) => {
      expect(c.order[0]).toBe(c.steps.length);
      for (const n of c.order)
        expect(replay(c.cells, c.steps, n)).toStrictEqual({
          kind: "state",
          ...c.states[n],
        });
    },
  );

  it("leaves an earlier result unchanged by later calls", () => {
    const [c] = cases.filter((k) => k.order !== undefined);
    if (c === undefined) throw new Error("no vector replays out of order");
    const first = replay(c.cells, c.steps, 1);
    const kept = structuredClone(first);
    for (const n of c.states.keys()) replay(c.cells, c.steps, n);
    expect(first).toStrictEqual(kept);
    expect(replay(c.cells, c.steps, 1)).not.toBe(first);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses the prefix %s",
    (n) => {
      const [c] = cases;
      if (c === undefined) throw new Error("no vectors");
      expect(replay(c.cells, c.steps, n)).toStrictEqual({ kind: "invalid" });
    },
  );

  it("refuses one more than the step count", () => {
    const [c] = cases;
    if (c === undefined) throw new Error("no vectors");
    expect(replay(c.cells, c.steps, c.steps.length + 1)).toStrictEqual({
      kind: "invalid",
    });
  });

  it("refuses a step whose cell is not there", () => {
    const cells = frozen([4, "ab"] as const);
    expect(replay(cells, frozen([{ dst: 2, value: 1 }]), 1)).toStrictEqual({
      kind: "invalid",
    });
    expect(replay(cells, frozen([{ dst: 0, src: 2 }]), 1)).toStrictEqual({
      kind: "invalid",
    });
  });

  // Each would reach a real cell by .at or .with if its guard were gone: a negative counts from
  // the end, and a fraction or NaN is read as a whole index.
  const badIndices = [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2];
  const twoCells = frozen([4, "ab"] as const);

  it.each(badIndices)("refuses the destination %s", (dst) => {
    const steps: readonly WalkStepInput[] = [
      { dst, value: 1 },
      { dst, value: 1, lost: true },
      { dst, src: 0 },
      { dst, src: 1, lost: true },
    ];
    for (const step of steps)
      expect(replay(twoCells, frozen([step]), 1)).toStrictEqual({
        kind: "invalid",
      });
  });

  it.each(badIndices)("refuses the source %s", (src) => {
    const steps: readonly WalkStepInput[] = [
      { dst: 0, src },
      { dst: 1, src, lost: true },
    ];
    for (const step of steps)
      expect(replay(twoCells, frozen([step]), 1)).toStrictEqual({
        kind: "invalid",
      });
  });

  it("keeps a bad step invalid through the steps after it", () => {
    const steps = frozen<readonly WalkStepInput[]>([
      { dst: 0, value: 7 },
      { dst: -1, src: 0 },
      { dst: 1, value: 8 },
    ]);
    expect(replay(twoCells, steps, 1)).toStrictEqual({
      kind: "state",
      slots: [{ value: 7 }, { value: "ab" }],
      last: { dst: 0 },
    });
    expect(replay(twoCells, steps, 2)).toStrictEqual({ kind: "invalid" });
    expect(replay(twoCells, steps, 3)).toStrictEqual({ kind: "invalid" });
  });

  it("gives Start for a prefix of 0 even when a later step is bad", () => {
    expect(
      replay(twoCells, frozen([{ dst: Number.NaN, value: 1 }]), 0),
    ).toStrictEqual({ kind: "state", slots: [{ value: 4 }, { value: "ab" }] });
  });
});
