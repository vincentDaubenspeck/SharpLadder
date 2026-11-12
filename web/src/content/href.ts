import type { LinkSpan, TermSpan } from "../generated/body.ts";
import type { ChapterFile } from "../generated/content.ts";

// The same whole-string patterns as the content schema, so a trailing line feed never matches.
const idPattern = /^[a-z][a-z0-9-]{0,47}(?![\s\S])/u;
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*(?![\s\S])/u;
const slugMaxLength = 48;
const termPattern = /^term-[a-z0-9-]/u;

// Values may arrive untyped at run time, and a regular expression would coerce a non-string.
function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isTargetId(value: unknown): value is string {
  return isString(value) && idPattern.test(value) && value !== "intro";
}

function isChapterId(value: unknown): value is string {
  return isString(value) && idPattern.test(value) && value.startsWith("ch-");
}

// Values may arrive untyped at run time, so a kind the types rule out is still met.
function isAnchorKind(value: unknown): boolean {
  return value === "anchor";
}

function isSlug(value: unknown): value is string {
  return (
    isString(value) && value.length <= slugMaxLength && slugPattern.test(value)
  );
}

// Admission runs in the constructor, so even a recovered constructor builds only checked maps.
class SlugMap {
  readonly #slugs = new Map<string, string>();

  constructor(chapters: readonly ChapterFile[]) {
    const seenSlugs = new Set<string>();
    for (const chapter of chapters) {
      const { id, slug } = chapter;
      if (!isChapterId(id)) {
        throw new Error(`Malformed chapter id: ${JSON.stringify(id)}`);
      }
      if (!isSlug(slug)) {
        throw new Error(`Malformed chapter slug: ${JSON.stringify(slug)}`);
      }
      if (this.#slugs.has(id)) {
        throw new Error(`Duplicate chapter id: ${id}`);
      }
      // Two chapters on one route would send a link to the wrong page.
      if (seenSlugs.has(slug)) {
        throw new Error(`Duplicate chapter slug: ${slug}`);
      }
      seenSlugs.add(slug);
      this.#slugs.set(id, slug);
    }
    Object.freeze(this);
  }

  slugOf(chapter: string): string | undefined {
    return this.#slugs.get(chapter);
  }
}

export type { SlugMap };

export function buildSlugMap(chapters: readonly ChapterFile[]): SlugMap {
  return new SlugMap(chapters);
}

// The compiler states what a target is; an error entry lives on the one error page and belongs
// to no chapter, so a chapter beside it is refused, never ignored.
function errorHref(link: object, id: string): string {
  if (!id.startsWith("err-") || "chapter" in link) {
    throw new Error(`Malformed error entry target: ${JSON.stringify(id)}`);
  }
  return `/errors#${id}`;
}

// A glossary entry lives on the one glossary page and belongs to no chapter, so a chapter beside
// it is refused, never ignored.
export function termHref(term: TermSpan): string {
  const { id } = term;
  if (!isTargetId(id) || !termPattern.test(id) || "chapter" in term) {
    throw new Error(`Malformed Term target: ${JSON.stringify(id)}`);
  }
  return `/glossary#${id}`;
}

export function internalHref(link: LinkSpan, slugs: SlugMap): string {
  const { id, kind } = link;
  if (!isTargetId(id)) {
    throw new Error(`Malformed link target: ${JSON.stringify(id)}`);
  }
  if (kind === "error") {
    return errorHref(link, id);
  }
  if (!isAnchorKind(kind)) {
    throw new Error(`Unknown link kind: ${JSON.stringify(kind)}`);
  }
  const { chapter } = link;
  if (chapter === undefined) {
    return `#${id}`;
  }
  if (!isChapterId(chapter)) {
    throw new Error(`Malformed link chapter: ${JSON.stringify(chapter)}`);
  }
  const slug = slugs.slugOf(chapter);
  if (slug === undefined) {
    throw new Error(`No slug for chapter: ${chapter}`);
  }
  return `/chapters/${slug}#${id}`;
}
