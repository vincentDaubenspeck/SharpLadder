import type { ReactElement, ReactNode } from "react";
import type { WalkItBlock, WalkSequence } from "../generated/body.ts";
import { SequencePicker } from "./ApproachPicker.tsx";
import type { SlugMap } from "./href.ts";
import { spanText } from "./span-text.ts";
import { Spans } from "./Spans.tsx";
import { isValidPosition, move } from "./walk-position.ts";
import type { WalkPosition, WalkRequest } from "./walk-position.ts";
import { replay } from "./walk-replay.ts";
import type { ReplayState, WalkCell } from "./walk-replay.ts";

/**
 * A move the reader made: the position it leads to and what made it. It is the helper's moved
 * result as is, so it also carries that kind; a consumer reads the position and the cause only.
 */
export interface WalkChange {
  readonly position: WalkPosition;
  readonly cause: WalkRequest["cause"];
}

// The caller owns the position; one the walk does not have shows only the title and the switch,
// never a state rounded into range. The live region stays mounted through every position while
// the stepper does, as a region added with its text already in it may not be read.
export function WalkStepper({
  block,
  position,
  onPositionChange,
  announce,
  slugs,
}: {
  block: WalkItBlock;
  position: WalkPosition;
  onPositionChange: (change: WalkChange) => void;
  announce: boolean;
  slugs: SlugMap;
}): ReactElement {
  const valid = isValidPosition(block.sequences, position);
  const previous = move(block.sequences, position, { cause: "prev" });
  const next = move(block.sequences, position, { cause: "next" });
  return (
    <div id={block.id}>
      <p data-block-id={block.blockId}>
        <Spans spans={block.title} slugs={slugs} />
      </p>
      {block.sequences.length > 1 ? (
        <SequencePicker
          options={block.sequences.map((sequence, index) => ({
            id: index + 1,
            label: sequence.name,
          }))}
          selectedSequence={valid ? position.sequence : null}
          onSequenceChange={(sequence) => {
            const chosen = move(block.sequences, position, {
              cause: "sequence",
              sequence,
            });
            if (chosen.kind === "moved") onPositionChange(chosen);
          }}
        />
      ) : null}
      {valid ? (
        <>
          {block.sequences.map((sequence, index) =>
            index + 1 === position.sequence ? (
              <ActiveSequence
                key={sequence.introBlockId}
                block={block}
                sequence={sequence}
                step={position.step}
                slugs={slugs}
              />
            ) : null,
          )}
          <button
            type="button"
            aria-disabled={previous.kind !== "moved"}
            onClick={() => {
              if (previous.kind === "moved") onPositionChange(previous);
            }}
          >
            Prev
          </button>
          <button
            type="button"
            aria-disabled={next.kind !== "moved"}
            onClick={() => {
              if (next.kind === "moved") onPositionChange(next);
            }}
          >
            Next
          </button>
        </>
      ) : null}
      <p aria-live="polite" aria-atomic="true">
        {valid && announce
          ? block.sequences.map((sequence, index) =>
              index + 1 === position.sequence ? (
                <Announcement
                  key={sequence.introBlockId}
                  sequence={sequence}
                  step={position.step}
                />
              ) : null,
            )
          : null}
      </p>
    </div>
  );
}

// Replayed from the starting cells on every render, so a position reached any way shows alike.
function ActiveSequence({
  block,
  sequence,
  step,
  slugs,
}: {
  block: WalkItBlock;
  sequence: WalkSequence;
  step: number;
  slugs: SlugMap;
}): ReactElement {
  const replayed = replay(block.cells, sequence.steps, step);
  return (
    <>
      {replayed.kind === "state" ? (
        <>
          <p>
            {step === 0 ? (
              "Start"
            ) : (
              <>
                Step {step} of {sequence.steps.length}
              </>
            )}
          </p>
          <CellList state={replayed} />
          {step === 0 ? (
            <p data-block-id={sequence.introBlockId}>
              <Spans spans={sequence.intro} slugs={slugs} />
            </p>
          ) : null}
          {sequence.steps.map((item, index) =>
            index + 1 === step ? (
              <p key={item.blockId} data-block-id={item.blockId}>
                <Spans spans={item.note} slugs={slugs} />
              </p>
            ) : null,
          )}
        </>
      ) : null}
    </>
  );
}

// The caller decides when this is read: after the reader's own Prev or Next only. Text alone, so
// the region never holds a second copy of a link, a Term or its button.
function Announcement({
  sequence,
  step,
}: {
  sequence: WalkSequence;
  step: number;
}): ReactElement {
  return step === 0 ? (
    <>Start: {spanText(sequence.intro)}</>
  ) : (
    <>
      Step {step} of {sequence.steps.length}:{" "}
      {sequence.steps.map((item, index) =>
        index + 1 === step ? spanText(item.note) : null,
      )}
    </>
  );
}

// The cues are words, never colour alone: empty, written, read, and a struck original as lost.
function CellList({ state }: { state: ReplayState }): ReactElement {
  return (
    <ol role="list">
      {state.slots.map((slot, index) => (
        <li
          key={index}
          data-cell={cellState(
            slot.value === null,
            state.last?.src === index,
            state.last?.dst === index,
          )}
        >
          {index}:{" "}
          {slot.struck === undefined ? null : (
            <>
              <s>
                <CellValue value={slot.struck} />
              </s>{" "}
              lost{" "}
            </>
          )}
          <CellValue value={slot.value} />
          {state.last?.dst === index ? " ← written" : null}
          {state.last?.src === index ? " ← read" : null}
        </li>
      ))}
    </ol>
  );
}

// Every state a cell holds, in a fixed order, so a style can mark each one beside its words; a
// cell in none carries no attribute.
function cellState(
  empty: boolean,
  source: boolean,
  destination: boolean,
): string | null {
  const first = empty ? "empty" : null;
  const second = source
    ? first === null
      ? "source"
      : `${first} source`
    : first;
  return destination
    ? second === null
      ? "destination"
      : `${second} destination`
    : second;
}

// Quotes keep a string apart from the number it may spell; null is the spare slot.
function CellValue({ value }: { value: WalkCell }): ReactNode {
  return value === null ? (
    "empty"
  ) : typeof value === "string" ? (
    <>“{value}”</>
  ) : (
    value
  );
}
