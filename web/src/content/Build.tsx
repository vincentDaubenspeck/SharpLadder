import type { ReactElement } from "react";
import { checkedBuildView } from "./approach.ts";
import type {
  ApproachChange,
  BuildView,
  BuildViewSection,
  ChoiceSection,
  SelectedApproach,
} from "./approach.ts";
import { ApproachPicker } from "./ApproachPicker.tsx";
import { Blocks } from "./Blocks.tsx";
import type { WalkControl } from "./Blocks.tsx";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

// The selection lives with the caller: this view shows the one projection it is handed.
export function BuildPartView({
  view,
  slugs,
  onApproachChange,
  walkControl,
}: {
  view: BuildView;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
  walkControl?: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      <h2>Build</h2>
      <BuildSections
        view={checkedBuildView(view)}
        slugs={slugs}
        onApproachChange={onApproachChange}
        walkControl={walkControl}
      />
    </>
  );
}

function BuildSections({
  view,
  slugs,
  onApproachChange,
  walkControl,
}: {
  view: BuildView;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      {view.sections.map((section) => (
        <BuildSectionView
          key={section.id}
          section={section}
          slugs={slugs}
          onApproachChange={onApproachChange}
          walkControl={walkControl}
        />
      ))}
    </>
  );
}

function BuildSectionView({
  section,
  slugs,
  onApproachChange,
  walkControl,
}: {
  section: BuildViewSection;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <section data-section-id={section.id}>
      <h3 id={section.id}>
        {section.number} <Spans spans={section.title} slugs={slugs} />
      </h3>
      <Blocks blocks={section.body} slugs={slugs} walkControl={walkControl} />
      {"options" in section ? (
        <ChoiceView
          section={section}
          slugs={slugs}
          onApproachChange={onApproachChange}
          walkControl={walkControl}
        />
      ) : null}
    </section>
  );
}

// The picker stands between the shared lead and the one approach it selects.
function ChoiceView({
  section,
  slugs,
  onApproachChange,
  walkControl,
}: {
  section: ChoiceSection;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      <ApproachPicker
        sectionId={section.id}
        options={section.options}
        selectedApproachId={section.selectedApproachId}
        onApproachChange={onApproachChange}
      />
      {section.selected === undefined ? null : (
        <SelectedView
          approach={section.selected}
          slugs={slugs}
          walkControl={walkControl}
        />
      )}
    </>
  );
}

function SelectedView({
  approach,
  slugs,
  walkControl,
}: {
  approach: SelectedApproach;
  slugs: SlugMap;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      <h4 id={approach.id}>
        <Spans spans={approach.title} slugs={slugs} />
      </h4>
      <Blocks blocks={approach.body} slugs={slugs} walkControl={walkControl} />
    </>
  );
}
