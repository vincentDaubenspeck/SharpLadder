import { render, screen } from "@testing-library/react";
import { describe, expect, inject, it } from "vitest";
import type {
  Block,
  LinkSpan,
  ListItem,
  Span,
  TermSpan,
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
import { BuildPartView } from "./Build.tsx";
import { ContentView } from "./ContentView.tsx";
import { buildSlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

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

// The test's own controller: it holds no state, so a view shows exactly the selection it was given.
function Shown({ doc }: { doc: ShownDoc }) {
  return doc.type === "build-view" ? (
    <BuildPartView
      view={doc}
      slugs={slugs}
      onApproachChange={() => undefined}
    />
  ) : (
    <ContentView doc={doc} slugs={slugs} />
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

// The hook ids a run of blocks renders: each block's own and each list item's.
const hookIds = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((b) => [
    b.blockId,
    ...(b.type === "list" ? b.items.map((i) => i.blockId) : []),
  ]);

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

// The ids the renderer may write as anchors: entry, section, card and shown approach ids and code
// or text block ids.
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
];

const spansOf = (spans: readonly Span[]): Span[] =>
  spans.flatMap((s) =>
    s.type === "em" || s.type === "strong" ? [s, ...spansOf(s.content)] : [s],
  );

const blockSpans = (b: Block): Span[] => {
  if (b.type === "paragraph") return [...b.content];
  if (b.type === "list") return b.items.flatMap((i) => i.content);
  if (b.type === "table") return [b.headers, ...b.rows].flat(2);
  return [];
};

// Every span in the order it is rendered: a title before what stands under it.
const spansInOrder = (doc: ShownDoc): Span[] => {
  const sections = sectionsOf(doc).flatMap((s) => [
    ...s.title,
    ...("cards" in s
      ? s.cards.flatMap((c) => [
          ...c.title,
          ...cardBlocks(c).flatMap(blockSpans),
        ])
      : s.body.flatMap(blockSpans)),
    ...(selectedOf(s)?.title ?? []),
    ...(selectedOf(s)?.body.flatMap(blockSpans) ?? []),
  ]);
  switch (doc.type) {
    case "chapter":
      return [...doc.intro.flatMap(blockSpans), ...sections];
    case "part":
    case "build-view":
      return sections;
    case "glossary":
    case "error":
      return blocksOf(doc).flatMap(blockSpans);
  }
};

const linksOf = (doc: ShownDoc): LinkSpan[] =>
  spansOf(spansInOrder(doc)).flatMap((s) => (s.type === "link" ? [s] : []));

const termsOf = (doc: ShownDoc): TermSpan[] =>
  spansOf(spansInOrder(doc)).flatMap((s) => (s.type === "term" ? [s] : []));

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
            .flatMap((a) => hookIds(a.body)),
        )
      : [],
  );

const speechSections = (doc: RoundTripDoc) =>
  doc.type === "chapter" || doc.type === "part" ? [...doc.sections] : [];

/**
 * What a rendered record fails to prove about its speech: every segment bound to exactly one
 * rendered hook inside its section, in reading order, and a segment of an unselected approach
 * to none. A skipped section holds its one summary and nothing else.
 */
function speechProblems(
  container: Element,
  doc: RoundTripDoc,
  selection: ApproachSelection = nothing,
): string[] {
  const problems: string[] = [];
  const unselected = unselectedHooks(doc, selection);
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
        // A Term's definition link follows its button, in reading order with the other links.
        const expected = spansOf(spansInOrder(shown)).flatMap((s) => {
          if (s.type === "term") return [`/glossary#${s.id}`];
          if (s.type !== "link") return [];
          if (s.kind === "error") return [`/errors#${s.id}`];
          return s.chapter === undefined
            ? [`#${s.id}`]
            : [`/chapters/${String(slugs.slugOf(s.chapter))}#${s.id}`];
        });
        expect(targets).toEqual(expected);
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
        const lists = [...container.querySelectorAll("ul, ol")];
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
