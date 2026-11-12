import { fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, inject, it } from "vitest";
import type { LinkContentSpan } from "../generated/body.ts";
import type { HintsCatalogue, HintsPart } from "../generated/content.ts";
import { witness as fixtureCatalogue } from "../generated/witness/chapters/fixture-basics/hints.catalogue.ts";
import { staticDoc } from "../content/approach.ts";
import type { StaticDoc } from "../content/approach.ts";
import { ContentView } from "../content/ContentView.tsx";
import { checkedHintsView, selectHints } from "../content/hints.ts";
import type { HintsView } from "../content/hints.ts";
import { HintsPartView } from "../content/Hints.tsx";
import { buildSlugMap } from "../content/href.ts";
import { validHintsView } from "./hints-view.ts";

// Each catalogue path with the witness emitted from the same validated bytes.
const witnesses = new Map<string, HintsCatalogue>([
  ["compiled/chapters/fixture-basics/hints.catalogue.json", fixtureCatalogue],
]);

// Records come only from the compiler-backed global setup; without them this file fails to load.
const records = inject("contentRecords");
const catalogues = records.filter((r) => r.kind === "hints-catalogue");
const parts = records.filter((r) => r.kind === "part" && r.part === "hints");
const patternsText = records.find((r) => r.kind === "patterns")?.text;
if (
  catalogues.length === 0 ||
  parts.length !== catalogues.length ||
  patternsText === undefined
)
  throw new Error("the global setup provided no hints records");

const patterns = (
  JSON.parse(patternsText) as {
    patterns: { id: string; title: string; summary: string }[];
  }
).patterns;
const slugs = buildSlugMap([]);
const noop = () => undefined;
const nowhere = "ladder-nowhere";

const textOf = (path: string): string => {
  const record = records.find((r) => r.path === path);
  if (record === undefined) throw new Error(`no record for ${path}`);
  return record.text;
};
const fullPathOf = (path: string) =>
  path.replace(/\.catalogue\.json$/u, ".json");
const cataloguePathOf = (path: string) =>
  path.replace(/\.json$/u, ".catalogue.json");

function witnessOf(path: string): HintsCatalogue {
  const witness = witnesses.get(path);
  if (witness === undefined) throw new Error(`no witness for ${path}`);
  return witness;
}

const flat = (spans: readonly LinkContentSpan[]): string =>
  spans
    .map((s) =>
      s.type === "text" || s.type === "code" ? s.text : flat(s.content),
    )
    .join("");

// Every text a ladder hides: its heading, technique, pattern and each rung, in full and by span.
function hiddenTexts(part: HintsPart): string[] {
  const spanTexts = (spans: readonly LinkContentSpan[]): string[] =>
    spans.flatMap((s) =>
      s.type === "text" || s.type === "code" ? [s.text] : spanTexts(s.content),
    );
  return part.sections
    .flatMap((ladder) => {
      const pattern = patterns.find((p) => p.id === ladder.pattern);
      return [
        flat(ladder.title),
        ladder.approach,
        ladder.pattern,
        ...(pattern === undefined ? [] : [pattern.title, pattern.summary]),
        ...ladder.rungs.flatMap((r) => [
          flat(r.content),
          ...spanTexts(r.content),
        ]),
      ];
    })
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
}

// Everything a rendered view exposes: its text and every attribute, accessible names included.
function exposed(container: HTMLElement): string {
  const attributes = [...container.querySelectorAll("*")].flatMap((e) =>
    [...e.attributes].map((a) => `${a.name}=${a.value}`),
  );
  return [container.textContent, ...attributes].join("\n");
}

interface State {
  readonly name: string;
  readonly references: readonly string[];
  readonly selected: string | null;
}

// Every selection state: none, each ladder, an id no ladder has, and each ladder named alone.
function statesOf(catalogue: HintsCatalogue): State[] {
  const ids = catalogue.ladders.map((l) => l.id);
  return [
    { name: "nothing", references: ids, selected: null },
    ...ids.map((id) => ({ name: id, references: ids, selected: id })),
    { name: "an unknown id", references: ids, selected: nowhere },
    ...ids.map((id) => ({
      name: `${id} alone`,
      references: [id],
      selected: null,
    })),
    ...ids.map((id) => ({
      name: `${id} alone with an unknown id`,
      references: [id],
      selected: nowhere,
    })),
  ];
}

// The ladder a state shows: the one selected, or a lone ladder when nothing is.
function shownIn(catalogue: HintsCatalogue, state: State) {
  const id =
    state.selected ??
    (state.references.length === 1 ? (state.references[0] ?? null) : null);
  return id !== null && state.references.includes(id)
    ? catalogue.ladders.find((l) => l.id === id)
    : undefined;
}

function show(catalogue: HintsCatalogue, state: State) {
  const view = validHintsView(
    selectHints(catalogue, state.references, state.selected),
  );
  return {
    view,
    ...render(<HintsPartView view={view} onHintChange={noop} />),
  };
}

// The controller a host page writes: the selection is its state, chosen by position.
function Controller({
  catalogue,
  references,
  chosen,
}: {
  catalogue: HintsCatalogue;
  references: readonly string[];
  chosen: unknown[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <HintsPartView
      view={validHintsView(selectHints(catalogue, references, selected))}
      onHintChange={(index) => {
        chosen.push(index);
        setSelected(references[index] ?? nowhere);
      }}
    />
  );
}

describe.each(catalogues.map((r) => [r.path, r.text] as const))(
  "the hints view of %s",
  (path, text) => {
    const catalogue = witnessOf(path);
    const states = statesOf(catalogue);

    it("parses to its witness and passes the closed view schema in every selection", () => {
      const parsed: unknown = JSON.parse(text);
      expect(parsed).toStrictEqual(catalogue);
      for (const state of states)
        expect(() =>
          validHintsView(
            selectHints(catalogue, state.references, state.selected),
          ),
        ).not.toThrow();
    });

    it("mounts no cue without a selection or with an unknown one", () => {
      const empty = states.filter((s) => shownIn(catalogue, s) === undefined);
      expect(empty.map((s) => s.name)).toContain("nothing");
      expect(empty.map((s) => s.name)).toContain("an unknown id");
      for (const state of empty) {
        const { container, view, unmount } = show(catalogue, state);
        expect(view.selectedIndex).toBeNull();
        expect(Object.hasOwn(view, "selected")).toBe(false);
        expect(
          container.querySelectorAll("[data-section-id], [data-block-id]"),
        ).toHaveLength(0);
        for (const ladder of catalogue.ladders)
          expect(exposed(container)).not.toContain(ladder.cue.text);
        unmount();
      }
    });

    it("mounts the selected cue alone under its own hooks", () => {
      for (const state of states) {
        const ladder = shownIn(catalogue, state);
        if (ladder === undefined) continue;
        const { container, unmount } = show(catalogue, state);
        const sections = [...container.querySelectorAll("[data-section-id]")];
        const blocks = [...container.querySelectorAll("[data-block-id]")];
        expect(sections.map((e) => e.getAttribute("data-section-id"))).toEqual([
          ladder.id,
        ]);
        expect(blocks.map((e) => e.getAttribute("data-block-id"))).toEqual([
          ladder.cue.blockId,
        ]);
        expect(blocks[0]?.tagName).toBe("P");
        expect(blocks[0]?.textContent).toBe(ladder.cue.text);
        expect(blocks[0]?.parentElement).toBe(sections[0]);
        for (const other of catalogue.ladders.filter((l) => l !== ladder))
          expect(exposed(container)).not.toContain(other.cue.text);
        unmount();
      }
    });

    it("labels options by position and shows a picker only for a choice", () => {
      for (const state of states) {
        const { container, unmount } = show(catalogue, state);
        const shown = shownIn(catalogue, state);
        const buttons = within(container).queryAllByRole("button");
        expect(
          [...container.querySelectorAll("h2")].map((h) => h.textContent),
        ).toEqual(["Hints"]);
        if (state.references.length === 1) {
          expect(buttons).toHaveLength(0);
          expect(container.querySelectorAll('[role="group"]')).toHaveLength(0);
        } else {
          const group = within(container).getByRole("group");
          expect(group.getAttribute("aria-label")).toBe("Hint approaches");
          expect(buttons.map((b) => b.textContent)).toEqual(
            state.references.map(
              (_, i) => `Approach ${"ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(i)}`,
            ),
          );
          expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(
            state.references.map((id) => String(id === shown?.id)),
          );
          expect(buttons.every((b) => b.parentElement === group)).toBe(true);
        }
        unmount();
      }
    });

    it("speaks the selected cue alone, bound to its rendered hook", () => {
      for (const state of states) {
        const { container, view, unmount } = show(catalogue, state);
        const shown = shownIn(catalogue, state);
        expect(view.segments).toStrictEqual(shown?.spoken.segments ?? []);
        for (const segment of view.segments) {
          const target = segment.target;
          if (target.type !== "block")
            throw new Error("a cue is spoken from its block");
          expect(
            [...container.querySelectorAll("[data-block-id]")].filter(
              (e) => e.getAttribute("data-block-id") === target.blockId,
            ),
          ).toHaveLength(1);
        }
        unmount();
      }
    });

    it("lets nothing its ladders hide reach the page in any selection", () => {
      const full = JSON.parse(textOf(fullPathOf(path))) as HintsPart;
      const hidden = hiddenTexts(full);
      expect(hidden.length).toBeGreaterThan(0);
      for (const state of states) {
        const { container, view, unmount } = show(catalogue, state);
        const shownText = exposed(container);
        const viewText = JSON.stringify(view);
        for (const text of hidden) {
          expect(shownText).not.toContain(text);
          expect(viewText).not.toContain(JSON.stringify(text).slice(1, -1));
        }
        unmount();
      }
    });

    it("changes the cue only through the picker's positions", () => {
      const ids = catalogue.ladders.map((l) => l.id);
      const chosen: unknown[] = [];
      const { container, unmount } = render(
        <Controller catalogue={catalogue} references={ids} chosen={chosen} />,
      );
      const cue = () =>
        [...container.querySelectorAll("[data-block-id]")].map(
          (e) => e.textContent,
        );
      expect(cue()).toEqual(
        ids.length === 1 ? [catalogue.ladders[0].cue.text] : [],
      );
      within(container)
        .queryAllByRole("button")
        .forEach((button, index) => {
          fireEvent.click(button);
          expect(button.getAttribute("aria-pressed")).toBe("true");
          expect(cue()).toEqual([catalogue.ladders[index]?.cue.text]);
        });
      expect(chosen).toEqual(ids.length === 1 ? [] : ids.map((_, i) => i));
      unmount();
    });
  },
);

describe.each(parts.map((r) => [r.path, r.text] as const))(
  "the hidden hints of %s",
  (path, text) => {
    const full: unknown = JSON.parse(text);
    const part = full as HintsPart;

    it("is refused as a catalogue, as a view and by the static view", () => {
      const ids = part.sections.map((s) => s.id);
      expect(() => selectHints(full as HintsCatalogue, ids, null)).toThrow(
        "only a hints catalogue has a hints view",
      );
      expect(() => validHintsView(full)).toThrow("not a hints view");
      expect(() => checkedHintsView(full as HintsView)).toThrow(
        "takes only a selected hints view",
      );
      expect(() =>
        render(<HintsPartView view={full as HintsView} onHintChange={noop} />),
      ).toThrow("takes only a selected hints view");
      expect(() => staticDoc(full as StaticDoc)).toThrow(
        "hints are shown only through their hints view",
      );
      expect(() =>
        render(<ContentView doc={full as StaticDoc} slugs={slugs} />),
      ).toThrow("hints are shown only through their hints view");
    });

    it("has a catalogue holding each ladder's cue and nothing it hides", () => {
      const catalogueText = textOf(cataloguePathOf(path));
      const catalogue = JSON.parse(catalogueText) as HintsCatalogue;
      expect([catalogue.chapter, catalogue.order]).toEqual([
        part.chapter,
        part.order,
      ]);
      expect(catalogue.ladders.map((l) => [l.id, l.cue])).toEqual(
        part.sections.map((s) => [s.id, s.cue]),
      );
      for (const ladder of catalogue.ladders)
        expect(Object.keys(ladder)).toEqual(["id", "cue", "spoken"]);
      for (const hidden of hiddenTexts(part))
        expect(catalogueText).not.toContain(
          JSON.stringify(hidden).slice(1, -1),
        );
    });
  },
);

describe("the hints selector", () => {
  const catalogue = fixtureCatalogue;
  const ids = catalogue.ladders.map((l) => l.id);

  it.each([
    ["no ladders", [], "names 1 to 26 ladders"],
    [
      "27 ladders",
      Array.from({ length: 27 }, (_, i) => `ladder-${String(i)}`),
      "names 1 to 26 ladders",
    ],
    ["a ladder twice", [ids[0] ?? "", ids[0] ?? ""], "names a ladder twice"],
    ["a ladder the catalogue lacks", [nowhere], `holds no ladder "${nowhere}"`],
  ])("refuses %s", (_, references, message) => {
    expect(() => selectHints(catalogue, references, null)).toThrow(message);
  });

  it("follows the caller's order and assumes no ladder among several", () => {
    const reversed = [...ids].reverse();
    const view = selectHints(catalogue, reversed, null);
    expect(view.selectedIndex).toBeNull();
    expect(view.segments).toEqual([]);
    const last = reversed[0] ?? "";
    expect(selectHints(catalogue, reversed, last).selectedIndex).toBe(0);
    expect(selectHints(catalogue, reversed, last).selected?.id).toBe(last);
  });

  it("leaves the catalogue as it was", () => {
    const before = structuredClone(catalogue);
    for (const state of statesOf(catalogue))
      selectHints(catalogue, state.references, state.selected);
    expect(catalogue).toStrictEqual(before);
  });
});

describe("forged hints views", () => {
  const catalogue = fixtureCatalogue;
  const ids = catalogue.ladders.map((l) => l.id);
  const picked = selectHints(catalogue, ids, ids[0] ?? null);
  const empty = selectHints(catalogue, ids, null);
  const other = catalogue.ladders[1];

  it.each([
    ["the catalogue itself", catalogue],
    ["a view with the rungs beside it", { ...picked, rungs: [] }],
    [
      "a cue with its technique",
      { ...picked, selected: { ...picked.selected, approach: "x" } },
    ],
    [
      "an option named by its ladder",
      { ...picked, options: [{ id: 0, label: ids[0] }] },
    ],
    [
      "two spoken cues",
      { ...picked, segments: [...picked.segments, ...other.spoken.segments] },
    ],
    ["a selection by ladder id", { ...picked, selectedIndex: ids[0] }],
  ])("refuses %s against the closed schema", (_, value) => {
    expect(() => validHintsView(value)).toThrow("not a hints view");
  });

  const cueRule = "shows a cue exactly when it selects one";
  const speechRule = "speaks the selected cue alone";
  it.each([
    [
      "a cue with no selection",
      { ...empty, selected: picked.selected },
      cueRule,
    ],
    ["a selection with no cue", { ...empty, selectedIndex: 0 }, cueRule],
    ["a selection past the options", { ...picked, selectedIndex: 5 }, cueRule],
    [
      "options out of order",
      { ...picked, options: [...picked.options].reverse() },
      "labels its options by position alone",
    ],
    [
      "another ladder's speech",
      { ...picked, segments: other.spoken.segments },
      speechRule,
    ],
    ["a cue without its speech", { ...picked, segments: [] }, speechRule],
  ])("refuses %s by how its parts relate", (_, value, message) => {
    expect(() => validHintsView(value)).toThrow(message);
    expect(() => checkedHintsView(value as HintsView)).toThrow(message);
  });

  // Each keeps the shape and every relation above, so only the selector's issue tells it apart.
  const issuedRule = "renders only as the selector issued it";
  const cue = picked.selected ?? { id: "", blockId: "", cue: "" };
  it.each([
    ["an exact copy", { ...picked }],
    ["a structured clone", structuredClone(picked)],
    ["a proxy of an issued view", new Proxy(picked, {})],
    [
      "another ladder's id on the cue",
      { ...picked, selected: { ...cue, id: other.id } },
    ],
    ["the other position for the same cue", { ...picked, selectedIndex: 1 }],
    [
      "a cue with other text",
      { ...picked, selected: { ...cue, cue: "HIDDEN_RUNG_SENTINEL" } },
    ],
    [
      "speech with other text",
      {
        ...picked,
        segments: picked.segments.map((s) => ({
          ...s,
          text: "HIDDEN_TECHNIQUE_SENTINEL",
        })),
      },
    ],
  ])("refuses %s as never issued", (_, value) => {
    expect(() => validHintsView(value)).toThrow(issuedRule);
    expect(() => checkedHintsView(value)).toThrow(issuedRule);
    expect(() =>
      render(<HintsPartView view={value} onHintChange={noop} />),
    ).toThrow(issuedRule);
  });

  it("issues each view frozen to its last object", () => {
    for (const view of [picked, empty]) {
      const parts: unknown[] = [
        view,
        view.options,
        ...view.options,
        view.segments,
        ...view.segments,
        ...view.segments.map((s) => s.target),
        ...(view.selected === undefined ? [] : [view.selected]),
      ];
      expect(parts.every((part) => Object.isFrozen(part))).toBe(true);
    }
    expect(picked.segments.length).toBeGreaterThan(0);
    expect(() => {
      (cue as { cue: string }).cue = "HIDDEN_RUNG_SENTINEL";
    }).toThrow(TypeError);
    expect(() => {
      (picked.segments[0] as { text: string }).text = "x";
    }).toThrow(TypeError);
    expect(picked.selected?.cue).toBe(catalogue.ladders[0].cue.text);
    expect(() => validHintsView(picked)).not.toThrow();
  });

  it("refuses a catalogue and a view in the static view", () => {
    for (const doc of [catalogue, picked] as unknown[]) {
      expect(() => staticDoc(doc as StaticDoc)).toThrow(
        "hints are shown only through their hints view",
      );
      expect(() =>
        render(<ContentView doc={doc as StaticDoc} slugs={slugs} />),
      ).toThrow("hints are shown only through their hints view");
    }
  });
});
