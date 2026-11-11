// Post-restore judgement and records for the real high-contrast run. The spec judges its own live
// observations and fails on its own; the checks that read the records written here can fail a run
// but never pass one.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isObject,
  restoredProblems,
  type HighContrastState,
  type Scheme,
} from "./high-contrast-state.ts";

const recordVersion = 2;

/** From restore acceptance to the end of the in-browser measurement; past it the check fails. */
export const postRestoreDeadlineMs = 30_000;

export type Engine = "chromium" | "firefox" | "webkit";

/** The six cycles of a complete run: three engine projects, two schemes each, in run order. */
export const expectedCycles: readonly {
  cycle: string;
  project: string;
  engine: Engine;
  scheme: Scheme;
}[] = [
  {
    cycle: "hc-chromium/High Contrast Black",
    project: "hc-chromium",
    engine: "chromium",
    scheme: "High Contrast Black",
  },
  {
    cycle: "hc-chromium/High Contrast White",
    project: "hc-chromium",
    engine: "chromium",
    scheme: "High Contrast White",
  },
  {
    cycle: "hc-firefox/High Contrast Black",
    project: "hc-firefox",
    engine: "firefox",
    scheme: "High Contrast Black",
  },
  {
    cycle: "hc-firefox/High Contrast White",
    project: "hc-firefox",
    engine: "firefox",
    scheme: "High Contrast White",
  },
  {
    cycle: "hc-webkit/High Contrast Black",
    project: "hc-webkit",
    engine: "webkit",
    scheme: "High Contrast Black",
  },
  {
    cycle: "hc-webkit/High Contrast White",
    project: "hc-webkit",
    engine: "webkit",
    scheme: "High Contrast White",
  },
];

const cycleCount = expectedCycles.length;

/** Everything one post-restore check observed. */
export interface Observation {
  cycle: string;
  project: string;
  engine: string;
  scheme: string;
  doneMs: number | null;
  forced: boolean | null;
  state: unknown;
  error: string | null;
  problems: string[];
}

export interface CycleRow {
  version: number;
  outcome: "verified" | "failed";
  observation: Observation;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function timingProblems(check: Record<string, unknown>) {
  const { doneMs } = check;
  if (!finite(doneMs) || doneMs < 0)
    return [
      `the finishing time ${String(doneMs)} is not a non-negative number of ms`,
    ];
  if (doneMs > postRestoreDeadlineMs)
    return [
      `finished at ${String(doneMs)} ms, past the ${String(postRestoreDeadlineMs)} ms deadline`,
    ];
  return [];
}

/**
 * Why one observation fails its cycle. Only a fresh browser that reports no forced colours, in
 * time and over the restored baseline state, has no problem; the supplied problems list is never
 * consulted.
 */
export function postRestoreProblems(
  check: unknown,
  baseline: HighContrastState,
): string[] {
  if (!isObject(check)) return ["the observation is not an object"];
  const problems: string[] = [];
  const expected = expectedCycles.find((c) => c.cycle === check["cycle"]);
  if (expected === undefined)
    problems.push(
      `${JSON.stringify(check["cycle"])} is not one of the six cycles`,
    );
  else
    for (const key of ["project", "engine", "scheme"] as const)
      if (check[key] !== expected[key])
        problems.push(
          `${key} ${JSON.stringify(check[key])}, not ${expected[key]}`,
        );
  const error = check["error"];
  if (typeof error === "string") problems.push(error);
  else if (error !== null) problems.push("the error is neither null nor text");
  if (check["forced"] === true)
    problems.push("forced colours are still active");
  else if (check["forced"] !== false)
    problems.push("forced colours were not read");
  problems.push(...timingProblems(check));
  try {
    problems.push(
      ...restoredProblems(
        baseline,
        check["state"],
        expected?.scheme ?? null,
      ).map((problem) => `restored state: ${problem}`),
    );
  } catch (error) {
    problems.push(`restored state: ${describe(error)}`);
  }
  return problems;
}

const ledgerPath = (root: string) => join(root, "hc-run", "cycles.jsonl");

export function recordCycle(root: string, row: CycleRow) {
  appendFileSync(ledgerPath(root), `${JSON.stringify(row)}\n`);
}

/**
 * Judges one post-restore check, appends its record and throws unless the cycle is verified. A
 * record that cannot be appended is itself a failure.
 */
export function settlePostRestore(options: {
  check: Omit<Observation, "problems">;
  baseline: HighContrastState;
  append: (row: CycleRow) => void;
}): CycleRow {
  const observation: Observation = { ...options.check, problems: [] };
  observation.problems = postRestoreProblems(observation, options.baseline);
  const failed = observation.problems.length > 0;
  const row: CycleRow = {
    version: recordVersion,
    outcome: failed ? "failed" : "verified",
    observation,
  };
  try {
    options.append(row);
  } catch (error) {
    throw new Error(
      [
        `the cycle record was not written: ${describe(error)}`,
        ...observation.problems,
      ].join("; "),
      { cause: error },
    );
  }
  if (failed) throw new Error(observation.problems.join("; "));
  return row;
}

type Standing = "verified" | "failed" | "incomplete";

const isVerified = (row: unknown) =>
  isObject(row) &&
  row["version"] === recordVersion &&
  row["outcome"] === "verified" &&
  isObject(row["observation"]) &&
  row["observation"]["forced"] === false &&
  Array.isArray(row["observation"]["problems"]) &&
  row["observation"]["problems"].length === 0;

/**
 * Where each of the six cycles stands in the records under root. A cycle with no record is
 * incomplete; one recorded twice, or with anything but a verified record, is failed. Records that
 * cannot be read or name no expected cycle are problems, never zero failures.
 */
export function cycleStandings(root: string) {
  const problems: string[] = [];
  const named = new Map<string, unknown[]>();
  const path = ledgerPath(root);
  const available = existsSync(path);
  if (!available) problems.push("no cycle records were written");
  else {
    const lines = readFileSync(path, "utf8").split("\n");
    if (lines.pop() !== "") problems.push("the last cycle record is not ended");
    lines.forEach((line, i) => {
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        problems.push(`record ${String(i + 1)} cannot be read`);
        return;
      }
      const cycle =
        isObject(row) && isObject(row["observation"])
          ? row["observation"]["cycle"]
          : undefined;
      if (
        typeof cycle !== "string" ||
        !expectedCycles.some((c) => c.cycle === cycle)
      ) {
        problems.push(`record ${String(i + 1)} names no expected cycle`);
        return;
      }
      named.set(cycle, [...(named.get(cycle) ?? []), row]);
    });
  }
  const cycles = expectedCycles.map(({ cycle }) => {
    const rows = named.get(cycle) ?? [];
    let standing: Standing = "incomplete";
    if (rows.length > 1) {
      standing = "failed";
      problems.push(`${cycle} recorded ${String(rows.length)} times`);
    } else if (rows.length === 1)
      standing = isVerified(rows[0]) ? "verified" : "failed";
    return { cycle, standing };
  });
  const count = (standing: Standing) =>
    cycles.filter((c) => c.standing === standing).length;
  return {
    available,
    cycles,
    problems,
    verified: count("verified"),
    failed: count("failed"),
    incomplete: count("incomplete"),
  };
}

/** Why the records do not show six distinct verified cycles; the launcher fails the run on any. */
export function completenessProblems(root: string): string[] {
  try {
    const standings = cycleStandings(root);
    return [
      ...standings.problems,
      ...standings.cycles
        .filter((c) => c.standing !== "verified")
        .map((c) => `${c.cycle}: ${c.standing}`),
    ];
  } catch (error) {
    return [`the cycle records cannot be checked: ${describe(error)}`];
  }
}

// Workflow-command data may not carry a raw newline or percent sign.
const commandData = (text: string) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/** The one line the job reports; it states the step's own outcome and never infers a pass. */
function summaryLine(
  standings: ReturnType<typeof cycleStandings>,
  outcome: string | undefined,
) {
  const step = `high-contrast step: ${outcome ?? "not reported"}.`;
  if (!standings.available) return `Post-restore: records unavailable; ${step}`;
  return `Post-restore: ${String(standings.verified + standings.failed)}/${String(cycleCount)} cycles completed; ${String(standings.verified)} verified, ${String(standings.failed)} failed, ${String(standings.incomplete)} incomplete; ${step}`;
}

/**
 * Writes the summary to the log and the job summary and returns the exit status: failed unless the
 * test step succeeded and the records show six distinct verified cycles.
 */
export function report(options: {
  dir: string | undefined;
  outcome: string | undefined;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}): number {
  const { dir, outcome, env, log } = options;
  try {
    if (dir === undefined) throw new Error("usage: <output dir>");
    const standings = cycleStandings(dir);
    const line = summaryLine(standings, outcome);
    log(line);
    for (const problem of standings.problems) log(`failed ${problem}`);
    const text = [
      line,
      "",
      ...standings.cycles.map((c) => `- ${c.cycle}: ${c.standing}`),
      ...standings.problems.map((problem) => `- failed ${problem}`),
      "",
    ].join("\n");
    const target = env["GITHUB_STEP_SUMMARY"];
    if (target !== undefined && target !== "") appendFileSync(target, text);
    else if (env["GITHUB_ACTIONS"] === "true")
      throw new Error("GITHUB_STEP_SUMMARY is not set");
    return outcome === "success" &&
      standings.problems.length === 0 &&
      standings.verified === cycleCount
      ? 0
      : 1;
  } catch (error) {
    try {
      log(
        `::error::${commandData(`high contrast summary: ${describe(error)}`)}`,
      );
    } catch {
      // The status below is the failure; a log that cannot be written must not hide it.
    }
    return 1;
  }
}
