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
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";

// The selection lives with the caller: this view shows the one projection it is handed.
export function BuildPartView({
  view,
  slugs,
  onApproachChange,
}: {
  view: BuildView;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
}): ReactElement {
  return (
    <>
      <h2>Build</h2>
      <BuildSections
        view={checkedBuildView(view)}
        slugs={slugs}
        onApproachChange={onApproachChange}
      />
    </>
  );
}

function BuildSections({
  view,
  slugs,
  onApproachChange,
}: {
  view: BuildView;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
}): ReactElement {
  return (
    <>
      {view.sections.map((section) => (
        <BuildSectionView
          key={section.id}
          section={section}
          slugs={slugs}
          onApproachChange={onApproachChange}
        />
      ))}
    </>
  );
}

function BuildSectionView({
  section,
  slugs,
  onApproachChange,
}: {
  section: BuildViewSection;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
}): ReactElement {
  return (
    <section data-section-id={section.id}>
      <h3 id={section.id}>
        {section.number} <Spans spans={section.title} slugs={slugs} />
      </h3>
      <Blocks blocks={section.body} slugs={slugs} />
      {"options" in section ? (
        <ChoiceView
          section={section}
          slugs={slugs}
          onApproachChange={onApproachChange}
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
}: {
  section: ChoiceSection;
  slugs: SlugMap;
  onApproachChange: ApproachChange;
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
        <SelectedView approach={section.selected} slugs={slugs} />
      )}
    </>
  );
}

function SelectedView({
  approach,
  slugs,
}: {
  approach: SelectedApproach;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      <h4 id={approach.id}>
        <Spans spans={approach.title} slugs={slugs} />
      </h4>
      <Blocks blocks={approach.body} slugs={slugs} />
    </>
  );
}
