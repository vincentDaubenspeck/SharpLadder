import type { Segment } from "../generated/body.ts";
import type { CatalogueLadder, HintsCatalogue } from "../generated/content.ts";

/** What the hint picker shows for one ladder: its position and a neutral label, never its id. */
export interface HintOption {
  readonly id: number;
  readonly label: string;
}

/** The public cue of the selected ladder: the ladder's id, the cue's block id and its text. */
export interface SelectedCue {
  readonly id: string;
  readonly blockId: string;
  readonly cue: string;
}

// Written by hand from the generated types; the closed schema beside the tests and checkedHintsView
// hold its promise that it carries no cue, and speaks none, but the selected ladder's, in its shape
// and by the selector having issued it.
export interface HintsView {
  readonly type: "hints-view";
  readonly options: readonly HintOption[];
  readonly selectedIndex: number | null;
  readonly selected?: SelectedCue;
  readonly segments: readonly Segment[];
}

/** The caller's handler, given the position of the option chosen. */
export type HintChange = (index: number) => void;

// One letter per position, so a label says nothing about the technique behind it.
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const labelOf = (index: number): string => `Approach ${letters.charAt(index)}`;

// Shape alone cannot tell one ladder's id, cue or speech from another's, so only a view the
// selector issued renders, frozen through so that nothing changes it after.
const issued = new WeakSet<HintsView>();

function issue(view: HintsView): HintsView {
  issued.add(Object.freeze(view));
  return view;
}

// A copy, so the frozen view shares no object with the catalogue.
const segmentOf = (segment: Segment): Segment =>
  Object.freeze({
    target: Object.freeze({ ...segment.target }),
    text: segment.text,
  });

function ladderOf(catalogue: HintsCatalogue, id: string): CatalogueLadder {
  const ladder = catalogue.ladders.find((l) => l.id === id);
  if (ladder === undefined)
    throw new Error(
      `the hints catalogue holds no ladder ${JSON.stringify(id)}`,
    );
  return ladder;
}

/**
 * The view of the ladders the caller names, in the caller's order, under one selection by ladder
 * id: a label for each, and the cue and speech of the selected ladder alone.
 */
export function selectHints(
  catalogue: HintsCatalogue,
  references: readonly string[],
  selected: string | null,
): HintsView {
  const type: unknown = catalogue.type;
  if (type !== "hints-catalogue")
    throw new Error("only a hints catalogue has a hints view");
  if (references.length === 0 || references.length > letters.length)
    throw new Error(
      `a hints view names 1 to ${String(letters.length)} ladders`,
    );
  if (new Set(references).size !== references.length)
    throw new Error("a hints view names a ladder twice");
  const ladders = references.map((id) => ladderOf(catalogue, id));
  const options = Object.freeze(
    ladders.map((_, index): HintOption =>
      Object.freeze({
        id: index,
        label: labelOf(index),
      }),
    ),
  );
  // A lone ladder needs no choice; an id that names none of the ladders selects nothing.
  const index =
    selected === null
      ? ladders.length === 1
        ? 0
        : -1
      : references.indexOf(selected);
  const ladder = ladders.find((_, at) => at === index);
  if (ladder === undefined)
    return issue({
      type: "hints-view",
      options,
      selectedIndex: null,
      segments: Object.freeze([]),
    });
  return issue({
    type: "hints-view",
    options,
    selectedIndex: index,
    selected: Object.freeze({
      id: ladder.id,
      blockId: ladder.cue.blockId,
      cue: ladder.cue.text,
    }),
    segments: Object.freeze(ladder.spoken.segments.map(segmentOf)),
  });
}

/**
 * The view itself, or an error when it is no hints view, its parts disagree or the selector did not
 * issue it.
 */
export function checkedHintsView(view: HintsView): HintsView {
  const type: unknown = view.type;
  if (type !== "hints-view")
    throw new Error("the hints view takes only a selected hints view");
  if (
    !view.options.every(
      (option, at) => option.id === at && option.label === labelOf(at),
    )
  )
    throw new Error("a hints view labels its options by position alone");
  const { selected, selectedIndex } = view;
  if (
    (selected === undefined) !== (selectedIndex === null) ||
    (selectedIndex !== null &&
      !view.options.some((option) => option.id === selectedIndex))
  )
    throw new Error("a hints view shows a cue exactly when it selects one");
  if (
    (selected === undefined) !== (view.segments.length === 0) ||
    !view.segments.every(
      (s) =>
        s.target.type === "block" && s.target.blockId === selected?.blockId,
    )
  )
    throw new Error("a hints view speaks the selected cue alone");
  if (!issued.has(view))
    throw new Error("a hints view renders only as the selector issued it");
  return view;
}
