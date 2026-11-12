import type { ReactElement } from "react";
import { HintPicker } from "./ApproachPicker.tsx";
import { checkedHintsView } from "./hints.ts";
import type { HintChange, HintsView, SelectedCue } from "./hints.ts";

// The selection lives with the caller: this view shows the one projection it is handed, and a
// ladder's heading, technique and rungs never reach it.
export function HintsPartView({
  view,
  onHintChange,
}: {
  view: HintsView;
  onHintChange: HintChange;
}): ReactElement {
  return (
    <>
      <h2>Hints</h2>
      <HintsBody view={checkedHintsView(view)} onHintChange={onHintChange} />
    </>
  );
}

// A lone ladder is shown without a picker, since there is nothing to choose between.
function HintsBody({
  view,
  onHintChange,
}: {
  view: HintsView;
  onHintChange: HintChange;
}): ReactElement {
  return (
    <>
      {view.options.length > 1 ? (
        <HintPicker
          options={view.options}
          selectedIndex={view.selectedIndex}
          onHintChange={onHintChange}
        />
      ) : null}
      {view.selected === undefined ? null : (
        <SelectedLadderView section={view.selected} />
      )}
    </>
  );
}

function SelectedLadderView({
  section,
}: {
  section: SelectedCue;
}): ReactElement {
  return (
    <section data-section-id={section.id}>
      <CueView block={section} />
    </section>
  );
}

function CueView({ block }: { block: SelectedCue }): ReactElement {
  return <p data-block-id={block.blockId}>{block.cue}</p>;
}
