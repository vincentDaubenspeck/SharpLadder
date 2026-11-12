import { useId, type ReactElement } from "react";
import type { TermSpan } from "../generated/body.ts";
import { termHref } from "./href.ts";
import { LinkContent } from "./Spans.tsx";

// The browser opens, dismisses and refocuses a native popover, so no handler is written here.
export function Term({ term }: { term: TermSpan }): ReactElement {
  const definition = useId();
  return (
    <>
      <button
        type="button"
        popoverTarget={definition}
        popoverTargetAction="toggle"
      >
        <LinkContent spans={term.content} />
      </button>
      <span id={definition} popover="auto">
        {term.short} <a href={termHref(term)}>Definition</a>
      </span>
    </>
  );
}
