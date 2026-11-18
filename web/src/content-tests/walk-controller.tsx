import { useState } from "react";
import type { ReactElement } from "react";
import type { WalkItBlock } from "../generated/body.ts";
import type { SlugMap } from "../content/href.ts";
import type { WalkPosition } from "../content/walk-position.ts";
import { WalkStepper } from "../content/WalkStepper.tsx";
import type { WalkChange } from "../content/WalkStepper.tsx";

// Kept with the outside position it was made from, so a newer one from outside wins over it.
interface OwnMove {
  readonly from: WalkPosition;
  readonly change: WalkChange;
}

interface Shown {
  readonly position: WalkPosition;
  readonly cause: WalkChange["cause"] | "outside";
}

/**
 * A test owner of one stepper's position and announcement. A new position object from outside
 * replaces the reader's moves and is never read out; only the reader's own Prev and Next are.
 */
export function WalkController({
  block,
  position,
  slugs,
}: {
  block: WalkItBlock;
  position: WalkPosition;
  slugs: SlugMap;
}): ReactElement {
  const [own, setOwn] = useState<OwnMove | null>(null);
  const shown: Shown =
    own !== null && own.from === position
      ? own.change
      : { position, cause: "outside" };
  return (
    <WalkStepper
      block={block}
      position={shown.position}
      onPositionChange={(change) => {
        setOwn({ from: position, change });
      }}
      announce={shown.cause === "prev" || shown.cause === "next"}
      slugs={slugs}
    />
  );
}
