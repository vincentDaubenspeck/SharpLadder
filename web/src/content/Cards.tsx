import type { ReactElement } from "react";
import type { Card, CardsSection } from "../generated/content.ts";
import { Blocks } from "./Blocks.tsx";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

// A cards section keeps the hooks of every part section; its cards sit one heading level below.
export function CardsSectionView({
  section,
  slugs,
}: {
  section: CardsSection;
  slugs: SlugMap;
}): ReactElement {
  return (
    <section data-section-id={section.id}>
      <h3 id={section.id}>
        {section.number} <Spans spans={section.title} slugs={slugs} />
      </h3>
      {section.cards.map((card) => (
        <CardView key={card.id} card={card} slugs={slugs} />
      ))}
    </section>
  );
}

// A field label names its value and is no heading, so a card reads as one description list.
function CardView({
  card,
  slugs,
}: {
  card: Card;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h4 id={card.id}>
        <Spans spans={card.title} slugs={slugs} />
      </h4>
      <dl>
        <dt>Reach for</dt>
        <dd>
          <Blocks blocks={[card.reach]} slugs={slugs} />
        </dd>
        <dt>Build</dt>
        <dd>
          <Blocks blocks={[card.build]} slugs={slugs} />
        </dd>
        <dt>Why</dt>
        <dd>
          <Blocks blocks={card.why} slugs={slugs} />
        </dd>
        {card.traps === undefined ? null : (
          <>
            <dt>Traps</dt>
            <dd>
              <Blocks blocks={[card.traps]} slugs={slugs} />
            </dd>
          </>
        )}
        {card.also === undefined ? null : (
          <>
            <dt>Also</dt>
            <dd>
              <Blocks blocks={[card.also]} slugs={slugs} />
            </dd>
          </>
        )}
      </dl>
    </>
  );
}
