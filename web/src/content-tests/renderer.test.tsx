import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  Block,
  CodeBlock,
  LinkSpan,
  TermSpan,
  TextBlock,
} from "../generated/body.ts";
import { witness as cards } from "../generated/witness/chapters/fixture-basics/cards.ts";
import { witness as basics } from "../generated/witness/chapters/fixture-basics/chapter.ts";
import { witness as syntax } from "../generated/witness/chapters/fixture-basics/syntax.ts";
import { witness as second } from "../generated/witness/chapters/fixture-second/chapter.ts";
import { assertNever } from "../content/assertNever.ts";
import { Blocks } from "../content/Blocks.tsx";
import type { StaticPart } from "../content/approach.ts";
import { ContentView } from "../content/ContentView.tsx";
import { buildSlugMap } from "../content/href.ts";
import { Spans } from "../content/Spans.tsx";

const slugs = buildSlugMap([basics, second]);

const labelledCode: CodeBlock = {
  type: "code",
  blockId: "sec/b1",
  id: "code-one",
  group: "code-group",
  label: "First listing",
  spoken: "first listing",
  source: 'Console.WriteLine("<b>hi</b>");',
};

const unlabelledText: TextBlock = {
  type: "text",
  blockId: "sec/b2",
  spoken: "output",
  source: "hi",
};

const labelledText: TextBlock = {
  type: "text",
  blockId: "sec/b3",
  id: "text-one",
  label: "Output",
  spoken: "output",
  source: "<script>x</script>",
};

function renderBlocks(blocks: readonly Block[]): HTMLElement {
  return render(<Blocks blocks={blocks} slugs={slugs} />).container;
}

function idsIn(root: HTMLElement): string[] {
  return [...root.querySelectorAll("[id]")].map((element) => element.id);
}

describe("assertNever", () => {
  it("throws on any value", () => {
    expect(() => assertNever("surprise" as never)).toThrow(
      /Unknown content variant: "surprise"/u,
    );
  });
});

describe("block DOM placement", () => {
  it("puts the block id on the div and the generated label id on the span", () => {
    const root = renderBlocks([labelledCode]);
    const div = root.querySelector("div#code-one");
    const span = div?.querySelector(":scope > span");
    const pre = div?.querySelector(":scope > pre");
    expect(span?.textContent).toBe("First listing");
    expect(span?.id).toMatch(/\S/u);
    expect(span?.id).not.toBe("code-one");
    expect(pre?.getAttribute("aria-labelledby")).toBe(span?.id);
    expect(pre?.querySelector(":scope > code")?.textContent).toBe(
      labelledCode.source,
    );
    expect(pre?.id).toBe("");
  });

  it("omits the span and the label reference on an unlabelled block", () => {
    const root = renderBlocks([unlabelledText]);
    const div = root.querySelector(":scope > div");
    expect(div?.hasAttribute("id")).toBe(false);
    expect(div?.querySelector("span")).toBeNull();
    expect(root.querySelector("[aria-labelledby]")).toBeNull();
    expect(div?.querySelector(":scope > pre > code")?.textContent).toBe("hi");
  });

  it("never writes a blockId or group as an id and never repeats an id", () => {
    const root = renderBlocks([labelledCode, unlabelledText, labelledText]);
    const ids = idsIn(root);
    expect(ids).not.toContain(labelledCode.blockId);
    expect(ids).not.toContain(labelledCode.group);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of root.querySelectorAll("[aria-labelledby]")) {
      const target = reference.getAttribute("aria-labelledby") ?? "";
      expect(root.querySelector(`[id="${target}"]`)?.tagName).toBe("SPAN");
    }
  });

  it("renders source text literally", () => {
    const root = renderBlocks([labelledText]);
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("pre code")?.textContent).toBe(
      "<script>x</script>",
    );
  });
});

describe("content view", () => {
  it("renders chapter sections as h2 anchors and no h1", () => {
    const { container } = render(<ContentView doc={basics} slugs={slugs} />);
    expect(container.querySelector("h1")).toBeNull();
    const headings = [...container.querySelectorAll("h2")].map((h) => h.id);
    expect(headings).toEqual(basics.sections.map((section) => section.id));
  });

  it("renders a part heading from its kind with h3 section anchors", () => {
    const { container } = render(<ContentView doc={syntax} slugs={slugs} />);
    const heading = container.querySelector("h2");
    expect(heading?.textContent).toBe("Syntax");
    expect(heading?.hasAttribute("id")).toBe(false);
    const sections = [...container.querySelectorAll("h3")].map((h) => h.id);
    expect(sections).toEqual(syntax.sections.map((section) => section.id));
  });

  it.each([
    ["syntax", "Syntax"],
    ["idioms", "Idioms"],
    ["gotchas", "Gotchas"],
    ["library", "Library"],
  ] as const)("labels a %s part", (kind, label) => {
    const part: StaticPart = { ...syntax, kind };
    const { container } = render(<ContentView doc={part} slugs={slugs} />);
    expect(container.querySelector("h2")?.textContent).toBe(label);
  });

  it("labels a cards part and gives each card its own heading", () => {
    const { container } = render(<ContentView doc={cards} slugs={slugs} />);
    expect(container.querySelector("h2")?.textContent).toBe("Cards");
    expect([...container.querySelectorAll("h4")].map((h) => h.id)).toEqual(
      cards.sections.flatMap((section) => section.cards.map((c) => c.id)),
    );
  });

  it("throws on an unknown part kind", () => {
    const part: unknown = { ...syntax, kind: "extras" };
    expect(() =>
      render(<ContentView doc={part as StaticPart} slugs={slugs} />),
    ).toThrow(/Unknown content variant/u);
  });
});

describe("spans", () => {
  it("throws on a link inside link content", () => {
    const inner: LinkSpan = {
      type: "link",
      kind: "anchor",
      id: "fix-parts",
      content: [{ type: "text", text: "inner" }],
    };
    const outer: unknown = {
      type: "link",
      kind: "anchor",
      id: "fix-links",
      content: [{ type: "em", content: [inner] }],
    };
    expect(() =>
      render(<Spans spans={[outer as LinkSpan]} slugs={slugs} />),
    ).toThrow(/Unknown content variant/u);
  });

  it("renders a link with its href and author text", () => {
    const link: LinkSpan = {
      type: "link",
      kind: "anchor",
      id: "second-start",
      chapter: "ch-second",
      content: [
        {
          type: "strong",
          content: [{ type: "em", content: [{ type: "text", text: "there" }] }],
        },
      ],
    };
    const { container } = render(<Spans spans={[link]} slugs={slugs} />);
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe(
      "/chapters/fixture-second#second-start",
    );
    expect(anchor?.querySelector("strong > em")?.textContent).toBe("there");
  });

  it("renders each Term as a native button that opens only its own definition", () => {
    const term: TermSpan = {
      type: "term",
      id: "term-a",
      short: "A short definition.",
      content: [{ type: "em", content: [{ type: "text", text: "word" }] }],
    };
    const { container } = render(
      <p>
        <Spans
          spans={[term, { type: "text", text: " and " }, term]}
          slugs={slugs}
        />
      </p>,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    const targets = buttons.map((b) => b.getAttribute("popovertarget"));
    expect(new Set(targets).size).toBe(2);
    for (const button of buttons) {
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("popovertargetaction")).toBe("toggle");
      expect(button.querySelector("em")?.textContent).toBe("word");
      expect([...button.attributes].map((a) => a.name).sort()).toEqual([
        "popovertarget",
        "popovertargetaction",
        "type",
      ]);
      const definition = button.nextElementSibling;
      expect(definition?.tagName).toBe("SPAN");
      expect(definition?.id).toBe(button.getAttribute("popovertarget"));
      expect(definition?.getAttribute("popover")).toBe("auto");
      expect(definition?.textContent).toBe("A short definition. Definition");
      const links = [...(definition?.querySelectorAll("a") ?? [])];
      expect(links.map((a) => a.getAttribute("href"))).toEqual([
        "/glossary#term-a",
      ]);
    }
  });

  it("throws on a link inside Term content", () => {
    const term: unknown = {
      type: "term",
      id: "term-a",
      short: "s",
      content: [
        {
          type: "link",
          kind: "anchor",
          id: "fix-parts",
          content: [{ type: "text", text: "inner" }],
        },
      ],
    };
    expect(() =>
      render(<Spans spans={[term as TermSpan]} slugs={slugs} />),
    ).toThrow(/Unknown content variant/u);
  });
});
