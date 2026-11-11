import type { ReactElement } from "react";
import type {
  ChapterFile,
  ChapterSection,
  ContentDoc,
  PartFile,
  PartSection,
} from "../generated/content.ts";
import { assertNever } from "./assertNever.ts";
import { Blocks } from "./Blocks.tsx";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

// The hosting page owns the single h1, so content headings start at h2.
export function ContentView({
  doc,
  slugs,
}: {
  doc: ContentDoc;
  slugs: SlugMap;
}): ReactElement {
  switch (doc.type) {
    case "chapter":
      return <ChapterView chapter={doc} slugs={slugs} />;
    case "part":
      return <PartView part={doc} slugs={slugs} />;
    default:
      return assertNever(doc);
  }
}

function ChapterView({
  chapter,
  slugs,
}: {
  chapter: ChapterFile;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <Blocks blocks={chapter.intro} slugs={slugs} />
      {chapter.sections.map((section) => (
        <ChapterSectionView key={section.id} section={section} slugs={slugs} />
      ))}
    </>
  );
}

function ChapterSectionView({
  section,
  slugs,
}: {
  section: ChapterSection;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h2 id={section.id}>
        <Spans spans={section.title} slugs={slugs} />
      </h2>
      <Blocks blocks={section.body} slugs={slugs} />
    </>
  );
}

// A part heading has no anchor; its text is fixed per kind and never taken from content.
function PartView({
  part,
  slugs,
}: {
  part: PartFile;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h2>{partLabel(part.kind)}</h2>
      {part.sections.map((section) => (
        <PartSectionView key={section.id} section={section} slugs={slugs} />
      ))}
    </>
  );
}

function partLabel(kind: PartFile["kind"]): string {
  switch (kind) {
    case "syntax":
      return "Syntax";
    case "build":
      return "Build";
    case "idioms":
      return "Idioms";
    case "gotchas":
      return "Gotchas";
    case "library":
      return "Library";
    default:
      return assertNever(kind);
  }
}

function PartSectionView({
  section,
  slugs,
}: {
  section: PartSection;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h3 id={section.id}>
        {section.number} <Spans spans={section.title} slugs={slugs} />
      </h3>
      <Blocks blocks={section.body} slugs={slugs} />
    </>
  );
}
