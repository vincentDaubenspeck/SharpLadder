import type { ReactElement } from "react";
import type { ErrorEntry, GlossaryEntry } from "../generated/content.ts";
import { assertNever } from "./assertNever.ts";
import { Blocks } from "./Blocks.tsx";
import type { SlugMap } from "./href.ts";

// An entry is reached at its own id, so the heading alone carries it; an entry has no audio slot
// and so no section hook.
export function GlossaryEntryView({
  entry,
  slugs,
}: {
  entry: GlossaryEntry;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h2 id={entry.id}>{entry.term}</h2>
      <p>{entry.short}</p>
      <Blocks blocks={entry.body} slugs={slugs} />
    </>
  );
}

export function ErrorEntryView({
  entry,
  slugs,
}: {
  entry: ErrorEntry;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h2 id={entry.id}>{errorTitle(entry)}</h2>
      <p>
        <strong>You wrote</strong> {entry.wrote}
      </p>
      <p>
        <strong>You got</strong> {entry.got}
      </p>
      <h3>Cause</h3>
      <Blocks blocks={entry.cause} slugs={slugs} />
      <h3>Hint</h3>
      <Blocks blocks={entry.hint} slugs={slugs} />
    </>
  );
}

// A wrong-output entry has no diagnostic to name, so what was written stands as its title.
function errorTitle(entry: ErrorEntry): string {
  switch (entry.kind) {
    case "compiler":
    case "runtime":
      return entry.code;
    case "wrong-output":
      return entry.wrote;
    default:
      return assertNever(entry);
  }
}
