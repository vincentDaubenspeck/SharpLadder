import type { LinkSpan } from "../generated/body.ts";
import type { ChapterFile } from "../generated/content.ts";

// The same whole-string patterns as the content schema, so a trailing line feed never matches.
const idPattern = /^[a-z][a-z0-9-]{0,47}(?![\s\S])/u;
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*(?![\s\S])/u;
const slugMaxLength = 48;

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

export function internalHref(link: LinkSpan, slugs: SlugMap): string {
  const { id, chapter } = link;
  if (!isTargetId(id)) {
    throw new Error(`Malformed link target: ${JSON.stringify(id)}`);
  }
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
