import { useState } from "react";
import type { ReactElement } from "react";
import { projectBuild } from "../../src/content/approach.ts";
import type { ApproachSelection } from "../../src/content/approach.ts";
import { BuildPartView } from "../../src/content/Build.tsx";
import type { SlugMap } from "../../src/content/href.ts";
import type { BuildPart } from "../../src/generated/content.ts";
import type { HarnessWalkControl } from "./WalkController.ts";

// Every walk id in a piece of content, however deep its blocks nest.
function walkIds(content: unknown): string[] {
  if (Array.isArray(content)) return content.flatMap(walkIds);
  if (typeof content !== "object" || content === null) return [];
  const own =
    "type" in content &&
    content.type === "walk-it" &&
    "id" in content &&
    typeof content.id === "string"
      ? [content.id]
      : [];
  return [...own, ...Object.values(content).flatMap(walkIds)];
}

// The page holds the selection and starts with none, so a first view shows every lead and picker.
export function BuildController({
  part,
  slugs,
  walkControl,
}: {
  part: BuildPart;
  slugs: SlugMap;
  walkControl: HarnessWalkControl;
}): ReactElement {
  const [selection, setSelection] = useState<ApproachSelection>(
    () => new Map<string, string>(),
  );
  return (
    <BuildPartView
      view={projectBuild(part, selection)}
      slugs={slugs}
      walkControl={walkControl}
      onApproachChange={(sectionId, approachId) => {
        // A walk in a newly picked approach mounts again, so like a first view it reads nothing out.
        if (selection.get(sectionId) !== approachId)
          walkControl.quiet(
            walkIds(part.sections.find((s) => s.id === sectionId)?.approaches),
          );
        setSelection((old) => new Map(old).set(sectionId, approachId));
      }}
    />
  );
}
