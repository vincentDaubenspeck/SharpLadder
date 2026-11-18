import { render, screen } from "@testing-library/react";
import { describe, expect, inject, it } from "vitest";
import type {
  Block,
  LinkSpan,
  ListItem,
  Span,
  TermSpan,
  WalkItBlock,
} from "../generated/body.ts";
import type {
  Card,
  CardsSection,
  ChapterSection,
  ContentDoc,
  DrillSection,
  HintsCatalogue,
  HintsPart,
  PartSection,
} from "../generated/content.ts";
import { witness as build } from "../generated/witness/chapters/fixture-basics/build.ts";
import { witness as cards } from "../generated/witness/chapters/fixture-basics/cards.ts";
import { witness as basics } from "../generated/witness/chapters/fixture-basics/chapter.ts";
import { witness as drill } from "../generated/witness/chapters/fixture-basics/drill.ts";
import { witness as gotchas } from "../generated/witness/chapters/fixture-basics/gotchas.ts";
import { witness as idioms } from "../generated/witness/chapters/fixture-basics/idioms.ts";
import { witness as library } from "../generated/witness/chapters/fixture-basics/library.ts";
import { witness as syntax } from "../generated/witness/chapters/fixture-basics/syntax.ts";
import { witness as emptyIntro } from "../generated/witness/chapters/fixture-empty-intro/chapter.ts";
import { witness as noSections } from "../generated/witness/chapters/fixture-no-sections/chapter.ts";
import { witness as second } from "../generated/witness/chapters/fixture-second/chapter.ts";
import { witness as unassigned } from "../generated/witness/errors/err-fixture-cs0165.ts";
import { witness as nullCall } from "../generated/witness/errors/err-fixture-null.ts";
import { witness as offByOne } from "../generated/witness/errors/err-fixture-off-by-one.ts";
import { witness as loopTerm } from "../generated/witness/glossary/term-fixture-loop.ts";
import { witness as setTerm } from "../generated/witness/glossary/term-fixture-set.ts";
import { projectBuild } from "./approach.ts";
import type {
  ApproachSelection,
  BuildView,
  BuildViewSection,
  SelectedApproach,
  StaticDoc,
} from "./approach.ts";
import type { WalkControl } from "./Blocks.tsx";
import { BuildPartView } from "./Build.tsx";
import { ContentView } from "./ContentView.tsx";
import { buildSlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";
import { isValidPosition } from "./walk-position.ts";
import type { WalkPosition } from "./walk-position.ts";
import { replay } from "./walk-replay.ts";
import type { WalkCell } from "./walk-replay.ts";

// Hints are shown only through their own view, so they never make this round trip.
type RoundTripDoc = Exclude<ContentDoc, HintsPart | HintsCatalogue>;

// Each compiled record path with the witness emitted from the same validated bytes.
const witnesses = new Map<string, RoundTripDoc>([
  ["compiled/chapters/fixture-basics/build.json", build],
  ["compiled/chapters/fixture-basics/cards.json", cards],
  ["compiled/chapters/fixture-basics/chapter.json", basics],
  ["compiled/chapters/fixture-basics/drill.json", drill],
  ["compiled/chapters/fixture-basics/gotchas.json", gotchas],
  ["compiled/chapters/fixture-basics/idioms.json", idioms],
  ["compiled/chapters/fixture-basics/library.json", library],
  ["compiled/chapters/fixture-basics/syntax.json", syntax],
  ["compiled/chapters/fixture-empty-intro/chapter.json", emptyIntro],
  ["compiled/chapters/fixture-no-sections/chapter.json", noSections],
  ["compiled/chapters/fixture-second/chapter.json", second],
  ["compiled/errors/err-fixture-cs0165.json", unassigned],
  ["compiled/errors/err-fixture-null.json", nullCall],
  ["compiled/errors/err-fixture-off-by-one.json", offByOne],
  ["compiled/glossary/term-fixture-loop.json", loopTerm],
  ["compiled/glossary/term-fixture-set.json", setTerm],
]);

// Records come only from the compiler-backed global setup; without them this file fails to
// load, so no case is skipped into a pass and none is built from a fallback.
function provided(value: unknown): readonly {
  path: string;
  kind: string;
  part: string | null;
  text: string;
}[] {
  const isRecord = (
    r: unknown,
  ): r is { path: string; kind: string; part: string | null; text: string } =>
    typeof r === "object" &&
    r !== null &&
    "path" in r &&
    typeof r.path === "string" &&
    "kind" in r &&
    typeof r.kind === "string" &&
    "part" in r &&
    (r.part === null || typeof r.part === "string") &&
    "text" in r &&
    typeof r.text === "string";
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("the global setup provided no content records");
  const entries: unknown[] = value;
  if (!entries.every(isRecord))
    throw new Error("the global setup provided a malformed content record");
  return entries;
}

// The registries have no view, and hints are shown only through their own view in
// content-tests/hints.test.tsx, so every other record makes the round trip.
const records = provided(inject("contentRecords")).filter(
  (r) =>
    r.kind !== "aliases" &&
    r.kind !== "patterns" &&
    r.kind !== "hints-catalogue" &&
    r.part !== "hints",
);
const slugs = buildSlugMap([basics, emptyIntro, noSections, second]);

function witnessOf(path: string): RoundTripDoc {
  const witness = witnesses.get(path);
  if (witness === undefined) throw new Error(`no witness for ${path}`);
  return witness;
}

function textOf(path: string): string {
  const record = records.find((r) => r.path === path);
  if (record === undefined) throw new Error(`no record for ${path}`);
  return record.text;
}

// What reaches the renderer: a build part only as its projection under one selection.
type ShownDoc = StaticDoc | BuildView;

const nothing: ApproachSelection = new Map<string, string>();

// A build part is shown with nothing selected, then with each approach position in every section.
function selectionsOf(doc: RoundTripDoc): ApproachSelection[] {
  if (doc.type !== "part" || doc.kind !== "build") return [nothing];
  const most = Math.max(
    0,
    ...doc.sections.map((s) => s.approaches?.length ?? 0),
  );
  const at = (index: number): ApproachSelection =>
    new Map(
      doc.sections.flatMap((s): [string, string][] => {
        const approach = s.approaches?.[index];
        return approach === undefined ? [] : [[s.id, approach.id]];
      }),
    );
  return [nothing, ...Array.from({ length: most }, (_, index) => at(index))];
}

const shownOf = (doc: RoundTripDoc, selection: ApproachSelection): ShownDoc =>
  doc.type === "part" && doc.kind === "build"
    ? projectBuild(doc, selection)
    : doc;

// The test's own controller: it holds no state, so a view shows exactly the selection and walk
// positions it was given.
function Shown({
  doc,
  walkControl,
}: {
  doc: ShownDoc;
  walkControl?: WalkControl | undefined;
}) {
  return doc.type === "build-view" ? (
    <BuildPartView
      view={doc}
      slugs={slugs}
      onApproachChange={() => undefined}
      walkControl={walkControl}
    />
  ) : (
    <ContentView doc={doc} slugs={slugs} walkControl={walkControl} />
  );
}

const show = (doc: RoundTripDoc, selection: ApproachSelection = nothing) =>
  render(<Shown doc={shownOf(doc, selection)} />);

// Rendering happens only after the parsed bytes equal the witness, missing properties included.
function roundTrip(
  text: string,
  witness: RoundTripDoc,
  check: (
    container: HTMLElement,
    shown: ShownDoc,
    selection: ApproachSelection,
  ) => void = () => undefined,
): void {
  const parsed: unknown = JSON.parse(text);
  expect(parsed).toStrictEqual(witness);
  for (const selection of selectionsOf(witness)) {
    const { container, unmount } = show(witness, selection);
    check(container, shownOf(witness, selection), selection);
    unmount();
  }
}

// An entry has no sections: its heading is the renderer's and its body has no audio slot.
type AnySection =
  ChapterSection | PartSection | CardsSection | DrillSection | BuildViewSection;

const sectionsOf = (doc: ShownDoc): AnySection[] =>
  doc.type === "chapter" || doc.type === "part" || doc.type === "build-view"
    ? [...doc.sections]
    : [];

const selectedOf = (section: AnySection): SelectedApproach | undefined =>
  "options" in section ? section.selected : undefined;

// Where each walk stands; the static view and a walk a state does not name are at Start.
type At = (walkId: string) => WalkPosition;
const start: WalkPosition = { sequence: 1, step: 0 };
const atStart: At = () => start;

// The one target a walk shows at a position: its sequence's intro at Start, else that step's note.
function activeOf(
  walk: WalkItBlock,
  position: WalkPosition,
): { blockId: string; spans: readonly Span[] } {
  const sequence = walk.sequences[position.sequence - 1];
  if (sequence === undefined || !isValidPosition(walk.sequences, position))
    throw new Error(
      `${walk.id} has no position ${String(position.sequence)}.${String(position.step)}`,
    );
  const step = sequence.steps[position.step - 1];
  return step === undefined
    ? { blockId: sequence.introBlockId, spans: sequence.intro }
    : { blockId: step.blockId, spans: step.note };
}

// The hook ids a run of blocks renders: each block's own, each list item's and each walk's
// active target.
const hookIds = (blocks: readonly Block[], at: At = atStart): string[] =>
  blocks.flatMap((b) => [
    b.blockId,
    ...(b.type === "list" ? b.items.map((i) => i.blockId) : []),
    ...(b.type === "walk-it" ? [activeOf(b, at(b.id)).blockId] : []),
  ]);

const walksOf = (blocks: readonly Block[]): WalkItBlock[] =>
  blocks.flatMap((b) => (b.type === "walk-it" ? [b] : []));

// The targets a walk leaves out at its position: every intro and step note but the active one.
const inactiveHookIds = (
  blocks: readonly Block[],
  at: At = atStart,
): string[] =>
  walksOf(blocks).flatMap((w) =>
    w.sequences
      .flatMap((s) => [s.introBlockId, ...s.steps.map((step) => step.blockId)])
      .filter((id) => id !== activeOf(w, at(w.id)).blockId),
  );

// The fields a card shows, each with its label, in the one order a card is read.
const cardFields = (card: Card): [string, Block[]][] => [
  ["Reach for", [card.reach]],
  ["Build", [card.build]],
  ["Why", [...card.why]],
  ...(card.traps === undefined
    ? []
    : [["Traps", [card.traps]] as [string, Block[]]]),
  ...(card.also === undefined
    ? []
    : [["Also", [card.also]] as [string, Block[]]]),
];

const cardBlocks = (card: Card): Block[] =>
  cardFields(card).flatMap(([, blocks]) => blocks);

const cardsOf = (doc: ShownDoc): Card[] =>
  sectionsOf(doc).flatMap((s) => ("cards" in s ? s.cards : []));

// A drill list shows each label as plain text in an ordered list, so it is checked as one.
const drillBlocks = (section: AnySection): Block[] => {
  if (!("drills" in section)) return [];
  const [first, ...rest] = section.drills.items;
  const item = (drill: typeof first): ListItem => ({
    blockId: drill.blockId,
    content: [{ type: "text", text: drill.label }],
  });
  return [
    {
      type: "list",
      blockId: section.drills.blockId,
      ordered: true,
      items: [item(first), ...rest.map(item)],
    },
  ];
};

const sectionBlocks = (section: AnySection): Block[] =>
  "cards" in section
    ? section.cards.flatMap(cardBlocks)
    : [
        ...section.body,
        ...drillBlocks(section),
        ...(selectedOf(section)?.body ?? []),
      ];

const blocksOf = (doc: ShownDoc): Block[] => {
  switch (doc.type) {
    case "chapter":
      return [...doc.intro, ...doc.sections.flatMap((s) => s.body)];
    case "part":
    case "build-view":
      return sectionsOf(doc).flatMap(sectionBlocks);
    case "glossary":
      return [...doc.body];
    case "error":
      return [...doc.cause, ...doc.hint];
  }
};

const entryIdOf = (doc: ShownDoc): string[] =>
  doc.type === "glossary" || doc.type === "error" ? [doc.id] : [];

// The ids the renderer may write as anchors: entry, section, card and shown approach ids, code
// or text block ids and walk ids.
const anchorsOf = (doc: ShownDoc): string[] => [
  ...entryIdOf(doc),
  ...sectionsOf(doc).map((s) => s.id),
  ...sectionsOf(doc).flatMap((s) => selectedOf(s)?.id ?? []),
  ...cardsOf(doc).map((c) => c.id),
  ...blocksOf(doc).flatMap((b) =>
    (b.type === "code" || b.type === "text") && b.id !== undefined
      ? [b.id]
      : [],
  ),
  ...walksOf(blocksOf(doc)).map((w) => w.id),
];

const spansOf = (spans: readonly Span[]): Span[] =>
  spans.flatMap((s) =>
    s.type === "em" || s.type === "strong" ? [s, ...spansOf(s.content)] : [s],
  );

const blockSpans = (b: Block, at: At = atStart): Span[] => {
  if (b.type === "paragraph") return [...b.content];
  if (b.type === "list") return b.items.flatMap((i) => i.content);
  if (b.type === "table") return [b.headers, ...b.rows].flat(2);
  if (b.type === "walk-it") return [...b.title, ...activeOf(b, at(b.id)).spans];
  return [];
};

// Every span in the order it is rendered: a title before what stands under it.
const spansInOrder = (doc: ShownDoc, at: At = atStart): Span[] => {
  const spansOfBlock = (b: Block) => blockSpans(b, at);
  const sections = sectionsOf(doc).flatMap((s) => [
    ...s.title,
    ...("cards" in s
      ? s.cards.flatMap((c) => [
          ...c.title,
          ...cardBlocks(c).flatMap(spansOfBlock),
        ])
      : s.body.flatMap(spansOfBlock)),
    ...(selectedOf(s)?.title ?? []),
    ...(selectedOf(s)?.body.flatMap(spansOfBlock) ?? []),
  ]);
  switch (doc.type) {
    case "chapter":
      return [...doc.intro.flatMap(spansOfBlock), ...sections];
    case "part":
    case "build-view":
      return sections;
    case "glossary":
    case "error":
      return blocksOf(doc).flatMap(spansOfBlock);
  }
};

const linksOf = (doc: ShownDoc, at: At = atStart): LinkSpan[] =>
  spansOf(spansInOrder(doc, at)).flatMap((s) => (s.type === "link" ? [s] : []));

const termsOf = (doc: ShownDoc, at: At = atStart): TermSpan[] =>
  spansOf(spansInOrder(doc, at)).flatMap((s) => (s.type === "term" ? [s] : []));

// Every href a view renders, in reading order; a Term's definition link follows its button.
const hrefsOf = (doc: ShownDoc, at: At = atStart): string[] =>
  spansOf(spansInOrder(doc, at)).flatMap((s) => {
    if (s.type === "term") return [`/glossary#${s.id}`];
    if (s.type !== "link") return [];
    if (s.kind === "error") return [`/errors#${s.id}`];
    return s.chapter === undefined
      ? [`#${s.id}`]
      : [`/chapters/${String(slugs.slugOf(s.chapter))}#${s.id}`];
  });

// What a reader sees before opening anything: a closed Term definition is left out.
const shownText = (node: Node): string =>
  node instanceof Element && node.hasAttribute("popover")
    ? ""
    : node.nodeType === Node.TEXT_NODE
      ? (node.textContent ?? "")
      : [...node.childNodes].map(shownText).join("");

// The visible text a run of spans renders, nested emphasis included.
const spansText = (spans: readonly Span[]): string =>
  spans
    .map((s) =>
      s.type === "text" || s.type === "code" ? s.text : spansText(s.content),
    )
    .join("");

// The elements carrying a hook attribute with exactly this value, compared as plain strings.
const hooked = (container: Element, attribute: string, value: string) =>
  [...container.querySelectorAll(`[${attribute}]`)].filter(
    (e) => e.getAttribute(attribute) === value,
  );

// The hooks of every approach the selection leaves out: spoken always, rendered never.
const unselectedHooks = (
  doc: RoundTripDoc,
  selection: ApproachSelection,
): Set<string> =>
  new Set(
    doc.type === "part" && doc.kind === "build"
      ? doc.sections.flatMap((s) =>
          (s.approaches ?? [])
            .filter((a) => a.id !== selection.get(s.id))
            .flatMap((a) => [...hookIds(a.body), ...inactiveHookIds(a.body)]),
        )
      : [],
  );

const speechSections = (doc: RoundTripDoc) =>
  doc.type === "chapter" || doc.type === "part" ? [...doc.sections] : [];

/**
 * What a rendered record fails to prove about its speech: every segment bound to exactly one
 * rendered hook inside its section, in reading order, and a segment of an unselected approach
 * or of a walk target its position leaves out to none. A skipped section holds its one summary
 * and nothing else.
 */
function speechProblems(
  container: Element,
  doc: RoundTripDoc,
  selection: ApproachSelection = nothing,
  at: At = atStart,
): string[] {
  const problems: string[] = [];
  const unselected = unselectedHooks(doc, selection);
  const inactive = new Set(
    inactiveHookIds(blocksOf(shownOf(doc, selection)), at),
  );
  const all = [...container.querySelectorAll("[data-block-id]")].map((e) =>
    e.getAttribute("data-block-id"),
  );
  if (new Set(all).size !== all.length)
    problems.push("a block hook is rendered more than once");
  for (const section of speechSections(doc)) {
    const { segments } = section.spoken;
    const at = `section ${section.id}`;
    const roots = hooked(container, "data-section-id", section.id);
    const [root] = roots;
    if (root === undefined || roots.length !== 1) {
      problems.push(`${at}: ${String(roots.length)} section hooks`);
      continue;
    }
    const summaries = segments.filter((s) => s.target.type === "section");
    if (summaries.length > 0 && segments.length !== 1)
      problems.push(`${at}: a summary stands beside other segments`);
    let previous: Element | undefined;
    for (const { target } of segments) {
      if (target.type === "section") {
        if (target.sectionId !== section.id)
          problems.push(`${at}: a summary targets ${target.sectionId}`);
        continue;
      }
      const found = hooked(container, "data-block-id", target.blockId);
      const [element] = found;
      if (unselected.has(target.blockId)) {
        if (found.length !== 0)
          problems.push(`${at}: ${target.blockId} is shown unselected`);
        continue;
      }
      if (inactive.has(target.blockId)) {
        if (found.length !== 0)
          problems.push(`${at}: ${target.blockId} is shown while inactive`);
        continue;
      }
      if (element === undefined || found.length !== 1) {
        problems.push(
          `${at}: ${target.blockId} resolves to ${String(found.length)} hooks`,
        );
        continue;
      }
      if (!root.contains(element))
        problems.push(`${at}: ${target.blockId} is rendered outside it`);
      const follows = Node.DOCUMENT_POSITION_FOLLOWING;
      if (
        previous !== undefined &&
        (previous.compareDocumentPosition(element) & follows) === 0
      )
        problems.push(`${at}: ${target.blockId} is out of reading order`);
      previous = element;
    }
  }
  return problems;
}

// The hosting page owns h1, so rendered content starts at h2 and steps down one level at most.
function headingProblems(container: Element): string[] {
  const problems: string[] = [];
  let previous = 1;
  for (const heading of container.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const level = Number(heading.tagName.slice(1));
    if (level === 1) problems.push("h1 is the hosting page's");
    else if (level > previous + 1)
      problems.push(`h${String(level)} skips a level`);
    previous = level;
  }
  return problems;
}

// Every walk a record holds, found by its shape, so a host the oracle does not model still counts.
const isWalk = (value: object): value is WalkItBlock =>
  "type" in value && value.type === "walk-it";
const walksIn = (value: unknown): WalkItBlock[] => {
  if (Array.isArray(value)) return value.flatMap(walksIn);
  if (typeof value !== "object" || value === null) return [];
  return [
    ...(isWalk(value) ? [value] : []),
    ...Object.values(value).flatMap(walksIn),
  ];
};

// Every place a walk can stand, in the order a reader reaches them.
const positionsOf = (walk: WalkItBlock): WalkPosition[] =>
  walk.sequences.flatMap((sequence, index) =>
    Array.from({ length: sequence.steps.length + 1 }, (_, step) => ({
      sequence: index + 1,
      step,
    })),
  );

// The selections that matter to a walk: its approach picked, then a sibling or nothing in its
// place; a walk outside every approach is shown with nothing picked.
function selectionsFor(
  doc: RoundTripDoc,
  walk: WalkItBlock,
): ApproachSelection[] {
  if (doc.type !== "part" || doc.kind !== "build") return [nothing];
  for (const section of doc.sections) {
    const approaches = section.approaches ?? [];
    const holder = approaches.find((a) =>
      walksIn(a.body).some((w) => w.id === walk.id),
    );
    if (holder === undefined) continue;
    const sibling = approaches.find((a) => a !== holder);
    return [
      new Map([[section.id, holder.id]]),
      sibling === undefined ? nothing : new Map([[section.id, sibling.id]]),
    ];
  }
  return [nothing];
}

/** One rendered state: the approach selection and the walks it moves away from Start. */
interface WalkState {
  readonly selection: ApproachSelection;
  readonly positions: ReadonlyMap<string, WalkPosition>;
}

const atOf =
  (state: WalkState): At =>
  (walkId) =>
    state.positions.get(walkId) ?? start;

/**
 * The states a record is shown in with a walk control: each walk at every position under each
 * selection that matters to it while the others stay at Start, then every walk at once, each at
 * another place from its end. A record without a walk is shown once.
 */
function walkStatesOf(doc: RoundTripDoc): WalkState[] {
  const walks = walksIn(doc);
  if (walks.length === 0) return [{ selection: nothing, positions: new Map() }];
  const visits = walks.flatMap((walk) =>
    selectionsFor(doc, walk).flatMap((selection) =>
      positionsOf(walk).map((position) => ({
        selection,
        positions: new Map([[walk.id, position]]),
      })),
    ),
  );
  if (walks.length === 1) return visits;
  const mixed: WalkState = {
    selection: new Map(
      walks.flatMap((walk) => [...(selectionsFor(doc, walk)[0] ?? nothing)]),
    ),
    positions: new Map(
      walks.map((walk, index) => {
        const all = positionsOf(walk);
        return [walk.id, all[all.length - 1 - (index % all.length)] ?? start];
      }),
    ),
  };
  return [...visits, mixed];
}

// The control a state hands the views: its positions, each announced as after the reader's move.
const controlOf = (state: WalkState): WalkControl => ({
  shownOf: (walkId) => ({ position: atOf(state)(walkId), announce: true }),
  onWalkChange: () => undefined,
});

// Successive states rerender one mounted view, as a reader's moves do. What is expected is read
// from the witness apart from what the renderer is handed.
function walkRoundTrip(
  text: string,
  witness: RoundTripDoc,
  check: (container: HTMLElement, state: WalkState) => void,
): void {
  const parsed: unknown = JSON.parse(text);
  expect(parsed).toStrictEqual(witness);
  const view = (state: WalkState) => (
    <Shown
      doc={shownOf(witness, state.selection)}
      walkControl={controlOf(state)}
    />
  );
  const [first, ...rest] = walkStatesOf(witness);
  if (first === undefined) throw new Error("a record with no state to show");
  const { container, rerender, unmount } = render(view(first));
  check(container, first);
  for (const state of rest) {
    rerender(view(state));
    check(container, state);
  }
  unmount();
}

// A cell value as a walk shows it: quotes keep a string apart from a number, and null is empty.
const cellValue = (value: WalkCell): string =>
  value === null
    ? "empty"
    : typeof value === "string"
      ? `“${value}”`
      : String(value);

// The cells a walk shows at a position, replayed from its starting cells.
function cellsOf(
  walk: WalkItBlock,
  position: WalkPosition,
): { text: string; struck: string; states: string | null }[] {
  const sequence = walk.sequences[position.sequence - 1];
  const state =
    sequence === undefined
      ? undefined
      : replay(walk.cells, sequence.steps, position.step);
  if (state?.kind !== "state")
    throw new Error(`${walk.id} does not replay to its position`);
  return state.slots.map((slot, index) => {
    const struck = slot.struck === undefined ? "" : cellValue(slot.struck);
    const marks = [
      ...(state.last?.dst === index ? [" ← written"] : []),
      ...(state.last?.src === index ? [" ← read"] : []),
    ].join("");
    const states = [
      ...(slot.value === null ? ["empty"] : []),
      ...(state.last?.src === index ? ["source"] : []),
      ...(state.last?.dst === index ? ["destination"] : []),
    ];
    return {
      text: `${String(index)}: ${struck === "" ? "" : `${struck} lost `}${cellValue(slot.value)}${marks}`,
      struck,
      states: states.length === 0 ? null : states.join(" "),
    };
  });
}

/**
 * What a rendered state fails to show of its walks: each shown walk once under its anchor, with
 * the hooks, status, cells, sequence and announcement of its own position and nothing else
 * hooked, and no anchor or hook of a walk whose approach is not picked.
 */
function walkProblems(
  container: Element,
  doc: RoundTripDoc,
  state: WalkState,
): string[] {
  const problems: string[] = [];
  const at = atOf(state);
  const shown = walksOf(blocksOf(shownOf(doc, state.selection)));
  const listed = (values: readonly (string | null)[]) => values.join(" | ");
  for (const walk of shown) {
    const position = at(walk.id);
    const where = `${walk.id} at ${String(position.sequence)}.${String(position.step)}`;
    const roots = hooked(container, "id", walk.id);
    const [root] = roots;
    if (root === undefined || roots.length !== 1) {
      problems.push(`${where}: ${String(roots.length)} anchors`);
      continue;
    }
    const sequence = walk.sequences[position.sequence - 1];
    const active = activeOf(walk, position);
    const targets = [root, ...root.querySelectorAll("[data-block-id]")]
      .filter((e) => e.hasAttribute("data-block-id"))
      .map((e) => e.getAttribute("data-block-id"));
    const expected = [walk.blockId, active.blockId];
    if (listed(targets) !== listed(expected))
      problems.push(
        `${where}: the active targets are [${listed(targets)}], expected [${listed(expected)}]`,
      );
    const title = root.firstElementChild;
    if (
      title?.tagName !== "P" ||
      title.getAttribute("data-block-id") !== walk.blockId ||
      shownText(title) !== spansText(walk.title)
    )
      problems.push(`${where}: the title is not its first hooked paragraph`);
    const [target] = hooked(root, "data-block-id", active.blockId);
    if (target !== undefined && shownText(target) !== spansText(active.spans))
      problems.push(`${where}: the active target reads ${shownText(target)}`);
    const status =
      position.step === 0
        ? "Start"
        : `Step ${String(position.step)} of ${String(sequence?.steps.length)}`;
    const lists = root.querySelectorAll(":scope > ol");
    const [list] = lists;
    if (list === undefined || lists.length !== 1)
      problems.push(`${where}: ${String(lists.length)} cell lists`);
    else {
      if (list.previousElementSibling?.textContent !== status)
        problems.push(`${where}: the status does not read ${status}`);
      const cells = cellsOf(walk, position);
      const items = [...list.children];
      if (
        listed(items.map((li) => li.textContent)) !==
        listed(cells.map((c) => c.text))
      )
        problems.push(
          `${where}: the cells read [${listed(items.map((li) => li.textContent))}], expected [${listed(cells.map((c) => c.text))}]`,
        );
      if (
        listed(
          items.map((li) =>
            [...li.querySelectorAll("s")].map((s) => s.textContent).join(""),
          ),
        ) !== listed(cells.map((c) => c.struck))
      )
        problems.push(`${where}: a struck value is not shown struck`);
      const states = JSON.stringify(
        items.map((li) => li.getAttribute("data-cell")),
      );
      const expectedStates = JSON.stringify(cells.map((c) => c.states));
      if (states !== expectedStates)
        problems.push(
          `${where}: the cell states read ${states}, expected ${expectedStates}`,
        );
    }
    const groups = [...root.querySelectorAll('[role="group"]')];
    const pressed = groups.flatMap((g) =>
      [...g.querySelectorAll("button")].map((b) =>
        b.getAttribute("aria-pressed"),
      ),
    );
    if (
      walk.sequences.length > 1
        ? groups.length !== 1 ||
          listed(pressed) !==
            listed(
              walk.sequences.map((_, i) => String(i + 1 === position.sequence)),
            )
        : groups.length !== 0
    )
      problems.push(
        `${where}: the sequence switch does not press its sequence`,
      );
    const regions = [...root.querySelectorAll("[aria-live]")];
    const announced = `${status}: ${spansText(active.spans)}`;
    if (
      regions.length !== 1 ||
      regions[0]?.childElementCount !== 0 ||
      regions[0].textContent !== announced
    )
      problems.push(`${where}: the announcement is not ${announced}`);
  }
  for (const walk of walksIn(doc)) {
    if (shown.some((w) => w.id === walk.id)) continue;
    const hooks = [
      walk.blockId,
      ...walk.sequences.flatMap((s) => [
        s.introBlockId,
        ...s.steps.map((step) => step.blockId),
      ]),
    ];
    if (
      hooked(container, "id", walk.id).length > 0 ||
      hooks.some((id) => hooked(container, "data-block-id", id).length > 0)
    )
      problems.push(`${walk.id}: shown while its approach is not picked`);
  }
  return problems;
}

describe("the provided records", () => {
  it.each([[undefined], [null], ["records"], [{ length: 1 }], [[]]])(
    "refuses %j as the record list",
    (value) => {
      expect(() => provided(value)).toThrow("provided no content records");
    },
  );

  it.each([
    [[null]],
    [[{ path: "compiled/a.json" }]],
    [[{ path: 1, text: "" }]],
  ])("refuses %j as records", (value) => {
    expect(() => provided(value)).toThrow("malformed content record");
  });
});

describe("the test-records envelope", () => {
  it("holds exactly one record per witness", () => {
    expect(records.map((r) => r.path)).toEqual([...witnesses.keys()].sort());
  });
});

describe("strict binding", () => {
  it("tells a property set to undefined from a missing one", () => {
    const parsed: unknown = JSON.parse('{"a":1}');
    expect(parsed).toEqual({ a: 1, b: undefined });
    expect(() => {
      expect(parsed).toStrictEqual({ a: 1, b: undefined });
    }).toThrow();
  });

  it("fails before rendering when the witness differs from the bytes", () => {
    const text = textOf("compiled/chapters/fixture-basics/chapter.json");
    expect(() => {
      roundTrip(text, { ...basics, order: basics.order + 1 });
    }).toThrow();
    expect(() => {
      roundTrip(text, { ...basics, extra: undefined } as RoundTripDoc);
    }).toThrow();
    expect(screen.queryAllByRole("heading")).toEqual([]);
  });
});

describe.each(records.map((r) => [r.path, r.text] as const))(
  "the round trip of %s",
  (path, text) => {
    const witness = witnessOf(path);

    it("renders only after the bytes equal the witness", () => {
      let views = 0;
      roundTrip(text, witness, (container) => {
        expect(container.childElementCount).toBeGreaterThan(0);
        views++;
      });
      expect(views).toBe(selectionsOf(witness).length);
    });

    it("writes exactly the compiled anchors as ids, labels apart", () => {
      roundTrip(text, witness, (container, shown) => {
        const ids = [...container.querySelectorAll("[id]")];
        const anchors = ids
          .filter((e) => e.tagName !== "SPAN")
          .map((e) => e.id);
        expect(anchors.sort()).toEqual(anchorsOf(shown).sort());
        expect(new Set(ids.map((e) => e.id)).size).toBe(ids.length);
        for (const label of ids.filter((e) => e.tagName === "SPAN"))
          expect(anchorsOf(shown)).not.toContain(label.id);
      });
    });

    it("places block ids and labels on their own elements", () => {
      roundTrip(text, witness, (container, shown) => {
        const codes = [...container.querySelectorAll("pre > code")];
        for (const block of blocksOf(shown)) {
          if (block.type !== "code" && block.type !== "text") continue;
          const code = codes.find((c) => c.textContent === block.source);
          const pre = code?.parentElement;
          const wrapper = pre?.parentElement;
          expect(wrapper?.tagName).toBe("DIV");
          expect(pre?.hasAttribute("id")).toBe(false);
          expect(wrapper?.getAttribute("id")).toBe(block.id ?? null);
          const label = wrapper?.querySelector(":scope > span");
          if (block.label === undefined) {
            expect(label).toBeNull();
            expect(pre?.hasAttribute("aria-labelledby")).toBe(false);
          } else {
            expect(label?.textContent).toBe(block.label);
            expect(label?.id).not.toBe("");
            expect(pre?.getAttribute("aria-labelledby")).toBe(label?.id);
          }
        }
        for (const pre of container.querySelectorAll("pre[aria-labelledby]")) {
          const id = pre.getAttribute("aria-labelledby") ?? "";
          expect(container.querySelector(`span[id="${id}"]`)).not.toBeNull();
        }
      });
    });

    it("builds every link href from its target and chapter only", () => {
      roundTrip(text, witness, (container, shown) => {
        const targets = [...container.querySelectorAll("a")].map((a) =>
          a.getAttribute("href"),
        );
        expect(targets).toEqual(hrefsOf(shown));
        for (const href of targets)
          expect(href).toMatch(/^(?:#|\/chapters\/|\/errors#|\/glossary#)/u);
        expect(container.querySelector("a a")).toBeNull();
      });
    });

    it("leaves no empty wrapper element", () => {
      roundTrip(text, witness, (container) => {
        for (const element of container.querySelectorAll(":not(th, td)"))
          expect(element.childNodes.length).toBeGreaterThan(0);
      });
    });

    it("renders every table cell in its place", () => {
      roundTrip(text, witness, (container, shown) => {
        const tables = [...container.querySelectorAll("table")];
        const blocks = blocksOf(shown).flatMap((b) =>
          b.type === "table" ? [b] : [],
        );
        expect(tables.map((t) => t.getAttribute("data-block-id"))).toEqual(
          blocks.map((b) => b.blockId),
        );
        const cellText = (cells: Iterable<Element>) =>
          [...cells].map(shownText);
        tables.forEach((table, index) => {
          const block = blocks[index];
          if (block === undefined) throw new Error("a table without its block");
          expect(cellText(table.querySelectorAll("thead > tr > th"))).toEqual(
            block.headers.map(spansText),
          );
          const rows = [...table.querySelectorAll("tbody > tr")];
          expect(
            rows.map((row) => cellText(row.querySelectorAll(":scope > td"))),
          ).toEqual(block.rows.map((row) => row.map(spansText)));
          expect(table.querySelectorAll("tr").length).toBe(
            block.rows.length + 1,
          );
          expect(table.querySelectorAll("th, td").length).toBe(
            block.headers.length * (block.rows.length + 1),
          );
          // A header names its column, so a screen reader reads it before each cell below.
          expect(
            [...table.querySelectorAll("th")].map((th) =>
              th.getAttribute("scope"),
            ),
          ).toEqual(block.headers.map(() => "col"));
          expect(table.querySelectorAll("td[scope]")).toHaveLength(0);
        });
      });
    });

    it("starts headings at h2 and never skips a level", () => {
      roundTrip(text, witness, (container) => {
        expect(headingProblems(container)).toEqual([]);
      });
    });

    it("keeps each list's kind and start", () => {
      roundTrip(text, witness, (container, shown) => {
        // A walk's cell list is checked with its walk.
        const walkIds = walksOf(blocksOf(shown)).map((w) => w.id);
        const lists = [...container.querySelectorAll("ul, ol")].filter(
          (l) => !walkIds.includes(l.parentElement?.id ?? ""),
        );
        const blocks = blocksOf(shown).flatMap((b) =>
          b.type === "list" ? [b] : [],
        );
        expect(lists.map((l) => l.tagName)).toEqual(
          blocks.map((b) => (b.ordered ? "OL" : "UL")),
        );
        expect(lists.map((l) => l.getAttribute("start"))).toEqual(
          blocks.map((b) =>
            b.ordered && b.start !== undefined ? String(b.start) : null,
          ),
        );
      });
    });

    it("names every link by its author text, never its address", () => {
      roundTrip(text, witness, (container, shown) => {
        const links = screen
          .queryAllByRole("link")
          .filter((a) => a.closest("[popover]") === null);
        expect(links.map((a) => a.textContent)).toEqual(
          linksOf(shown).map((l) => spansText(l.content)),
        );
        // Each Term holds one definition, and its one link names itself, never its address.
        const definitions = [...container.querySelectorAll("[popover]")];
        expect(definitions.length).toBe(termsOf(shown).length);
        for (const definition of definitions)
          expect(
            [...definition.querySelectorAll("a")].map((a) => a.textContent),
          ).toEqual(["Definition"]);
        for (const link of links) {
          expect(link.textContent).not.toBe("");
          expect(link.textContent).not.toBe(link.getAttribute("href"));
          expect(link).toHaveAccessibleName(link.textContent);
        }
      });
    });

    it("binds every spoken segment to one rendered hook, in order", () => {
      roundTrip(text, witness, (container, _shown, selection) => {
        expect(speechProblems(container, witness, selection)).toEqual([]);
      });
    });

    it("renders every card under its own heading with its fields in order", () => {
      roundTrip(text, witness, (container, shown) => {
        const expected = cardsOf(shown);
        // A shown approach has an h4 of its own; every other h4 is a card heading.
        const approachIds = sectionsOf(shown).flatMap(
          (s) => selectedOf(s)?.id ?? [],
        );
        const headings = [...container.querySelectorAll("h4")].filter(
          (h) => !approachIds.includes(h.id),
        );
        const lists = [...container.querySelectorAll("dl")];
        expect(headings.map((h) => h.id)).toEqual(expected.map((c) => c.id));
        expect(headings.map((h) => h.textContent)).toEqual(
          expected.map((c) => spansText(c.title)),
        );
        expect(lists.length).toBe(expected.length);
        expect(container.querySelectorAll("dt, dd").length).toBe(
          expected.reduce((n, c) => n + 2 * cardFields(c).length, 0),
        );
        expected.forEach((card, index) => {
          const list = lists[index];
          if (list === undefined) throw new Error("a card without its list");
          expect(headings[index]?.nextElementSibling).toBe(list);
          const fields = cardFields(card);
          const parts = [...list.children];
          expect(parts.map((e) => e.tagName)).toEqual(
            fields.flatMap(() => ["DT", "DD"]),
          );
          fields.forEach(([label, blocks], at) => {
            expect(parts[2 * at]?.textContent).toBe(label);
            expect(
              [...(parts[2 * at + 1]?.children ?? [])].map((e) =>
                e.getAttribute("data-block-id"),
              ),
            ).toEqual(blocks.map((b) => b.blockId));
          });
        });
      });
    });

    it("gives a section hook to sections only", () => {
      roundTrip(text, witness, (container, shown) => {
        const hooks = [...container.querySelectorAll("[data-section-id]")];
        expect(hooks.map((e) => e.getAttribute("data-section-id"))).toEqual(
          sectionsOf(shown).map((s) => s.id),
        );
      });
    });

    it("shows a picker for approaches only and mounts the selected one alone", () => {
      roundTrip(text, witness, (container, shown, selection) => {
        const sections = sectionsOf(shown).flatMap((s) =>
          "options" in s ? [s] : [],
        );
        const groups = [...container.querySelectorAll('[role="group"]')];
        expect(groups.length).toBe(sections.length);
        expect(
          container.querySelectorAll("button:not([popovertarget])").length,
        ).toBe(sections.reduce((n, s) => n + s.options.length, 0));
        expect(container.querySelectorAll("button[popovertarget]").length).toBe(
          termsOf(shown).length,
        );
        sections.forEach((section, index) => {
          const group = groups[index];
          if (group === undefined) throw new Error("a section with no picker");
          expect(
            hooked(container, "data-section-id", section.id)[0]?.contains(
              group,
            ),
          ).toBe(true);
          const buttons = [...group.querySelectorAll("button")];
          expect(buttons.map((b) => b.textContent)).toEqual(
            section.options.map((o) => o.label),
          );
          expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(
            section.options.map((o) =>
              String(o.id === selection.get(section.id)),
            ),
          );
          expect(buttons.map((b) => b.getAttribute("type"))).toEqual(
            section.options.map(() => "button"),
          );
          expect(section.selected?.id).toBe(selection.get(section.id));
        });
        for (const id of unselectedHooks(witness, selection))
          expect(hooked(container, "data-block-id", id)).toEqual([]);
        if (witness.type === "part" && witness.kind === "build")
          for (const section of witness.sections)
            for (const approach of section.approaches ?? []) {
              const on = selection.get(section.id) === approach.id;
              expect(
                [...container.querySelectorAll("h4")].filter(
                  (h) => h.id === approach.id,
                ).length,
              ).toBe(on ? 1 : 0);
              for (const id of hookIds(approach.body))
                expect(hooked(container, "data-block-id", id).length).toBe(
                  on ? 1 : 0,
                );
            }
      });
    });

    it("shows every walk frozen at its first sequence's start", () => {
      const cellText = (cell: WalkItBlock["cells"][number], at: number) =>
        `${String(at)}: ${
          cell === null
            ? "empty"
            : typeof cell === "string"
              ? `“${cell}”`
              : String(cell)
        }`;
      roundTrip(text, witness, (container, shown) => {
        for (const walk of walksOf(blocksOf(shown))) {
          const [first] = walk.sequences;
          const roots = hooked(container, "id", walk.id);
          expect(roots).toHaveLength(1);
          const [root] = roots;
          expect(root?.tagName).toBe("DIV");
          expect(root?.getAttribute("data-block-id")).toBe(walk.blockId);
          const parts = [...(root?.children ?? [])];
          expect(parts.map((e) => e.tagName)).toEqual(["P", "OL", "P"]);
          const [title, cells, intro] = parts;
          if (title === undefined || cells === undefined || intro === undefined)
            throw new Error("a walk without its parts");
          expect(title.attributes).toHaveLength(0);
          expect(shownText(title)).toBe(spansText(walk.title));
          expect(cells.attributes).toHaveLength(0);
          const items = [...cells.children];
          expect(items.map((li) => li.tagName)).toEqual(
            walk.cells.map(() => "LI"),
          );
          expect(
            items.map((li) =>
              [...li.attributes].map((a) => `${a.name}=${a.value}`),
            ),
          ).toEqual(
            walk.cells.map((cell) =>
              cell === null ? ["data-cell=empty"] : [],
            ),
          );
          expect(items.map((li) => li.textContent)).toEqual(
            walk.cells.map(cellText),
          );
          expect(intro.attributes).toHaveLength(1);
          expect(shownText(intro)).toBe(spansText(first.intro));
          const active = hooked(container, "data-block-id", first.introBlockId);
          expect(active).toHaveLength(1);
          expect(active[0]).toBe(intro);
          for (const id of inactiveHookIds([walk]))
            expect(hooked(container, "data-block-id", id)).toHaveLength(0);
          // A Term in the title or intro keeps its own button; nothing else may act or announce.
          expect(
            root?.querySelectorAll(
              "button:not([popovertarget]), [aria-live], [role], s",
            ),
          ).toHaveLength(0);
        }
      });
    });

    it("shows each walk at every position with that position's hooks and cells", () => {
      const visit = (id: string, at: WalkPosition, shown: boolean) =>
        `${id} ${String(at.sequence)}.${String(at.step)} ${shown ? "shown" : "left out"}`;
      const visited = new Set<string>();
      walkRoundTrip(text, witness, (container, state) => {
        expect(walkProblems(container, witness, state)).toEqual([]);
        const shown = walksOf(blocksOf(shownOf(witness, state.selection)));
        for (const [id, at] of state.positions)
          visited.add(
            visit(
              id,
              at,
              shown.some((w) => w.id === id),
            ),
          );
      });
      // Every walk the bytes hold is seen at every position, and one in an approach also left out.
      expect([...visited].sort()).toEqual(
        walksIn(witness)
          .flatMap((walk) =>
            positionsOf(walk).flatMap((at) =>
              selectionsFor(witness, walk).length > 1
                ? [visit(walk.id, at, true), visit(walk.id, at, false)]
                : [visit(walk.id, at, true)],
            ),
          )
          .sort(),
      );
    });

    it("binds every spoken segment to its hook at every walk position", () => {
      walkRoundTrip(text, witness, (container, state) => {
        expect(
          speechProblems(container, witness, state.selection, atOf(state)),
        ).toEqual([]);
      });
    });

    it("lands a same-page link on one live anchor per shown walk in both views", () => {
      const walks = walksIn(witness);
      // A link to each walk, built by the renderer as an author's same-page link is.
      const links = render(
        <p>
          <Spans
            spans={walks.map((w): LinkSpan => ({
              type: "link",
              kind: "anchor",
              id: w.id,
              content: [{ type: "text", text: w.id }],
            }))}
            slugs={slugs}
          />
        </p>,
      );
      const hrefs = [...links.container.querySelectorAll("a")].map((a) =>
        a.getAttribute("href"),
      );
      links.unmount();
      expect(hrefs).toHaveLength(walks.length);
      const landing = (container: Element, href: string | null) =>
        href?.startsWith("#") === true
          ? hooked(container, "id", href.slice(1))
          : [];
      const lands = (
        container: Element,
        shown: ShownDoc,
        hookOf: (root: Element | undefined) => string | null | undefined,
      ) => {
        for (const a of container.querySelectorAll('a[href^="#"]'))
          expect(landing(container, a.getAttribute("href"))).toHaveLength(1);
        const live = walksOf(blocksOf(shown)).map((w) => w.id);
        walks.forEach((walk, index) => {
          const landed = landing(container, hrefs[index] ?? null);
          expect(landed).toHaveLength(live.includes(walk.id) ? 1 : 0);
          if (live.includes(walk.id))
            expect(hookOf(landed[0])).toBe(walk.blockId);
        });
      };
      roundTrip(text, witness, (container, shown) => {
        lands(container, shown, (root) => root?.getAttribute("data-block-id"));
      });
      walkRoundTrip(text, witness, (container, state) => {
        const shown = shownOf(witness, state.selection);
        const anchors = [...container.querySelectorAll("[id]")]
          .filter((e) => e.tagName !== "SPAN")
          .map((e) => e.id);
        expect(anchors.sort()).toEqual(anchorsOf(shown).sort());
        lands(container, shown, (root) =>
          root?.firstElementChild?.getAttribute("data-block-id"),
        );
      });
    });

    it("mounts only the Terms and links each walk position shows", () => {
      walkRoundTrip(text, witness, (container, state) => {
        const shown = shownOf(witness, state.selection);
        const at = atOf(state);
        const anchors = [...container.querySelectorAll("a")];
        expect(anchors.map((a) => a.getAttribute("href"))).toEqual(
          hrefsOf(shown, at),
        );
        expect(
          anchors
            .filter((a) => a.closest("[popover]") === null)
            .map((a) => a.textContent),
        ).toEqual(linksOf(shown, at).map((l) => spansText(l.content)));
        // Each Term button opens its own definition, however many steppers share the page.
        const definitions = [...container.querySelectorAll("[popover]")];
        const targets = [...container.querySelectorAll("[popovertarget]")].map(
          (b) => b.getAttribute("popovertarget"),
        );
        expect(definitions).toHaveLength(termsOf(shown, at).length);
        expect(targets).toHaveLength(definitions.length);
        expect(new Set(targets).size).toBe(targets.length);
        for (const target of targets)
          expect(definitions.filter((d) => d.id === target)).toHaveLength(1);
      });
    });
  },
);

describe("speech check", () => {
  const path = "compiled/chapters/fixture-basics/library.json";
  const changed = (edit: (doc: RoundTripDoc) => void): string[] => {
    const doc = structuredClone(witnessOf(path));
    edit(doc);
    const { container } = show(doc);
    return speechProblems(container, doc);
  };
  const first = (doc: RoundTripDoc) => {
    const speech = speechSections(doc).map((s) => s.spoken);
    const found = speech.find((s) => s.segments.length > 1);
    if (found === undefined) throw new Error("no section with two segments");
    return found;
  };

  it("passes the compiled record unchanged", () => {
    expect(changed(() => undefined)).toEqual([]);
  });

  it.each([
    [
      "a target no block carries",
      (doc: RoundTripDoc) => {
        const [segment] = first(doc).segments;
        if (segment?.target.type === "block")
          segment.target.blockId = "lib-fix-one/b99";
      },
      "resolves to 0 hooks",
    ],
    [
      "a target in another section",
      (doc: RoundTripDoc) => {
        const speech = first(doc);
        const other = speechSections(doc)
          .map((s) => s.spoken)
          .find((s) => s !== speech && s.segments[0]?.target.type === "block");
        const [segment] = speech.segments;
        if (segment !== undefined && other?.segments[0] !== undefined)
          segment.target = other.segments[0].target;
      },
      "is rendered outside it",
    ],
    [
      "segments out of reading order",
      (doc: RoundTripDoc) => {
        first(doc).segments.reverse();
      },
      "is out of reading order",
    ],
    [
      "one block spoken twice",
      (doc: RoundTripDoc) => {
        const speech = first(doc);
        const [segment] = speech.segments;
        if (segment !== undefined) speech.segments.splice(1, 0, segment);
      },
      "is out of reading order",
    ],
    [
      "a summary beside block segments",
      (doc: RoundTripDoc) => {
        const section = speechSections(doc).find(
          (s) => s.spoken.segments.length > 1,
        );
        section?.spoken.segments.push({
          target: { type: "section", sectionId: section.id },
          text: "x",
        });
      },
      "a summary stands beside other segments",
    ],
    [
      "a summary for another section",
      (doc: RoundTripDoc) => {
        const speech = speechSections(doc)
          .map((s) => s.spoken)
          .find((s) => s.segments[0]?.target.type === "section");
        const target = speech?.segments[0]?.target;
        if (target?.type === "section") target.sectionId = "lib-fix-one";
      },
      "a summary targets lib-fix-one",
    ],
  ])("reports %s", (_, edit, fragment) => {
    expect(changed(edit).join("\n")).toContain(fragment);
  });
});

describe("heading order check", () => {
  it.each([
    ["an h1", <h1 key="a">x</h1>, "h1 is the hosting page's"],
    ["a first heading below h2", <h3 key="a">x</h3>, "h3 skips a level"],
    [
      "a skipped level",
      [<h2 key="a">x</h2>, <h4 key="b">y</h4>],
      "h4 skips a level",
    ],
  ])("refuses %s", (_, headings, problem) => {
    const { container } = render(<div>{headings}</div>);
    expect(headingProblems(container)).toEqual([problem]);
  });
});

describe("labelled and unlabelled blocks", () => {
  it("are both present among the compiled records", () => {
    const sources = [...witnesses.values()]
      .flatMap((doc) => blocksOf(shownOf(doc, nothing)))
      .flatMap((b) => (b.type === "code" || b.type === "text" ? [b] : []));
    expect(sources.some((b) => b.label !== undefined)).toBe(true);
    expect(sources.some((b) => b.label === undefined)).toBe(true);
  });
});

describe("links in the compiled records", () => {
  const targetsOf = (path: string) => {
    roundTrip(textOf(path), witnessOf(path));
    const { container, unmount } = show(witnessOf(path));
    const targets = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    unmount();
    return targets;
  };

  it("renders a bare link to the same page", () => {
    expect(
      targetsOf("compiled/chapters/fixture-basics/chapter.json"),
    ).toContain("#fix-parts");
  });

  it("renders an explicit current-chapter link in a chapter file", () => {
    expect(
      targetsOf("compiled/chapters/fixture-basics/chapter.json"),
    ).toContain("/chapters/fixture-basics#fix-note");
  });

  it("renders an explicit current-chapter link in a part file", () => {
    expect(targetsOf("compiled/chapters/fixture-basics/syntax.json")).toContain(
      "/chapters/fixture-basics#syn-fix-sum1",
    );
  });

  it("renders an other-chapter link through the second chapter witness", () => {
    expect(
      targetsOf("compiled/chapters/fixture-basics/chapter.json"),
    ).toContain("/chapters/fixture-second#second-start");
  });

  it("throws on an other-chapter link whose chapter is not in the map", () => {
    const without = buildSlugMap([basics]);
    expect(() =>
      render(<ContentView doc={basics} slugs={without} />),
    ).toThrow();
  });
});

describe("variant fixtures", () => {
  const view = (path: string) => {
    roundTrip(textOf(path), witnessOf(path));
    return show(witnessOf(path)).container;
  };

  it("starts an empty-intro chapter with its first section heading", () => {
    const container = view(
      "compiled/chapters/fixture-empty-intro/chapter.json",
    );
    const first = container.firstElementChild;
    expect(first?.tagName).toBe("SECTION");
    expect(first?.firstElementChild?.tagName).toBe("H2");
  });

  it("renders a chapter with no sections as its intro alone", () => {
    const container = view(
      "compiled/chapters/fixture-no-sections/chapter.json",
    );
    expect(container.querySelector("h2, h3")).toBeNull();
    expect(container.childElementCount).toBe(noSections.intro.length);
  });

  it("renders a section with an empty body as its heading alone", () => {
    const container = view("compiled/chapters/fixture-basics/idioms.json");
    const heading = container.querySelector('h3[id="idiom-fix-empty"]');
    expect(heading).not.toBeNull();
    expect(heading?.nextElementSibling).toBeNull();
  });

  it("keeps the nested em, strong, em element tree", () => {
    const container = view("compiled/chapters/fixture-basics/build.json");
    const inner = container.querySelector("em > strong > em");
    expect(inner?.textContent).toBe("inner");
    expect(inner?.parentElement?.textContent).toBe("middle inner middle");
    expect(inner?.parentElement?.parentElement?.textContent).toBe(
      "outer middle inner middle outer",
    );
  });
});

describe("nested links forced into link content", () => {
  const link = (content: unknown): LinkSpan =>
    ({ type: "link", id: "fix-parts", content }) as LinkSpan;
  const text = { type: "text", text: "x" };

  it.each([
    ["a link directly in link content", [link([text])]],
    ["link, em, link", [{ type: "em", content: [link([text])] }]],
    [
      "link, strong, em, link",
      [
        {
          type: "strong",
          content: [{ type: "em", content: [link([text])] }],
        },
      ],
    ],
  ])("throws on %s", (_name, content) => {
    expect(() =>
      render(<Spans spans={[link(content)]} slugs={slugs} />),
    ).toThrow();
  });
});
