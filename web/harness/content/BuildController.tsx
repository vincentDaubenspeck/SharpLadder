import { useState } from "react";
import type { ReactElement } from "react";
import { projectBuild } from "../../src/content/approach.ts";
import type { ApproachSelection } from "../../src/content/approach.ts";
import { BuildPartView } from "../../src/content/Build.tsx";
import type { SlugMap } from "../../src/content/href.ts";
import type { BuildPart } from "../../src/generated/content.ts";

// The page holds the selection and starts with none, so a first view shows every lead and picker.
export function BuildController({
  part,
  slugs,
}: {
  part: BuildPart;
  slugs: SlugMap;
}): ReactElement {
  const [selection, setSelection] = useState<ApproachSelection>(
    () => new Map<string, string>(),
  );
  return (
    <BuildPartView
      view={projectBuild(part, selection)}
      slugs={slugs}
      onApproachChange={(sectionId, approachId) => {
        setSelection((old) => new Map(old).set(sectionId, approachId));
      }}
    />
  );
}
