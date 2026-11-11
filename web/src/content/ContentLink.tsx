import type { ReactElement } from "react";
import type { LinkSpan } from "../generated/body.ts";
import { internalHref, type SlugMap } from "./href.ts";
import { LinkContent } from "./Spans.tsx";

// Every link renders here, so the source policy pins its single href in one place.
export function ContentLink({
  link,
  slugs,
}: {
  link: LinkSpan;
  slugs: SlugMap;
}): ReactElement {
  return (
    <a href={internalHref(link, slugs)}>
      <LinkContent spans={link.content} />
    </a>
  );
}
