import type { ReactElement } from "react";
import type { DrillList, DrillSection } from "../generated/content.ts";
import { Blocks } from "./Blocks.tsx";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

export function DrillSectionView({
  section,
  slugs,
}: {
  section: DrillSection;
  slugs: SlugMap;
}): ReactElement {
  return (
    <section data-section-id={section.id}>
      <h3 id={section.id}>
        {section.number} <Spans spans={section.title} slugs={slugs} />
      </h3>
      <Blocks blocks={section.body} slugs={slugs} />
      <DrillListView block={section.drills} />
    </section>
  );
}

// A drill's id waits for the drill pages, so each drill shows as its label alone, in order.
function DrillListView({ block }: { block: DrillList }): ReactElement {
  return (
    <ol data-block-id={block.blockId}>
      {block.items.map((drill) => (
        <li key={drill.blockId} data-block-id={drill.blockId}>
          {drill.label}
        </li>
      ))}
    </ol>
  );
}
