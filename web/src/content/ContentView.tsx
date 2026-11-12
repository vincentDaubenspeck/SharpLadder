import type { ReactElement } from "react";
import type {
  ChapterFile,
  ChapterSection,
  PartSection,
} from "../generated/content.ts";
import { staticDoc } from "./approach.ts";
import type { StaticDoc, StaticPart } from "./approach.ts";
import { assertNever } from "./assertNever.ts";
import { Blocks } from "./Blocks.tsx";
import { CardsSectionView } from "./Cards.tsx";
import { DrillSectionView } from "./Drill.tsx";
import { ErrorEntryView, GlossaryEntryView } from "./Entries.tsx";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

// A build part has approaches to choose between, so it is shown by its own view, never here.
export function ContentView({
  doc,
  slugs,
}: {
  doc: StaticDoc;
  slugs: SlugMap;
}): ReactElement {
  return <StaticView doc={staticDoc(doc)} slugs={slugs} />;
}

// The hosting page owns the single h1, so content headings start at h2.
function StaticView({
  doc,
  slugs,
}: {
  doc: StaticDoc;
  slugs: SlugMap;
}): ReactElement {
  switch (doc.type) {
    case "chapter":
      return <ChapterView chapter={doc} slugs={slugs} />;
    case "part":
      return <PartView part={doc} slugs={slugs} />;
    case "glossary":
      return <GlossaryEntryView entry={doc} slugs={slugs} />;
    case "error":
      return <ErrorEntryView entry={doc} slugs={slugs} />;
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
    <section data-section-id={section.id}>
      <h2 id={section.id}>
        <Spans spans={section.title} slugs={slugs} />
      </h2>
      <Blocks blocks={section.body} slugs={slugs} />
    </section>
  );
}

// A part heading has no anchor; its text is fixed per kind and never taken from content.
function PartView({
  part,
  slugs,
}: {
  part: StaticPart;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h2>{partLabel(part.kind)}</h2>
      <PartSections part={part} slugs={slugs} />
    </>
  );
}

// The part kind decides what its sections hold, so it picks their view.
function PartSections({
  part,
  slugs,
}: {
  part: StaticPart;
  slugs: SlugMap;
}): ReactElement {
  if (part.kind === "cards") {
    return (
      <>
        {part.sections.map((section) => (
          <CardsSectionView key={section.id} section={section} slugs={slugs} />
        ))}
      </>
    );
  }
  if (part.kind === "drill") {
    return (
      <>
        {part.sections.map((section) => (
          <DrillSectionView key={section.id} section={section} slugs={slugs} />
        ))}
      </>
    );
  }
  return (
    <>
      {part.sections.map((section) => (
        <PartSectionView key={section.id} section={section} slugs={slugs} />
      ))}
    </>
  );
}

function partLabel(kind: StaticPart["kind"]): string {
  switch (kind) {
    case "syntax":
      return "Syntax";
    case "idioms":
      return "Idioms";
    case "gotchas":
      return "Gotchas";
    case "library":
      return "Library";
    case "cards":
      return "Cards";
    case "drill":
      return "Drill";
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
    <section data-section-id={section.id}>
      <h3 id={section.id}>
        {section.number} <Spans spans={section.title} slugs={slugs} />
      </h3>
      <Blocks blocks={section.body} slugs={slugs} />
    </section>
  );
}
