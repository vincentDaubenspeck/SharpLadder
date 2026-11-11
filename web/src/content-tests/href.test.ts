import { describe, expect, it } from "vitest";
import type { LinkSpan } from "../generated/body.ts";
import type { ChapterFile } from "../generated/content.ts";
import { witness as basics } from "../generated/witness/chapters/fixture-basics/chapter.ts";
import { witness as syntax } from "../generated/witness/chapters/fixture-basics/syntax.ts";
import { witness as second } from "../generated/witness/chapters/fixture-second/chapter.ts";
import { buildSlugMap, internalHref } from "../content/href.ts";

const slugs = buildSlugMap([basics, second]);

function linkTo(id: string, chapter?: string): LinkSpan {
  const content: LinkSpan["content"] = [{ type: "text", text: "x" }];
  return chapter === undefined
    ? { type: "link", id, content }
    : { type: "link", id, chapter, content };
}

function chapterWith(id: string, slug: string): ChapterFile {
  return { ...second, id, slug };
}

// Every link span anywhere below a value, in document order.
function linksIn(value: unknown): LinkSpan[] {
  if (Array.isArray(value)) {
    return value.flatMap(linksIn);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const record = Object.fromEntries(Object.entries(value));
  const own = record["type"] === "link" ? [value as LinkSpan] : [];
  return [...own, ...Object.values(record).flatMap(linksIn)];
}

describe("internalHref", () => {
  it("renders a bare target as a fragment", () => {
    expect(internalHref(linkTo("fix-parts"), slugs)).toBe("#fix-parts");
  });

  it("renders an explicit current-chapter target from a chapter file", () => {
    const link = linksIn(basics).find((span) => span.id === "fix-note");
    expect(link?.chapter).toBe("ch-fixture");
    expect(link && internalHref(link, slugs)).toBe(
      "/chapters/fixture-basics#fix-note",
    );
  });

  it("renders an explicit current-chapter target from a part file", () => {
    const link = linksIn(syntax).find((span) => span.id === "syn-fix-sum1");
    expect(link?.chapter).toBe(syntax.chapter);
    expect(link && internalHref(link, slugs)).toBe(
      "/chapters/fixture-basics#syn-fix-sum1",
    );
  });

  it("resolves another chapter through its compiled witness", () => {
    const link = linksIn(basics).find((span) => span.chapter === "ch-second");
    expect(link && internalHref(link, slugs)).toBe(
      "/chapters/fixture-second#second-start",
    );
  });

  it("builds an href for every link in the fixture witnesses", () => {
    const links = [...linksIn(basics), ...linksIn(syntax)];
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(internalHref(link, slugs)).toMatch(
        /^(\/chapters\/[a-z0-9-]+)?#[a-z][a-z0-9-]*$/u,
      );
    }
  });

  it("accepts a 48-character target", () => {
    const id = `a${"b".repeat(47)}`;
    expect(internalHref(linkTo(id), slugs)).toBe(`#${id}`);
  });

  it.each([
    ["upper case", "Fix-parts"],
    ["49 characters", `a${"b".repeat(48)}`],
    ["a leading digit", "1fix"],
    ["intro", "intro"],
    ["a positional block id", "syn-var/b2"],
    ["a positional item id", "syn-var/b2.i1"],
    ["two fragment marks", "fix#parts"],
    ["a leading fragment mark", "#fix-parts"],
    ["an empty fragment", ""],
    ["a trailing line feed", "fix-parts\n"],
    ["a javascript: target", "javascript:alert(1)"],
    ["an absolute URL", "https://example.com/"],
    ["a protocol-relative URL", "//example.com"],
    ["a path", "/chapters/fixture-basics"],
  ])("throws on a target with %s", (_name, id) => {
    expect(() => internalHref(linkTo(id), slugs)).toThrow(
      /Malformed link target/u,
    );
    expect(() => internalHref(linkTo(id, "ch-fixture"), slugs)).toThrow(
      /Malformed link target/u,
    );
  });

  it.each([
    ["no ch- prefix", "arrays"],
    ["upper case", "ch-Fixture"],
    ["a trailing line feed", "ch-fixture\n"],
    ["49 characters", `ch-${"a".repeat(46)}`],
    ["an empty chapter", ""],
  ])("throws on a chapter with %s", (_name, chapter) => {
    expect(() => internalHref(linkTo("fix-parts", chapter), slugs)).toThrow(
      /Malformed link chapter/u,
    );
  });

  it("throws on a chapter missing from the map", () => {
    expect(() => internalHref(linkTo("fix-parts", "ch-arrays"), slugs)).toThrow(
      /No slug for chapter: ch-arrays/u,
    );
    expect(() =>
      internalHref(linkTo("second-start", "ch-second"), buildSlugMap([basics])),
    ).toThrow(/No slug for chapter: ch-second/u);
  });

  it("throws on untyped values a pattern would coerce", () => {
    const arrayId: unknown = { type: "link", id: ["fix-parts"], content: [] };
    const nullChapter: unknown = {
      type: "link",
      id: "fix-parts",
      chapter: null,
      content: [],
    };
    expect(() => internalHref(arrayId as LinkSpan, slugs)).toThrow(
      /Malformed link target/u,
    );
    expect(() => internalHref(nullChapter as LinkSpan, slugs)).toThrow(
      /Malformed link chapter/u,
    );
  });
});

describe("buildSlugMap", () => {
  it("returns a frozen map", () => {
    expect(Object.isFrozen(slugs)).toBe(true);
  });

  it("copies slugs, so a later change to the record has no effect", () => {
    const record = chapterWith("ch-copy", "copy");
    const map = buildSlugMap([record]);
    record.slug = "changed";
    expect(internalHref(linkTo("x", "ch-copy"), map)).toBe("/chapters/copy#x");
  });

  it.each([
    ["a 48-character slug", "a".repeat(48)],
    ["a digit-led slug", "8-ball"],
    ["hyphenated words", "a1-b2-c3"],
  ])("admits %s", (_name, slug) => {
    const map = buildSlugMap([chapterWith("ch-ok", slug)]);
    expect(internalHref(linkTo("x", "ch-ok"), map)).toBe(`/chapters/${slug}#x`);
  });

  it.each([
    ["upper case", "Arrays"],
    ["a double hyphen", "a--b"],
    ["a leading hyphen", "-a"],
    ["a trailing hyphen", "a-"],
    ["49 characters", "a".repeat(49)],
    ["a trailing line feed", "arrays\n"],
    ["a slash", "a/b"],
    ["an empty slug", ""],
  ])("throws on a slug with %s", (_name, slug) => {
    expect(() => buildSlugMap([chapterWith("ch-bad", slug)])).toThrow(
      /Malformed chapter slug/u,
    );
  });

  it.each([
    ["no ch- prefix", "arrays"],
    ["upper case", "ch-Arrays"],
    ["a trailing line feed", "ch-arrays\n"],
    ["49 characters", `ch-${"a".repeat(46)}`],
  ])("throws on a chapter id with %s", (_name, id) => {
    expect(() => buildSlugMap([chapterWith(id, "arrays")])).toThrow(
      /Malformed chapter id/u,
    );
  });

  it("throws on a duplicate chapter id", () => {
    expect(() =>
      buildSlugMap([chapterWith("ch-a", "one"), chapterWith("ch-a", "two")]),
    ).toThrow(/Duplicate chapter id: ch-a/u);
  });

  it("throws on a duplicate slug", () => {
    expect(() =>
      buildSlugMap([chapterWith("ch-a", "same"), chapterWith("ch-b", "same")]),
    ).toThrow(/Duplicate chapter slug: same/u);
  });

  it("throws on an untyped slug a pattern would coerce", () => {
    const record: unknown = { ...second, slug: ["fixture-second"] };
    expect(() => buildSlugMap([record as ChapterFile])).toThrow(
      /Malformed chapter slug/u,
    );
  });
});
