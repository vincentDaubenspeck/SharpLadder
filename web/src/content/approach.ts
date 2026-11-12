import type {
  Approach,
  BuildPart,
  BuildSection,
  ContentDoc,
  HintsCatalogue,
  HintsPart,
  PartFile,
} from "../generated/content.ts";

/** What the picker shows for one approach: its id and label, never its body. */
export type ApproachOption = Pick<Approach, "id" | "label">;

/** The one approach a section shows. */
export type SelectedApproach = Pick<Approach, "id" | "title" | "body">;

/** The shared lead of a build section, shown whatever is selected. */
type LeadSection = Pick<BuildSection, "id" | "number" | "title" | "body">;

/** A section with approaches: every option, and the body of the selected one alone. */
export type ChoiceSection = LeadSection & {
  options: [ApproachOption, ApproachOption, ...ApproachOption[]];
  selectedApproachId: string | null;
  selected?: SelectedApproach;
};

export type BuildViewSection = LeadSection | ChoiceSection;

// Written by hand from the generated types, so no schema stands behind this shape; the tests and
// checkedBuildView hold the one promise it makes, that no unselected body is in it.
export interface BuildView {
  type: "build-view";
  chapter: BuildPart["chapter"];
  order: BuildPart["order"];
  sections: [BuildViewSection, ...BuildViewSection[]];
}

/** The approach chosen in each section, by section id. */
export type ApproachSelection = ReadonlyMap<string, string>;

export type ApproachChange = (sectionId: string, approachId: string) => void;

/** Every record the static view takes: a build part and hints are shown only through their views. */
export type StaticDoc = Exclude<
  ContentDoc,
  BuildPart | HintsPart | HintsCatalogue
>;

export type StaticPart = Exclude<PartFile, BuildPart | HintsPart>;

const option = (approach: Approach): ApproachOption => ({
  id: approach.id,
  label: approach.label,
});

function projectSection(
  section: BuildSection,
  selection: ApproachSelection,
): BuildViewSection {
  const { approaches } = section;
  if (approaches === undefined)
    return {
      id: section.id,
      number: section.number,
      title: section.title,
      body: section.body,
    };
  const [first, second, ...rest] = approaches;
  // An id that names no approach of this section selects nothing; the first is never assumed.
  const selectedApproachId = selection.get(section.id) ?? null;
  const found = approaches.find((a) => a.id === selectedApproachId);
  const options: ChoiceSection["options"] = [
    option(first),
    option(second),
    ...rest.map(option),
  ];
  if (found === undefined)
    return {
      id: section.id,
      number: section.number,
      title: section.title,
      body: section.body,
      options,
      selectedApproachId,
    };
  return {
    id: section.id,
    number: section.number,
    title: section.title,
    body: section.body,
    options,
    selectedApproachId,
    selected: { id: found.id, title: found.title, body: found.body },
  };
}

/** The build part as it is shown under a selection, holding no body of an unselected approach. */
export function projectBuild(
  part: BuildPart,
  selection: ApproachSelection,
): BuildView {
  const type: unknown = part.type;
  const kind: unknown = part.kind;
  if (type !== "part" || kind !== "build")
    throw new Error("only a build part has a build view");
  if (!(selection instanceof Map))
    throw new Error("an approach selection is a map");
  const [first, ...rest] = part.sections;
  return {
    type: "build-view",
    chapter: part.chapter,
    order: part.order,
    sections: [
      projectSection(first, selection),
      ...rest.map((section) => projectSection(section, selection)),
    ],
  };
}

/** The view itself, or an error when it is a full build part or carries any approach list. */
export function checkedBuildView(view: BuildView): BuildView {
  const type: unknown = view.type;
  if (type !== "build-view")
    throw new Error("the build view takes only a projected build part");
  for (const section of view.sections) {
    if (Object.hasOwn(section, "approaches"))
      throw new Error("a build view section holds its approaches");
  }
  return view;
}

/** The record itself, or an error when it is a build part or hints, which have no static view. */
export function staticDoc(doc: StaticDoc): StaticDoc {
  const type: unknown = doc.type;
  const kind: unknown = "kind" in doc ? doc.kind : null;
  if (type === "build-view" || (type === "part" && kind === "build"))
    throw new Error("a build part is shown only through its build view");
  if (
    type === "hints-view" ||
    type === "hints-catalogue" ||
    (type === "part" && kind === "hints")
  )
    throw new Error("hints are shown only through their hints view");
  return doc;
}
