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
import type { WalkControl } from "./Blocks.tsx";
import { CardsSectionView } from "./Cards.tsx";
import { DrillSectionView } from "./Drill.tsx";
import { ErrorEntryView, GlossaryEntryView } from "./Entries.tsx";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

// A build part has approaches to choose between, so it is shown by its own view, never here.
export function ContentView({
  doc,
  slugs,
  walkControl,
}: {
  doc: StaticDoc;
  slugs: SlugMap;
  walkControl?: WalkControl | undefined;
}): ReactElement {
  return (
    <StaticView doc={staticDoc(doc)} slugs={slugs} walkControl={walkControl} />
  );
}

// The hosting page owns the single h1, so content headings start at h2.
function StaticView({
  doc,
  slugs,
  walkControl,
}: {
  doc: StaticDoc;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  switch (doc.type) {
    case "chapter":
      return (
        <ChapterView chapter={doc} slugs={slugs} walkControl={walkControl} />
      );
    case "part":
      return <PartView part={doc} slugs={slugs} walkControl={walkControl} />;
    case "glossary":
      return (
        <GlossaryEntryView
          entry={doc}
          slugs={slugs}
          walkControl={walkControl}
        />
      );
    case "error":
      return (
        <ErrorEntryView entry={doc} slugs={slugs} walkControl={walkControl} />
      );
    default:
      return assertNever(doc);
  }
}

function ChapterView({
  chapter,
  slugs,
  walkControl,
}: {
  chapter: ChapterFile;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      <Blocks blocks={chapter.intro} slugs={slugs} walkControl={walkControl} />
      {chapter.sections.map((section) => (
        <ChapterSectionView
          key={section.id}
          section={section}
          slugs={slugs}
          walkControl={walkControl}
        />
      ))}
    </>
  );
}

function ChapterSectionView({
  section,
  slugs,
  walkControl,
}: {
  section: ChapterSection;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <section data-section-id={section.id}>
      <h2 id={section.id}>
        <Spans spans={section.title} slugs={slugs} />
      </h2>
      <Blocks blocks={section.body} slugs={slugs} walkControl={walkControl} />
    </section>
  );
}

// A part heading has no anchor; its text is fixed per kind and never taken from content.
function PartView({
  part,
  slugs,
  walkControl,
}: {
  part: StaticPart;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      <h2>{partLabel(part.kind)}</h2>
      <PartSections part={part} slugs={slugs} walkControl={walkControl} />
    </>
  );
}

// The part kind decides what its sections hold, so it picks their view.
function PartSections({
  part,
  slugs,
  walkControl,
}: {
  part: StaticPart;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  if (part.kind === "cards") {
    return (
      <>
        {part.sections.map((section) => (
          <CardsSectionView
            key={section.id}
            section={section}
            slugs={slugs}
            walkControl={walkControl}
          />
        ))}
      </>
    );
  }
  if (part.kind === "drill") {
    return (
      <>
        {part.sections.map((section) => (
          <DrillSectionView
            key={section.id}
            section={section}
            slugs={slugs}
            walkControl={walkControl}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {part.sections.map((section) => (
        <PartSectionView
          key={section.id}
          section={section}
          slugs={slugs}
          walkControl={walkControl}
        />
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
  walkControl,
}: {
  section: PartSection;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <section data-section-id={section.id}>
      <h3 id={section.id}>
        {section.number} <Spans spans={section.title} slugs={slugs} />
      </h3>
      <Blocks blocks={section.body} slugs={slugs} walkControl={walkControl} />
    </section>
  );
}
