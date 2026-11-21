import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  Segment,
  Spans,
  Speech,
  WalkItBlock,
  WalkSequence,
} from "../generated/body.ts";
import { witness as basics } from "../generated/witness/chapters/fixture-basics/chapter.ts";
import { buildSlugMap } from "../content/href.ts";
import { isValidPosition } from "../content/walk-position.ts";
import type { WalkPosition, WalkShape } from "../content/walk-position.ts";
import { spanText } from "../content/span-text.ts";
import { replay } from "../content/walk-replay.ts";
import type { WalkCell, WalkStepInput } from "../content/walk-replay.ts";
import { WalkStepper } from "../content/WalkStepper.tsx";
import type { WalkChange } from "../content/WalkStepper.tsx";
import { WalkController } from "./walk-controller.tsx";

const slugs = buildSlugMap([basics]);
const said = (text: string): Spans => [{ type: "text", text }];

// Hand-built and typed as the compiler's output, so no cast stands between them and the view.
const spare: WalkSequence = {
  name: "Through the spare",
  introBlockId: "walk-test/b1.1.s0",
  intro: said("The spare cell holds a copy."),
  steps: [
    {
      blockId: "walk-test/b1.1.s1",
      dst: 2,
      src: 0,
      note: said("Copy the number into the spare."),
    },
    {
      blockId: "walk-test/b1.1.s2",
      dst: 0,
      src: 1,
      note: said("Copy the letter over the number."),
    },
    {
      blockId: "walk-test/b1.1.s3",
      dst: 1,
      src: 2,
      note: said("Copy the spare into the second cell."),
    },
  ],
};
const overwrite: WalkSequence = {
  name: "Overwrite first",
  introBlockId: "walk-test/b1.2.s0",
  intro: said("Writing first loses a value."),
  steps: [
    {
      blockId: "walk-test/b1.2.s1",
      dst: 0,
      value: 7,
      lost: true,
      note: said("Write over the number."),
    },
    {
      blockId: "walk-test/b1.2.s2",
      dst: 1,
      value: 0,
      note: said("Write zero into the second cell."),
    },
  ],
};
const swap: WalkItBlock = {
  type: "walk-it",
  blockId: "walk-test/b1",
  id: "walk-swap",
  title: said("Swap two cells"),
  cells: [3, "x", null],
  sequences: [spare, overwrite],
};
const single: WalkItBlock = { ...swap, id: "walk-one", sequences: [spare] };

// The generated types fit the helpers' inputs with no cast.
const shape: WalkShape = swap.sequences;
const cells: readonly WalkCell[] = swap.cells;
const copies: readonly WalkStepInput[] = spare.steps;
const writes: readonly WalkStepInput[] = overwrite.steps;

function show(block: WalkItBlock, position: WalkPosition, announce = false) {
  const onPositionChange = vi.fn<(change: WalkChange) => void>();
  const view = render(
    <WalkStepper
      block={block}
      position={position}
      onPositionChange={onPositionChange}
      announce={announce}
      slugs={slugs}
    />,
  );
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLDivElement)) throw new Error("no root element");
  return { root, onPositionChange };
}

const hooks = (root: Element) =>
  [...root.querySelectorAll("[data-block-id]")].map((e) => [
    e.tagName,
    e.getAttribute("data-block-id"),
  ]);
const cellTexts = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
const cellStates = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("data-cell"));
const pressed = () =>
  within(screen.getByRole("group", { name: "Walk sequences" }))
    .getAllByRole("button")
    .map((b) => [b.textContent, b.getAttribute("aria-pressed")]);

describe("the generated walk types", () => {
  it("fit the helpers with no cast", () => {
    expect(isValidPosition(shape, { sequence: 2, step: 2 })).toBe(true);
    expect(replay(cells, copies, 3).kind).toBe("state");
    expect(replay(cells, writes, 2).kind).toBe("state");
  });
});

describe("the walk stepper view", () => {
  it("shows Start with every cell, the intro and one empty live region", () => {
    const { root } = show(swap, { sequence: 1, step: 0 });
    expect(root.id).toBe("walk-swap");
    expect(screen.getByText("Swap two cells").tagName).toBe("P");
    expect(screen.getByText("Start").tagName).toBe("P");
    expect(cellTexts()).toEqual(["0: 3", "1: “x”", "2: empty"]);
    expect(cellStates()).toEqual([null, null, "empty"]);
    expect(hooks(root)).toEqual([
      ["P", "walk-test/b1"],
      ["P", "walk-test/b1.1.s0"],
    ]);
    expect(screen.getByText("The spare cell holds a copy.").tagName).toBe("P");
    expect(screen.queryByText("Copy the number into the spare.")).toBeNull();
    const live = root.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]?.getAttribute("aria-live")).toBe("polite");
    expect(live[0]?.textContent).toBe("");
    expect(pressed()).toEqual([
      ["Through the spare", "true"],
      ["Overwrite first", "false"],
    ]);
  });

  it("shows a step with its counter, its note alone and the written and read cues", () => {
    const { root } = show(swap, { sequence: 1, step: 2 });
    expect(screen.getByText("Step 2 of 3").tagName).toBe("P");
    expect(cellTexts()).toEqual(["0: “x” ← written", "1: “x” ← read", "2: 3"]);
    expect(cellStates()).toEqual(["destination", "source", null]);
    expect(hooks(root)).toEqual([
      ["P", "walk-test/b1"],
      ["P", "walk-test/b1.1.s2"],
    ]);
    expect(screen.queryByText("The spare cell holds a copy.")).toBeNull();
  });

  it("keeps the struck original beside lost through the last step", () => {
    show(swap, { sequence: 2, step: 2 });
    expect(cellTexts()).toEqual(["0: 3 lost 7", "1: 0 ← written", "2: empty"]);
    expect(cellStates()).toEqual([null, "destination", "empty"]);
    const [first] = within(screen.getByRole("list")).getAllByRole("listitem");
    if (first === undefined) throw new Error("no first cell");
    expect(within(first).getByText("3").tagName).toBe("S");
  });

  it("reads Start with the intro and a step with its note only when told to", () => {
    const start = show(swap, { sequence: 1, step: 0 }, true);
    expect(start.root.querySelector("[aria-live]")?.textContent).toBe(
      "Start: The spare cell holds a copy.",
    );
    const step = show(swap, { sequence: 1, step: 2 }, true);
    expect(step.root.querySelector("[aria-live]")?.textContent).toBe(
      "Step 2 of 3: Copy the letter over the number.",
    );
  });

  it("has no switch for a single sequence", () => {
    show(single, { sequence: 1, step: 0 });
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Prev",
      "Next",
    ]);
  });
});

describe("Prev, Next and the switch", () => {
  it("report the helper's move once each, with its cause", () => {
    const { onPositionChange } = show(swap, { sequence: 1, step: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(onPositionChange.mock.calls).toEqual([
      [{ kind: "moved", position: { sequence: 1, step: 2 }, cause: "next" }],
      [{ kind: "moved", position: { sequence: 1, step: 0 }, cause: "prev" }],
    ]);
  });

  it.each([
    ["Prev", { sequence: 1, step: 0 }, "Next"],
    ["Next", { sequence: 1, step: 3 }, "Prev"],
  ])("keeps %s focusable and silent at its bound", (name, position, other) => {
    const { onPositionChange } = show(swap, position);
    const bound = screen.getByRole("button", { name });
    expect(bound.getAttribute("aria-disabled")).toBe("true");
    expect(bound.hasAttribute("disabled")).toBe(false);
    bound.focus();
    expect(bound.ownerDocument.activeElement).toBe(bound);
    fireEvent.click(bound);
    expect(onPositionChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: other }).getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("goes to Start of another sequence and of the current one", () => {
    const { onPositionChange } = show(swap, { sequence: 1, step: 1 });
    const group = screen.getByRole("group", { name: "Walk sequences" });
    fireEvent.click(
      within(group).getByRole("button", { name: "Overwrite first" }),
    );
    fireEvent.click(
      within(group).getByRole("button", { name: "Through the spare" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(onPositionChange.mock.calls).toEqual([
      [
        {
          kind: "moved",
          position: { sequence: 2, step: 0 },
          cause: "sequence",
        },
      ],
      [
        {
          kind: "moved",
          position: { sequence: 1, step: 0 },
          cause: "sequence",
        },
      ],
      [{ kind: "moved", position: { sequence: 1, step: 0 }, cause: "prev" }],
    ]);
  });
});

describe("an invalid position", () => {
  it.each([
    [0, 0],
    [3, 0],
    [Number.NaN, 0],
    [1, -1],
    [1, 4],
    [2, 3],
  ])(
    "at sequence %s step %s mounts only the title and the switch",
    (sequence, step) => {
      const { root, onPositionChange } = show(swap, { sequence, step });
      expect(root.id).toBe("walk-swap");
      expect(hooks(root)).toEqual([["P", "walk-test/b1"]]);
      expect(pressed()).toEqual([
        ["Through the spare", "false"],
        ["Overwrite first", "false"],
      ]);
      expect(screen.queryByRole("list")).toBeNull();
      expect(screen.getAllByRole("button")).toHaveLength(2);
      expect(root.querySelector("[aria-live]")?.textContent).toBe("");
      expect(root.textContent).toBe(
        "Swap two cellsThrough the spareOverwrite first",
      );
      fireEvent.click(screen.getByRole("button", { name: "Overwrite first" }));
      expect(onPositionChange.mock.calls).toEqual([
        [
          {
            kind: "moved",
            position: { sequence: 2, step: 0 },
            cause: "sequence",
          },
        ],
      ]);
    },
  );

  it("mounts only the title when the walk has one sequence", () => {
    const { root } = show(single, { sequence: 2, step: 0 }, true);
    expect(root.textContent).toBe("Swap two cells");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const parts: Spans = [
  {
    type: "link",
    kind: "anchor",
    id: "fix-parts",
    content: [{ type: "em", content: [{ type: "text", text: "parts" }] }],
  },
];
const term: Spans = [
  {
    type: "term",
    id: "term-a",
    short: "A short definition.",
    content: [{ type: "strong", content: [{ type: "code", text: "swap" }] }],
  },
];
const rich: Spans = [
  { type: "text", text: "Copy " },
  { type: "code", text: "x[0]" },
  { type: "text", text: ", " },
  { type: "em", content: [{ type: "strong", content: said("now") }] },
  { type: "text", text: " via " },
  ...parts,
  { type: "text", text: " as " },
  ...term,
  { type: "text", text: "." },
];

describe("the announcement text", () => {
  it.each<[string, Spans, string]>([
    ["text", said("plain"), "plain"],
    ["code", [{ type: "code", text: "x[0]" }], "x[0]"],
    ["emphasis", [{ type: "em", content: said("word") }], "word"],
    ["strong", [{ type: "strong", content: said("word") }], "word"],
    ["an anchor link", parts, "parts"],
    [
      "an error link",
      [
        {
          type: "link",
          kind: "error",
          id: "err-one",
          content: [{ type: "code", text: "Main" }],
        },
      ],
      "Main",
    ],
    ["a Term", term, "swap"],
    ["a run of every kind", rich, "Copy x[0], now via parts as swap."],
  ])("keeps the shown words of %s", (_kind, spans, text) => {
    expect(spanText(spans)).toBe(text);
  });
});

describe("the live region", () => {
  it.each<[string, WalkItBlock, WalkPosition]>([
    ["at Start", swap, { sequence: 1, step: 0 }],
    ["at a step", swap, { sequence: 2, step: 1 }],
    ["at an invalid position", swap, { sequence: 3, step: 0 }],
    [
      "at an invalid position of one sequence",
      single,
      { sequence: 1, step: 4 },
    ],
  ])("is one empty region on the root %s", (_name, block, position) => {
    const { root } = show(block, position);
    const regions = root.querySelectorAll("[aria-live]");
    expect(regions).toHaveLength(1);
    const [region] = regions;
    expect(region?.parentElement).toBe(root);
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.getAttribute("aria-atomic")).toBe("true");
    expect(region?.textContent).toBe("");
  });

  it("keeps its node across a switch and an invalid-to-valid change", () => {
    const onPositionChange = vi.fn<(change: WalkChange) => void>();
    const at = (position: WalkPosition, announce: boolean) => (
      <WalkStepper
        block={swap}
        position={position}
        onPositionChange={onPositionChange}
        announce={announce}
        slugs={slugs}
      />
    );
    const view = render(at({ sequence: 1, step: 2 }, true));
    const region = () => {
      const regions = view.container.querySelectorAll("[aria-live]");
      expect(regions).toHaveLength(1);
      return regions[0];
    };
    const first = region();
    expect(first?.textContent).toBe(
      "Step 2 of 3: Copy the letter over the number.",
    );
    view.rerender(at({ sequence: 2, step: 0 }, false));
    expect(region()).toBe(first);
    expect(first?.textContent).toBe("");
    view.rerender(at({ sequence: 3, step: 0 }, false));
    expect(region()).toBe(first);
    view.rerender(at({ sequence: 2, step: 1 }, true));
    expect(region()).toBe(first);
    expect(first?.textContent).toBe("Step 1 of 2: Write over the number.");
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("reads links and Terms as their words, with no control in the region", () => {
    const linked: WalkItBlock = {
      ...single,
      sequences: [{ ...spare, intro: rich }],
    };
    const { root } = show(linked, { sequence: 1, step: 0 }, true);
    const region = root.querySelector("[aria-live]");
    if (!(region instanceof HTMLElement)) throw new Error("no live region");
    expect(region.textContent).toBe("Start: Copy x[0], now via parts as swap.");
    expect(region.children).toHaveLength(0);
    expect(within(region).queryAllByRole("link")).toEqual([]);
    expect(within(region).queryAllByRole("button")).toEqual([]);
    expect(region.querySelectorAll("[popover], [tabindex]")).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "parts" }).closest("[aria-live]"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "swap" }).closest("[aria-live]"),
    ).toBeNull();
  });
});

// The reviewed source against the stepper contract, for data the compiler accepts. Each instance
// stays mounted under a stable parent, which is where its region is promised to persist.
describe("the stepper contract", () => {
  const onPositionChange = vi.fn<(change: WalkChange) => void>();
  const at = (block: WalkItBlock, position: WalkPosition) => (
    <WalkStepper
      block={block}
      position={position}
      onPositionChange={onPositionChange}
      announce
      slugs={slugs}
    />
  );
  const buttons = (root: Element, text: string) =>
    [...root.querySelectorAll("button")].filter((b) => b.textContent === text)
      .length;
  const count = (root: Element) => ({
    regions: root.querySelectorAll("[aria-live]").length,
    lists: root.querySelectorAll("ol").length,
    prev: buttons(root, "Prev"),
    next: buttons(root, "Next"),
    hooks: root.querySelectorAll("[data-block-id]").length,
  });
  const valid = { regions: 1, lists: 1, prev: 1, next: 1, hooks: 2 };
  const invalid = { regions: 1, lists: 0, prev: 0, next: 0, hooks: 1 };
  const walk: [WalkPosition, typeof valid][] = [
    [{ sequence: 1, step: 0 }, valid],
    [{ sequence: 1, step: 1 }, valid],
    [{ sequence: 1, step: 3 }, valid],
    [{ sequence: 2, step: 0 }, valid],
    [{ sequence: 2, step: 2 }, valid],
    [{ sequence: 3, step: 0 }, invalid],
    [{ sequence: 1, step: 4 }, invalid],
    [{ sequence: 2, step: 1 }, valid],
    [{ sequence: 1, step: 2 }, valid],
  ];

  it("keeps its root and region nodes and one active part through every change", () => {
    const view = render(at(swap, { sequence: 1, step: 0 }));
    const root = view.container.firstElementChild;
    if (!(root instanceof HTMLDivElement)) throw new Error("no root element");
    const region = root.querySelector("[aria-live]");
    expect(region).toBeInstanceOf(HTMLParagraphElement);
    expect(count(root)).toEqual(valid);
    for (const [position, expected] of walk) {
      view.rerender(at(swap, position));
      expect(view.container.firstElementChild).toBe(root);
      expect(root.querySelector("[aria-live]")).toBe(region);
      expect(count(root)).toEqual(expected);
    }
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("keeps two instances on one page apart", () => {
    const other: WalkItBlock = { ...swap, id: "walk-other" };
    const both = (first: WalkPosition, second: WalkPosition) => (
      <>
        {at(swap, first)}
        {at(other, second)}
      </>
    );
    const view = render(
      both({ sequence: 1, step: 0 }, { sequence: 2, step: 1 }),
    );
    const roots = [...view.container.children];
    expect(roots.map((r) => r.id)).toEqual(["walk-swap", "walk-other"]);
    const regions = roots.map((r) => r.querySelector("[aria-live]"));
    const texts = () => regions.map((r) => r?.textContent);
    expect(texts()).toEqual([
      "Start: The spare cell holds a copy.",
      "Step 1 of 2: Write over the number.",
    ]);
    expect(roots.map(count)).toEqual([valid, valid]);
    view.rerender(both({ sequence: 1, step: 2 }, { sequence: 3, step: 0 }));
    roots.forEach((root, index) => {
      expect(view.container.children[index]).toBe(root);
      expect(root.querySelector("[aria-live]")).toBe(regions[index]);
    });
    expect(texts()).toEqual([
      "Step 2 of 3: Copy the letter over the number.",
      "",
    ]);
    expect(roots.map(count)).toEqual([valid, invalid]);
  });

  it("gives its cell list the list role at Start and after a move", () => {
    const walk = control(swap, { sequence: 1, step: 0 });
    expect(screen.getByRole("list").getAttribute("role")).toBe("list");
    walk.press("Next");
    expect(screen.getByText("Step 1 of 3").tagName).toBe("P");
    expect(screen.getByRole("list").getAttribute("role")).toBe("list");
  });

  it.each<[string, WalkPosition, string]>([
    [
      "the intro at Start",
      { sequence: 2, step: 0 },
      "Start: Writing first loses a value.",
    ],
    [
      "the note at its step",
      { sequence: 2, step: 2 },
      "Step 2 of 2: Write zero into the second cell.",
    ],
    [
      "the first note",
      { sequence: 1, step: 1 },
      "Step 1 of 3: Copy the number into the spare.",
    ],
  ])(
    "announces %s from its own field as text alone",
    (_name, position, text) => {
      const { root } = show(swap, position, true);
      const region = root.querySelector("[aria-live]");
      if (!(region instanceof HTMLElement)) throw new Error("no live region");
      const sequence = swap.sequences[position.sequence - 1];
      if (sequence === undefined) throw new Error("no sequence");
      const field =
        position.step === 0
          ? sequence.intro
          : sequence.steps[position.step - 1]?.note;
      if (field === undefined) throw new Error("no field");
      expect(region.textContent).toBe(text);
      expect(text.endsWith(`: ${spanText(field)}`)).toBe(true);
      expect(text).not.toContain(sequence.name);
      expect(
        [...region.childNodes].every((n) => n.nodeType === Node.TEXT_NODE),
      ).toBe(true);
    },
  );

  it("never shows a switch for a single sequence", () => {
    const view = render(at(single, { sequence: 1, step: 0 }));
    expect(screen.queryByRole("group")).toBeNull();
    for (const [position] of walk) {
      view.rerender(at(single, position));
      expect(screen.queryByRole("group")).toBeNull();
    }
  });

  it.each<[string, WalkPosition]>([
    ["at Start", { sequence: 1, step: 0 }],
    ["at a step", { sequence: 1, step: 2 }],
  ])(
    "holds no element in the region %s, with links and Terms in the text",
    (_name, position) => {
      const linked: WalkItBlock = {
        ...single,
        sequences: [
          {
            ...spare,
            intro: rich,
            steps: [
              { blockId: "walk-test/b1.1.s1", dst: 2, src: 0, note: rich },
              { blockId: "walk-test/b1.1.s2", dst: 0, src: 1, note: rich },
            ],
          },
        ],
      };
      const { root } = show(linked, position, true);
      const region = root.querySelector("[aria-live]");
      if (!(region instanceof HTMLElement)) throw new Error("no live region");
      expect(region.textContent).toMatch(
        /Copy x\[0\], now via parts as swap\.$/u,
      );
      expect(region.querySelectorAll("*")).toHaveLength(0);
    },
  );
});

// An update from outside is a render of the controller with a new position object.
function control(block: WalkItBlock, position: WalkPosition) {
  const at = (outside: WalkPosition) => (
    <WalkController block={block} position={outside} slugs={slugs} />
  );
  const view = render(at(position));
  return {
    said: () => view.container.querySelector("[aria-live]")?.textContent,
    // A copy with the region emptied, so two views can differ only in what is read.
    unread: () => {
      const copy = view.container.cloneNode(true);
      if (!(copy instanceof Element)) throw new Error("no copy");
      copy.querySelector("[aria-live]")?.replaceChildren();
      return copy;
    },
    press: (name: string) => {
      fireEvent.click(screen.getByRole("button", { name }));
    },
    update: (outside: WalkPosition) => {
      view.rerender(at(outside));
    },
  };
}

// Frozen all the way down, so a write to any part throws during the moves.
function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

const spokenOn = (blockId: string, spans: Spans): Segment => ({
  target: { type: "block", blockId },
  text: spanText(spans),
});

describe("the test controller", () => {
  it("clears the announcement at first, on a switch to any sequence and on an update from outside", () => {
    const walk = control(swap, { sequence: 1, step: 1 });
    expect(screen.getByText("Step 1 of 3").tagName).toBe("P");
    expect(walk.said()).toBe("");
    walk.press("Next");
    expect(walk.said()).toBe("Step 2 of 3: Copy the letter over the number.");
    walk.press("Overwrite first");
    expect(walk.said()).toBe("");
    walk.press("Next");
    expect(walk.said()).toBe("Step 1 of 2: Write over the number.");
    walk.press("Overwrite first");
    expect(screen.getByText("Start").tagName).toBe("P");
    expect(walk.said()).toBe("");
    walk.press("Next");
    walk.update({ sequence: 1, step: 3 });
    expect(screen.getByText("Step 3 of 3").tagName).toBe("P");
    expect(walk.said()).toBe("");
  });

  it("announces its own Prev and Next with the words of where each lands", () => {
    const walk = control(swap, { sequence: 2, step: 1 });
    walk.press("Next");
    expect(walk.said()).toBe("Step 2 of 2: Write zero into the second cell.");
    expect(screen.getByText("Step 2 of 2").tagName).toBe("P");
    expect(screen.getByText("Write zero into the second cell.").tagName).toBe(
      "P",
    );
    walk.press("Prev");
    expect(walk.said()).toBe("Step 1 of 2: Write over the number.");
    expect(screen.getByText("Step 1 of 2").tagName).toBe("P");
    expect(screen.getByText("Write over the number.").tagName).toBe("P");
    expect(cellTexts()).toEqual([
      "0: 3 lost 7 ← written",
      "1: “x”",
      "2: empty",
    ]);
    expect(cellStates()).toEqual(["destination", null, "empty"]);
  });

  it("tells Prev to Start apart from choosing the current sequence at the same position", () => {
    const walk = control(swap, { sequence: 1, step: 1 });
    walk.press("Prev");
    const byPrev = { said: walk.said(), shown: walk.unread() };
    walk.press("Next");
    walk.press("Through the spare");
    expect(byPrev.said).toBe("Start: The spare cell holds a copy.");
    expect(walk.said()).toBe("");
    expect(walk.unread().isEqualNode(byPrev.shown)).toBe(true);
  });

  it("recovers when an invalid position from outside is followed by a valid one", () => {
    const walk = control(swap, { sequence: 1, step: 0 });
    walk.press("Next");
    walk.update({ sequence: 1, step: 4 });
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(walk.said()).toBe("");
    walk.update({ sequence: 2, step: 1 });
    expect(screen.getByText("Step 1 of 2").tagName).toBe("P");
    expect(walk.said()).toBe("");
    walk.press("Next");
    expect(walk.said()).toBe("Step 2 of 2: Write zero into the second cell.");
  });

  it("leaves the walk and its speech records, texts and audio hash unchanged by every kind of move", () => {
    const block = frozen(structuredClone(swap));
    const spoken: Speech = frozen({
      segments: [
        spokenOn(block.blockId, block.title),
        ...block.sequences.flatMap((sequence) => [
          spokenOn(sequence.introBlockId, sequence.intro),
          ...sequence.steps.map((step) => spokenOn(step.blockId, step.note)),
        ]),
      ],
      audio: `sha256:${"0123456789abcdef".repeat(4)}`,
    });
    const before = structuredClone(spoken);
    const walk = control(block, { sequence: 1, step: 0 });
    walk.press("Next");
    walk.press("Next");
    walk.press("Prev");
    walk.press("Overwrite first");
    walk.press("Next");
    walk.press("Next");
    walk.press("Overwrite first");
    walk.update({ sequence: 3, step: 0 });
    walk.update({ sequence: 1, step: 3 });
    walk.press("Prev");
    expect(walk.said()).toBe("Step 2 of 3: Copy the letter over the number.");
    expect(block).toStrictEqual(swap);
    expect(spoken).toStrictEqual(before);
    expect(spoken.segments).toHaveLength(8);
  });
});
