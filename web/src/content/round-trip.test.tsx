import { render, screen } from "@testing-library/react";
import { describe, expect, inject, it } from "vitest";
import type { Block, LinkSpan, Span } from "../generated/body.ts";
import type { ContentDoc } from "../generated/content.ts";
import { witness as build } from "../generated/witness/chapters/fixture-basics/build.ts";
import { witness as basics } from "../generated/witness/chapters/fixture-basics/chapter.ts";
import { witness as gotchas } from "../generated/witness/chapters/fixture-basics/gotchas.ts";
import { witness as idioms } from "../generated/witness/chapters/fixture-basics/idioms.ts";
import { witness as library } from "../generated/witness/chapters/fixture-basics/library.ts";
import { witness as syntax } from "../generated/witness/chapters/fixture-basics/syntax.ts";
import { witness as emptyIntro } from "../generated/witness/chapters/fixture-empty-intro/chapter.ts";
import { witness as noSections } from "../generated/witness/chapters/fixture-no-sections/chapter.ts";
import { witness as second } from "../generated/witness/chapters/fixture-second/chapter.ts";
import { ContentView } from "./ContentView.tsx";
import { buildSlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

// Each compiled record path with the witness emitted from the same validated bytes.
const witnesses = new Map<string, ContentDoc>([
  ["compiled/chapters/fixture-basics/build.json", build],
  ["compiled/chapters/fixture-basics/chapter.json", basics],
  ["compiled/chapters/fixture-basics/gotchas.json", gotchas],
  ["compiled/chapters/fixture-basics/idioms.json", idioms],
  ["compiled/chapters/fixture-basics/library.json", library],
  ["compiled/chapters/fixture-basics/syntax.json", syntax],
  ["compiled/chapters/fixture-empty-intro/chapter.json", emptyIntro],
  ["compiled/chapters/fixture-no-sections/chapter.json", noSections],
  ["compiled/chapters/fixture-second/chapter.json", second],
]);

// Records come only from the compiler-backed global setup; without them this file fails to
// load, so no case is skipped into a pass and none is built from a fallback.
function provided(
  value: unknown,
): readonly { path: string; kind: string; text: string }[] {
  const isRecord = (
    r: unknown,
  ): r is { path: string; kind: string; text: string } =>
    typeof r === "object" &&
    r !== null &&
    "path" in r &&
    typeof r.path === "string" &&
    "kind" in r &&
    typeof r.kind === "string" &&
    "text" in r &&
    typeof r.text === "string";
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("the global setup provided no content records");
  const entries: unknown[] = value;
  if (!entries.every(isRecord))
    throw new Error("the global setup provided a malformed content record");
  return entries;
}

// The registries have no view, so only chapter and part records make the round trip.
const records = provided(inject("contentRecords")).filter(
  (r) => r.kind === "chapter" || r.kind === "part",
);
const slugs = buildSlugMap([basics, emptyIntro, noSections, second]);

function witnessOf(path: string): ContentDoc {
  const witness = witnesses.get(path);
  if (witness === undefined) throw new Error(`no witness for ${path}`);
  return witness;
}

function textOf(path: string): string {
  const record = records.find((r) => r.path === path);
  if (record === undefined) throw new Error(`no record for ${path}`);
  return record.text;
}

// Rendering happens only after the parsed bytes equal the witness, missing properties included.
function roundTrip(text: string, witness: ContentDoc) {
  const parsed: unknown = JSON.parse(text);
  expect(parsed).toStrictEqual(witness);
  return render(<ContentView doc={witness} slugs={slugs} />);
}

const blocksOf = (doc: ContentDoc): Block[] =>
  doc.type === "chapter"
    ? [...doc.intro, ...doc.sections.flatMap((s) => s.body)]
    : doc.sections.flatMap((s) => s.body);

// The ids the renderer may write as anchors: section ids and code or text block ids.
const anchorsOf = (doc: ContentDoc): string[] => [
  ...doc.sections.map((s) => s.id),
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

const linksOf = (doc: ContentDoc): LinkSpan[] => {
  const spans = [
    ...doc.sections.flatMap((s) => s.title),
    ...blocksOf(doc).flatMap((b) => {
      if (b.type === "paragraph") return b.content;
      if (b.type === "list") return b.items.flatMap((i) => i.content);
      return [];
    }),
  ];
  return spansOf(spans).flatMap((s) => (s.type === "link" ? [s] : []));
};

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

/**
 * What a rendered record fails to prove about its speech: every segment bound to exactly one
 * rendered hook inside its section, in reading order. A skipped section holds its one summary
 * and nothing else.
 */
function speechProblems(container: Element, doc: ContentDoc): string[] {
  const problems: string[] = [];
  const all = [...container.querySelectorAll("[data-block-id]")].map((e) =>
    e.getAttribute("data-block-id"),
  );
  if (new Set(all).size !== all.length)
    problems.push("a block hook is rendered more than once");
  for (const section of doc.sections) {
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
    expect(() =>
      roundTrip(text, { ...basics, order: basics.order + 1 }),
    ).toThrow();
    expect(() =>
      roundTrip(text, { ...basics, extra: undefined } as ContentDoc),
    ).toThrow();
    expect(screen.queryAllByRole("heading")).toEqual([]);
  });
});

describe.each(records.map((r) => [r.path, r.text] as const))(
  "the round trip of %s",
  (path, text) => {
    const witness = witnessOf(path);

    it("renders only after the bytes equal the witness", () => {
      const { container } = roundTrip(text, witness);
      expect(container.childElementCount).toBeGreaterThan(0);
    });

    it("writes exactly the compiled anchors as ids, labels apart", () => {
      const { container } = roundTrip(text, witness);
      const ids = [...container.querySelectorAll("[id]")];
      const anchors = ids.filter((e) => e.tagName !== "SPAN").map((e) => e.id);
      expect(anchors.sort()).toEqual(anchorsOf(witness).sort());
      expect(new Set(ids.map((e) => e.id)).size).toBe(ids.length);
      for (const label of ids.filter((e) => e.tagName === "SPAN"))
        expect(anchorsOf(witness)).not.toContain(label.id);
    });

    it("places block ids and labels on their own elements", () => {
      const { container } = roundTrip(text, witness);
      const codes = [...container.querySelectorAll("pre > code")];
      for (const block of blocksOf(witness)) {
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

    it("builds every link href from its target and chapter only", () => {
      const { container } = roundTrip(text, witness);
      const targets = [...container.querySelectorAll("a")].map((a) =>
        a.getAttribute("href"),
      );
      const expected = linksOf(witness).map((l) =>
        l.chapter === undefined
          ? `#${l.id}`
          : `/chapters/${String(slugs.slugOf(l.chapter))}#${l.id}`,
      );
      expect(targets).toEqual(expected);
      for (const href of targets) expect(href).toMatch(/^(?:#|\/chapters\/)/u);
      expect(container.querySelector("a a")).toBeNull();
    });

    it("leaves no empty wrapper element", () => {
      const { container } = roundTrip(text, witness);
      for (const element of container.querySelectorAll("*"))
        expect(element.childNodes.length).toBeGreaterThan(0);
    });

    it("starts headings at h2 and never skips a level", () => {
      const { container } = roundTrip(text, witness);
      expect(headingProblems(container)).toEqual([]);
    });

    it("keeps each list's kind and start", () => {
      const { container } = roundTrip(text, witness);
      const lists = [...container.querySelectorAll("ul, ol")];
      const blocks = blocksOf(witness).flatMap((b) =>
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

    it("names every link by its author text, never its address", () => {
      roundTrip(text, witness);
      const links = screen.queryAllByRole("link");
      expect(links.map((a) => a.textContent)).toEqual(
        linksOf(witness).map((l) => spansText(l.content)),
      );
      for (const link of links) {
        expect(link.textContent).not.toBe("");
        expect(link.textContent).not.toBe(link.getAttribute("href"));
        expect(link).toHaveAccessibleName(link.textContent);
      }
    });

    it("binds every spoken segment to one rendered hook, in order", () => {
      const { container } = roundTrip(text, witness);
      expect(speechProblems(container, witness)).toEqual([]);
    });
  },
);

describe("speech check", () => {
  const path = "compiled/chapters/fixture-basics/library.json";
  const changed = (edit: (doc: ContentDoc) => void): string[] => {
    const doc = structuredClone(witnessOf(path));
    edit(doc);
    const { container } = render(<ContentView doc={doc} slugs={slugs} />);
    return speechProblems(container, doc);
  };
  const first = (doc: ContentDoc) => {
    const speech = doc.sections.map((s) => s.spoken);
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
      (doc: ContentDoc) => {
        const [segment] = first(doc).segments;
        if (segment?.target.type === "block")
          segment.target.blockId = "lib-fix-one/b99";
      },
      "resolves to 0 hooks",
    ],
    [
      "a target in another section",
      (doc: ContentDoc) => {
        const speech = first(doc);
        const other = doc.sections
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
      (doc: ContentDoc) => {
        first(doc).segments.reverse();
      },
      "is out of reading order",
    ],
    [
      "one block spoken twice",
      (doc: ContentDoc) => {
        const speech = first(doc);
        const [segment] = speech.segments;
        if (segment !== undefined) speech.segments.splice(1, 0, segment);
      },
      "is out of reading order",
    ],
    [
      "a summary beside block segments",
      (doc: ContentDoc) => {
        const section = doc.sections.find((s) => s.spoken.segments.length > 1);
        section?.spoken.segments.push({
          target: { type: "section", sectionId: section.id },
          text: "x",
        });
      },
      "a summary stands beside other segments",
    ],
    [
      "a summary for another section",
      (doc: ContentDoc) => {
        const speech = doc.sections
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
      .flatMap(blocksOf)
      .flatMap((b) => (b.type === "code" || b.type === "text" ? [b] : []));
    expect(sources.some((b) => b.label !== undefined)).toBe(true);
    expect(sources.some((b) => b.label === undefined)).toBe(true);
  });
});

describe("links in the compiled records", () => {
  const targetsOf = (path: string) => {
    const { container, unmount } = roundTrip(textOf(path), witnessOf(path));
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
  const view = (path: string) =>
    roundTrip(textOf(path), witnessOf(path)).container;

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
