import type { ReactElement } from "react";
import type { DrillFile, ProblemFile } from "../generated/content.ts";
import { Blocks } from "./Blocks.tsx";
import { drillHref, drillTitle } from "./href.ts";
import type { DrillTitleMap, SlugMap } from "./href.ts";

// The hosting page owns the h1, so a record's own heading is an h2 and its fields stand under it.
export function PracticeView({
  record,
  slugs,
  drillTitles,
}: {
  record: ProblemFile | DrillFile;
  slugs: SlugMap;
  drillTitles: DrillTitleMap;
}): ReactElement {
  return (
    <>
      {record.type === "problem" ? (
        <h2>
          Problem {record.number}: {record.title}
        </h2>
      ) : (
        <>
          <h2>{record.title}</h2>
          <p>Rung: {record.rung}</p>
          {record.prerequisites.length > 0 ? (
            <p>
              Prerequisites:{" "}
              {record.prerequisites.map((id, index) => [
                index > 0 ? ", " : null,
                <a key={id} href={drillHref(drillTitles, id)}>
                  {drillTitle(drillTitles, id)}
                </a>,
              ])}
            </p>
          ) : null}
        </>
      )}
      <h3>Statement</h3>
      <Blocks blocks={record.statement} slugs={slugs} />
      <h3>Examples</h3>
      <Blocks blocks={record.examples} slugs={slugs} />
      <h3>Constraints</h3>
      <Blocks blocks={record.constraints} slugs={slugs} />
    </>
  );
}
