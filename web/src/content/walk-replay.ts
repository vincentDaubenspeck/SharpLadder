/** A cell's value. Null, 0 and the empty string are three different values. */
export type WalkCell = number | string | null;

interface CopyInput {
  readonly dst: number;
  readonly src: number;
  readonly lost?: true;
}

interface WriteInput {
  readonly dst: number;
  readonly value: number | string;
  readonly lost?: true;
}

/** One step of a compiler-accepted sequence: a copy from cell src or a write of a literal. */
export type WalkStepInput = CopyInput | WriteInput;

interface ReplaySlot {
  readonly value: WalkCell;
  /** What the cell held just before its first write marked lost. */
  readonly struck?: WalkCell;
}

interface ReplayLast {
  /** Absent when the step wrote a literal. */
  readonly src?: number;
  readonly dst: number;
}

/** The cells after a prefix of the steps, and the last step applied; Start has none. */
export interface ReplayState {
  readonly slots: readonly ReplaySlot[];
  readonly last?: ReplayLast;
}

type ReplayResult =
  ({ readonly kind: "state" } & ReplayState) | { readonly kind: "invalid" };

const invalid: ReplayResult = { kind: "invalid" };

// The slot at a whole index inside the cells, or undefined; .at alone would count a negative
// index from the end and read a fraction or NaN as a whole index.
function slotAt(
  slots: readonly ReplaySlot[],
  index: number,
): ReplaySlot | undefined {
  return Number.isInteger(index) && index >= 0 && index < slots.length
    ? slots.at(index)
    : undefined;
}

// What a step writes and the last step it leaves, or undefined when its source cell is not there.
function sourceOf(
  slots: readonly ReplaySlot[],
  step: WalkStepInput,
): { readonly value: WalkCell; readonly last: ReplayLast } | undefined {
  if (!("src" in step)) return { value: step.value, last: { dst: step.dst } };
  const from = slotAt(slots, step.src);
  // The copy takes the value alone; a strike stays with the cell it was made in.
  return from === undefined
    ? undefined
    : { value: from.value, last: { src: step.src, dst: step.dst } };
}

// Applies one step; an invalid state stays invalid, and nothing is written in place.
function applyStep(state: ReplayResult, step: WalkStepInput): ReplayResult {
  if (state.kind === "invalid") return state;
  const before = slotAt(state.slots, step.dst);
  const source = sourceOf(state.slots, step);
  if (before === undefined || source === undefined) return invalid;
  // The first strike stays; null is a struck value too, so only undefined means none.
  const slot: ReplaySlot =
    before.struck !== undefined
      ? { value: source.value, struck: before.struck }
      : step.lost === true
        ? { value: source.value, struck: before.value }
        : { value: source.value };
  return {
    kind: "state",
    slots: state.slots.with(step.dst, slot),
    last: source.last,
  };
}

/**
 * Replays the first `prefix` steps from the starting cells, afresh on every call. A prefix that
 * is not a whole number from 0 to the step count, or a step whose cell is not there, gives the
 * invalid result; nothing is rounded into range.
 */
export function replay(
  cells: readonly WalkCell[],
  steps: readonly WalkStepInput[],
  prefix: number,
): ReplayResult {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > steps.length)
    return invalid;
  const start: ReplayResult = {
    kind: "state",
    slots: cells.map((value) => ({ value })),
  };
  // Spread first: reduce skips a hole, and a skipped step would be a silently shorter replay.
  return [...steps.slice(0, prefix)].reduce(applyStep, start);
}
