/** A place in a walk: sequences are numbered from 1, and step 0 is Start. */
export interface WalkPosition {
  readonly sequence: number;
  readonly step: number;
}

/** The walk's sequences in order; only their step counts matter here. */
export type WalkShape = readonly { readonly steps: readonly unknown[] }[];

/** What the reader asked for: one step back, one step on, or a sequence. */
export type WalkRequest =
  | { readonly cause: "prev" }
  | { readonly cause: "next" }
  | { readonly cause: "sequence"; readonly sequence: number };

type WalkMove =
  | {
      readonly kind: "moved";
      readonly position: WalkPosition;
      readonly cause: WalkRequest["cause"];
    }
  | { readonly kind: "unchanged" }
  | { readonly kind: "invalid" };

const invalid: WalkMove = { kind: "invalid" };

// The step count of a sequence the walk has, or null; nothing is rounded into range.
function stepCount(walk: WalkShape, sequence: number): number | null {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > walk.length)
    return null;
  return walk.at(sequence - 1)?.steps.length ?? null;
}

/** Whether the walk has this sequence and the sequence has this step. */
export function isValidPosition(walk: WalkShape, at: WalkPosition): boolean {
  const steps = stepCount(walk, at.sequence);
  return (
    steps !== null &&
    Number.isInteger(at.step) &&
    at.step >= 0 &&
    at.step <= steps
  );
}

/**
 * The position a request leads to, with its cause. Prev and Next need a valid position and stop
 * at the bounds with no change; a sequence goes to its Start from anywhere, the current one too.
 */
export function move(
  walk: WalkShape,
  at: WalkPosition,
  request: WalkRequest,
): WalkMove {
  if (request.cause === "sequence")
    return stepCount(walk, request.sequence) === null
      ? invalid
      : {
          kind: "moved",
          position: { sequence: request.sequence, step: 0 },
          cause: "sequence",
        };
  if (!isValidPosition(walk, at)) return invalid;
  const to = {
    sequence: at.sequence,
    step: at.step + (request.cause === "next" ? 1 : -1),
  };
  return isValidPosition(walk, to)
    ? { kind: "moved", position: to, cause: request.cause }
    : { kind: "unchanged" };
}
