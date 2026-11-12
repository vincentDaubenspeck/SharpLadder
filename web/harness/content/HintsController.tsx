import { useState } from "react";
import type { ReactElement } from "react";
import { validHintsView } from "../../src/content-tests/hints-view.ts";
import { selectHints } from "../../src/content/hints.ts";
import { HintsPartView } from "../../src/content/Hints.tsx";
import type { HintsCatalogue } from "../../src/generated/content.ts";

// The page names its ladders in order and starts with none selected, so a first view shows the
// picker and no cue; every view passes the closed schema before it is drawn.
export function HintsController({
  catalogue,
  references,
}: {
  catalogue: HintsCatalogue;
  references: readonly string[];
}): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <HintsPartView
      view={validHintsView(selectHints(catalogue, references, selected))}
      onHintChange={(index) => {
        setSelected(references[index] ?? null);
      }}
    />
  );
}
