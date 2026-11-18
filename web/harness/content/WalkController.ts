import { useEffect, useState } from "react";
import type {
  WalkControl,
  WalkControlChange,
  WalkShown,
} from "../../src/content/Blocks.tsx";
import type { WalkPosition } from "../../src/content/walk-position.ts";

// The window event a test dispatches to set one walk's position from outside the page.
const outsideMove = "sharpladder-walk-position";

const unmoved: WalkShown = {
  position: { sequence: 1, step: 0 },
  announce: false,
};

interface Held {
  readonly position: WalkPosition;
  readonly cause: WalkControlChange["cause"] | "outside";
}

interface OutsideMove {
  readonly walkId: string;
  readonly sequence: number;
  readonly step: number;
}

function isOutsideMove(detail: unknown): detail is OutsideMove {
  return (
    typeof detail === "object" &&
    detail !== null &&
    "walkId" in detail &&
    typeof detail.walkId === "string" &&
    "sequence" in detail &&
    typeof detail.sequence === "number" &&
    "step" in detail &&
    typeof detail.step === "number"
  );
}

export interface HarnessWalkControl extends WalkControl {
  // Keeps each named walk's position and drops its reading, for a walk whose stepper mounts again.
  readonly quiet: (walkIds: readonly string[]) => void;
}

/**
 * The page's owner of every walk's position and announcement, kept apart by walk id. A walk
 * starts at its first sequence's Start, and only the reader's own Prev and Next are read out:
 * never the first view, a switch, a position set from outside, or a stepper mounted again.
 */
export function useWalkControl(): HarnessWalkControl {
  const [held, setHeld] = useState<ReadonlyMap<string, Held>>(() => new Map());
  useEffect(() => {
    const onOutside = (event: Event): void => {
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : undefined;
      // A malformed move fails the page, so a test cannot pass on a move that never happened.
      if (!isOutsideMove(detail))
        throw new Error(
          "walk harness: an outside move needs a walk id, a sequence and a step",
        );
      // Every outside move replaces the reader's own, even one to the position already shown.
      setHeld((old) =>
        new Map(old).set(detail.walkId, {
          position: { sequence: detail.sequence, step: detail.step },
          cause: "outside",
        }),
      );
    };
    window.addEventListener(outsideMove, onOutside);
    return () => {
      window.removeEventListener(outsideMove, onOutside);
    };
  }, []);
  return {
    shownOf: (walkId) => {
      const one = held.get(walkId);
      return one === undefined
        ? unmoved
        : {
            position: one.position,
            announce: one.cause === "prev" || one.cause === "next",
          };
    },
    onWalkChange: (change) => {
      setHeld((old) =>
        new Map(old).set(change.walkId, {
          position: change.position,
          cause: change.cause,
        }),
      );
    },
    quiet: (walkIds) => {
      setHeld((old) => {
        const quieted = new Map(old);
        for (const walkId of walkIds) {
          const one = old.get(walkId);
          if (one !== undefined)
            quieted.set(walkId, { position: one.position, cause: "outside" });
        }
        return quieted;
      });
    },
  };
}
