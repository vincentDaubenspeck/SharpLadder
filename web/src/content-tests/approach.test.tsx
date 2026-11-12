import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { BuildPart } from "../generated/content.ts";
import { witness as buildWitness } from "../generated/witness/chapters/fixture-basics/build.ts";
import { witness as basics } from "../generated/witness/chapters/fixture-basics/chapter.ts";
import { witness as syntax } from "../generated/witness/chapters/fixture-basics/syntax.ts";
import { witness as second } from "../generated/witness/chapters/fixture-second/chapter.ts";
import {
  checkedBuildView,
  projectBuild,
  staticDoc,
} from "../content/approach.ts";
import type {
  ApproachSelection,
  BuildView,
  StaticDoc,
} from "../content/approach.ts";
import { BuildPartView } from "../content/Build.tsx";
import { ContentView } from "../content/ContentView.tsx";
import { buildSlugMap } from "../content/href.ts";

const build: BuildPart = buildWitness;
const slugs = buildSlugMap([basics, second]);
const none: ApproachSelection = new Map<string, string>();

// The fixture's two sections with approaches: one of two with a shared lead, one of three without.
const two = "build-fix-total";
const three = "build-fix-three";

const sectionOf = (id: string) => {
  const section = build.sections.find((s) => s.id === id);
  if (section?.approaches === undefined)
    throw new Error(`the fixture has no approaches in ${id}`);
  return { ...section, approaches: section.approaches };
};

// Every object and array a value holds, itself included, each once.
function reachable(value: unknown, seen = new Set<object>()): Set<object> {
  if (typeof value !== "object" || value === null || seen.has(value))
    return seen;
  seen.add(value);
  for (const inner of Object.values(value)) reachable(inner, seen);
  return seen;
}

// What a view must never hold: a body, or any block of one, of an approach it does not show.
function leaked(view: BuildView, selection: ApproachSelection): object[] {
  const held = reachable(view);
  return build.sections
    .flatMap((s) =>
      (s.approaches ?? []).filter((a) => a.id !== selection.get(s.id)),
    )
    .flatMap((a) => [...reachable(a.body)])
    .filter((part) => held.has(part));
}

const selections: [string, ApproachSelection][] = [
  ["nothing", none],
  [
    "the first of each",
    new Map([two, three].map((id) => [id, sectionOf(id).approaches[0].id])),
  ],
  [
    "the second of each",
    new Map([two, three].map((id) => [id, sectionOf(id).approaches[1].id])),
  ],
  ["one section alone", new Map([[three, "build-fix-third"]])],
  ["an id no approach has", new Map([[two, "build-fix-nowhere"]])],
  ["another section's approach", new Map([[two, "build-fix-third"]])],
];

describe("the build projection", () => {
  it.each(selections)(
    "holds no unselected body with %s selected",
    (_name, selection) => {
      const view = projectBuild(build, selection);
      expect(leaked(view, selection)).toEqual([]);
      for (const part of reachable(view))
        expect(Object.keys(part)).not.toContain("approaches");
      for (const section of view.sections)
        expect(Object.keys(section)).not.toContain("spoken");
    },
  );

  it.each(selections)(
    "lists every option and selects only a real one with %s selected",
    (_name, selection) => {
      const view = projectBuild(build, selection);
      expect(view.type).toBe("build-view");
      expect(view.sections.map((s) => s.id)).toEqual(
        build.sections.map((s) => s.id),
      );
      view.sections.forEach((shown, index) => {
        const source = build.sections[index];
        if (source === undefined) throw new Error("a section with no source");
        expect(shown.body).toBe(source.body);
        if (source.approaches === undefined) {
          expect(Object.keys(shown)).toEqual(["id", "number", "title", "body"]);
          return;
        }
        if (!("options" in shown))
          throw new Error("a section lost its options");
        expect(shown.options).toEqual(
          source.approaches.map((a) => ({ id: a.id, label: a.label })),
        );
        const wanted = selection.get(source.id);
        const real = source.approaches.find((a) => a.id === wanted);
        expect(shown.selectedApproachId).toBe(wanted ?? null);
        expect(Object.hasOwn(shown, "selected")).toBe(real !== undefined);
        if (real !== undefined)
          expect(shown.selected).toStrictEqual({
            id: real.id,
            title: real.title,
            body: real.body,
          });
      });
    },
  );

  it("leaves the compiled record, its speech and its audio slots as they were", () => {
    const before = structuredClone(build);
    for (const [, selection] of selections) projectBuild(build, selection);
    expect(build).toStrictEqual(before);
  });

  it("refuses a record that is not a build part", () => {
    const other: unknown = syntax;
    expect(() => projectBuild(other as BuildPart, none)).toThrow(
      "only a build part has a build view",
    );
  });

  it("refuses a selection that is not a map", () => {
    const loose: unknown = { [two]: "build-fix-loop" };
    expect(() => projectBuild(build, loose as ApproachSelection)).toThrow(
      "an approach selection is a map",
    );
  });
});

describe("the run-time refusals", () => {
  const full: unknown = build;
  const noop = () => undefined;

  it("refuses a full build part as a build view", () => {
    expect(() => checkedBuildView(full as BuildView)).toThrow(
      "takes only a projected build part",
    );
    expect(() =>
      render(
        <BuildPartView
          view={full as BuildView}
          slugs={slugs}
          onApproachChange={noop}
        />,
      ),
    ).toThrow("takes only a projected build part");
  });

  it("refuses a build view whose section still holds its approaches", () => {
    const view = projectBuild(build, none);
    const [first, ...rest] = view.sections;
    const tainted: unknown = {
      ...view,
      sections: [{ ...first, approaches: sectionOf(two).approaches }, ...rest],
    };
    expect(() => checkedBuildView(tainted as BuildView)).toThrow(
      "holds its approaches",
    );
  });

  it("refuses a build part and a build view in the static view", () => {
    const view: unknown = projectBuild(build, none);
    for (const doc of [full, view]) {
      expect(() => staticDoc(doc as StaticDoc)).toThrow(
        "shown only through its build view",
      );
      expect(() =>
        render(<ContentView doc={doc as StaticDoc} slugs={slugs} />),
      ).toThrow("shown only through its build view");
    }
  });
});

// The controller a host page writes: the selection is its state, and the view shows its projection.
function Controller({ initial }: { initial: ApproachSelection }) {
  const [selection, setSelection] = useState(initial);
  return (
    <BuildPartView
      view={projectBuild(build, selection)}
      slugs={slugs}
      onApproachChange={(sectionId, approachId) => {
        setSelection((old) => new Map(old).set(sectionId, approachId));
      }}
    />
  );
}

describe("the approach picker under a controller", () => {
  const sectionRoot = (container: Element, id: string): HTMLElement => {
    const root = [
      ...container.querySelectorAll<HTMLElement>("[data-section-id]"),
    ].find((e) => e.getAttribute("data-section-id") === id);
    if (root === undefined) throw new Error(`no section ${id}`);
    return root;
  };
  const pressed = (root: HTMLElement) =>
    within(root)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
  const headings = (root: HTMLElement) =>
    [...root.querySelectorAll("h4")].map((h) => h.id);

  it("names each group and shows every label as an unpressed button at first", () => {
    const { container } = render(<Controller initial={none} />);
    expect(
      screen.getAllByRole("group", { name: "Build approaches" }).length,
    ).toBe(2);
    for (const id of [two, three]) {
      const root = sectionRoot(container, id);
      expect(
        within(root)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(sectionOf(id).approaches.map((a) => a.label));
      expect(pressed(root)).toEqual([]);
      expect(headings(root)).toEqual([]);
    }
  });

  it("mounts the chosen approach, presses its button and keeps focus on it", () => {
    const { container } = render(<Controller initial={none} />);
    const root = sectionRoot(container, two);
    const button = within(root).getByRole("button", { name: "the library" });
    button.focus();
    fireEvent.click(button);
    expect(pressed(root)).toEqual(["the library"]);
    expect(headings(root)).toEqual(["build-fix-sum"]);
    expect(within(root).getByRole("button", { name: "the library" })).toBe(
      button,
    );
    expect(button).toHaveFocus();
  });

  it("swaps one approach for another and never shows two", () => {
    const { container } = render(<Controller initial={none} />);
    const root = sectionRoot(container, three);
    for (const approach of sectionOf(three).approaches) {
      fireEvent.click(
        within(root).getByRole("button", { name: approach.label }),
      );
      expect(pressed(root)).toEqual([approach.label]);
      expect(headings(root)).toEqual([approach.id]);
    }
  });

  it("keeps two sections' choices apart", () => {
    const { container } = render(<Controller initial={none} />);
    const first = sectionRoot(container, two);
    const other = sectionRoot(container, three);
    fireEvent.click(within(first).getByRole("button", { name: "a loop" }));
    expect(headings(other)).toEqual([]);
    expect(pressed(other)).toEqual([]);
    fireEvent.click(within(other).getByRole("button", { name: "third" }));
    expect(headings(first)).toEqual(["build-fix-loop"]);
    expect(headings(other)).toEqual(["build-fix-third"]);
    expect(pressed(first)).toEqual(["a loop"]);
  });

  it("shows the lead once whatever is chosen", () => {
    const { container } = render(<Controller initial={none} />);
    const root = sectionRoot(container, two);
    const lead = sectionOf(two).body.map((b) => b.blockId);
    expect(lead.length).toBeGreaterThan(0);
    const shown = () =>
      [...root.querySelectorAll("[data-block-id]")]
        .map((e) => e.getAttribute("data-block-id"))
        .filter((id) => id !== null && lead.includes(id));
    expect(shown()).toEqual(lead);
    fireEvent.click(within(root).getByRole("button", { name: "a loop" }));
    expect(shown()).toEqual(lead);
  });

  it("presses nothing for an unknown id and recovers on a real choice", () => {
    const { container } = render(
      <Controller initial={new Map([[two, "build-fix-nowhere"]])} />,
    );
    const root = sectionRoot(container, two);
    expect(pressed(root)).toEqual([]);
    expect(headings(root)).toEqual([]);
    expect(within(root).getAllByRole("button").length).toBe(2);
    fireEvent.click(within(root).getByRole("button", { name: "a loop" }));
    expect(pressed(root)).toEqual(["a loop"]);
    expect(headings(root)).toEqual(["build-fix-loop"]);
  });
});
