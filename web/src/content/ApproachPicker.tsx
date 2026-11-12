import type { ReactElement } from "react";
import type { ApproachChange, ApproachOption } from "./approach.ts";
import type { HintChange, HintOption } from "./hints.ts";

// Pressed buttons, not tabs: every option stays one tab stop and focus stays where it was put.
function Choices<Id extends string | number>({
  choices,
  pressed,
  onChoose,
}: {
  choices: readonly { readonly id: Id; readonly label: string }[];
  pressed: Id | null;
  onChoose: (id: Id) => void;
}): ReactElement {
  return (
    <>
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          aria-pressed={choice.id === pressed}
          onClick={() => {
            onChoose(choice.id);
          }}
        >
          {choice.label}
        </button>
      ))}
    </>
  );
}

export function ApproachPicker({
  sectionId,
  options,
  selectedApproachId,
  onApproachChange,
}: {
  sectionId: string;
  options: readonly ApproachOption[];
  selectedApproachId: string | null;
  onApproachChange: ApproachChange;
}): ReactElement {
  return (
    <div role="group" aria-label="Build approaches">
      <Choices
        choices={options}
        pressed={selectedApproachId}
        onChoose={(id) => {
          onApproachChange(sectionId, id);
        }}
      />
    </div>
  );
}

// A hint option is a position, so nothing the picker hands back names a ladder.
export function HintPicker({
  options,
  selectedIndex,
  onHintChange,
}: {
  options: readonly HintOption[];
  selectedIndex: number | null;
  onHintChange: HintChange;
}): ReactElement {
  return (
    <div role="group" aria-label="Hint approaches">
      <Choices
        choices={options}
        pressed={selectedIndex}
        onChoose={onHintChange}
      />
    </div>
  );
}
