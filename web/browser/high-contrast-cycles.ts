// Post-restore judgement and records for the real high-contrast run. The spec judges its own live
// observations and fails on its own; the records and images written here are diagnostics, and the
// checks that read them can fail a run but never pass one.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  isObject,
  restoredProblems,
  type HighContrastState,
  type Scheme,
} from "./high-contrast-state.ts";

const recordVersion = 1;

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

const imageRoles = ["baseline", "capture", "diff"] as const;
type ImageRole = (typeof imageRoles)[number];
export type PostRestoreImages = Record<ImageRole, Uint8Array | null>;

/** A failed cycle's diagnostics folder relative to the output folder. */
export const cycleFolder = (project: string, scheme: string) =>
  `post-restore/${project}/${scheme.replaceAll(" ", "-")}`;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything one post-restore check observed. */
export interface Observation {
  cycle: string;
  project: string;
  engine: string;
  scheme: string;
  captureMs: number | null;
  doneMs: number | null;
  width: number | null;
  height: number | null;
  devicePixelRatio: number | null;
  forced: boolean | null;
  changed: number | null;
  diagnostic: number | null;
  box: Box | null;
  state: unknown;
  activeElement: { tag: string; id: string } | null;
  hasFocus: boolean | null;
  error: string | null;
  problems: string[];
}

export interface CycleRow {
  version: number;
  outcome: "exact" | "failed";
  observation: Observation;
  files: string[];
}

/** What a capture is judged against: the run baseline's state and image size. */
export interface RunBaseline {
  state: HighContrastState;
  width: number;
  height: number;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCount = (value: unknown, least: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= least;

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function timingProblems(check: Record<string, unknown>) {
  const { captureMs, doneMs } = check;
  if (!finite(captureMs) || captureMs < 0)
    return [
      `the capture time ${String(captureMs)} is not a non-negative number of ms`,
    ];
  if (!finite(doneMs) || doneMs < 0)
    return [
      `the finishing time ${String(doneMs)} is not a non-negative number of ms`,
    ];
  if (captureMs > doneMs)
    return [
      `the capture at ${String(captureMs)} ms is after the finish at ${String(doneMs)} ms`,
    ];
  if (doneMs > postRestoreDeadlineMs)
    return [
      `finished at ${String(doneMs)} ms, past the ${String(postRestoreDeadlineMs)} ms deadline`,
    ];
  return [];
}

function focusProblems(check: Record<string, unknown>) {
  const problems: string[] = [];
  const active = check["activeElement"];
  if (
    active !== null &&
    !(
      isObject(active) &&
      typeof active["tag"] === "string" &&
      typeof active["id"] === "string"
    )
  )
    problems.push("the active element is not a tag and an id");
  if (typeof check["hasFocus"] !== "boolean")
    problems.push("page focus was not read");
  const ratio = check["devicePixelRatio"];
  if (!finite(ratio) || ratio <= 0)
    problems.push("the device pixel ratio was not read");
  return problems;
}

function countProblems(check: Record<string, unknown>) {
  const count = check["changed"];
  if (count === null || count === undefined)
    return ["the capture was not compared with the baseline"];
  if (count === -1) return ["the capture size differs from the baseline"];
  if (!isCount(count, 0))
    return [
      `the pixel count ${JSON.stringify(count)} is not a non-negative integer`,
    ];
  if (count === 0) return [];
  const problems = [
    `${String(count)} pixels differ from the baseline after restore`,
  ];
  if (check["diagnostic"] !== count)
    problems.push(
      `the diagnostic counted ${JSON.stringify(check["diagnostic"] ?? null)} pixels, the comparison ${String(count)}`,
    );
  return problems;
}

/**
 * Why one observation fails its cycle. Only zero differing pixels, with every other condition
 * met, has no problem; the supplied problems list is never consulted.
 */
export function postRestoreProblems(
  check: unknown,
  baseline: RunBaseline,
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
  if (check["width"] !== baseline.width || check["height"] !== baseline.height)
    problems.push(
      `the capture is ${String(check["width"])}x${String(check["height"])}, the baseline ${String(baseline.width)}x${String(baseline.height)}`,
    );
  problems.push(...focusProblems(check));
  try {
    problems.push(
      ...restoredProblems(
        baseline.state,
        check["state"],
        expected?.scheme ?? null,
      ).map((problem) => `restored state: ${problem}`),
    );
  } catch (error) {
    problems.push(`restored state: ${describe(error)}`);
  }
  problems.push(...countProblems(check));
  return problems;
}

const ledgerPath = (root: string) => join(root, "hc-run", "cycles.jsonl");

export function recordCycle(root: string, row: CycleRow) {
  appendFileSync(ledgerPath(root), `${JSON.stringify(row)}\n`);
}

/** File operations the writer uses; tests replace one to prove a failure stays a failure. */
export interface WriterIo {
  makeFolder: (path: string) => void;
  create: (path: string, bytes: Uint8Array) => void;
}

const realIo: WriterIo = {
  makeFolder: (path) => {
    mkdirSync(path, { recursive: true });
  },
  create: (path, bytes) => {
    writeFileSync(path, bytes, { flag: "wx" });
  },
};

/** Keeps whatever a failed cycle has; a write that fails is one more problem, never a rescue. */
function keepDiagnostics(
  io: WriterIo,
  root: string,
  observation: Observation,
  images: PostRestoreImages,
) {
  const known = expectedCycles.find((c) => c.cycle === observation.cycle);
  if (known === undefined) return [];
  const folder = cycleFolder(known.project, known.scheme);
  const files: string[] = [];
  const keep = (name: string, bytes: Uint8Array) => {
    io.create(join(root, ...folder.split("/"), name), bytes);
    files.push(`${folder}/${name}`);
  };
  try {
    io.makeFolder(join(root, ...folder.split("/")));
    for (const role of imageRoles) {
      const bytes = images[role];
      if (bytes !== null && bytes.length > 0) keep(`${role}.png`, bytes);
    }
    keep(
      "observation.json",
      Buffer.from(`${JSON.stringify(observation, null, 2)}\n`),
    );
  } catch (error) {
    observation.problems.push(
      `diagnostics were not written: ${describe(error)}`,
    );
  }
  return files;
}

/**
 * Judges one post-restore check, keeps the images of a failed one, appends its record and throws
 * unless the cycle is exact. A record that cannot be appended is itself a failure.
 */
export function settlePostRestore(options: {
  check: Omit<Observation, "problems">;
  images: PostRestoreImages;
  baseline: RunBaseline;
  root: string;
  append: (row: CycleRow) => void;
  io?: Partial<WriterIo>;
}): CycleRow {
  const io = { ...realIo, ...options.io };
  const observation: Observation = { ...options.check, problems: [] };
  observation.problems = postRestoreProblems(observation, options.baseline);
  const failed = observation.problems.length > 0;
  const row: CycleRow = {
    version: recordVersion,
    outcome: failed ? "failed" : "exact",
    observation,
    files: failed
      ? keepDiagnostics(io, options.root, observation, options.images)
      : [],
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

type Standing = "exact" | "failed" | "incomplete";

const isExact = (row: unknown) =>
  isObject(row) &&
  row["version"] === recordVersion &&
  row["outcome"] === "exact" &&
  isObject(row["observation"]) &&
  row["observation"]["changed"] === 0 &&
  Array.isArray(row["observation"]["problems"]) &&
  row["observation"]["problems"].length === 0;

/**
 * Where each of the six cycles stands in the records under root. A cycle with no record is
 * incomplete; one recorded twice, or with anything but an exact record, is failed. Records that
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
      standing = isExact(rows[0]) ? "exact" : "failed";
    return { cycle, standing };
  });
  const count = (standing: Standing) =>
    cycles.filter((c) => c.standing === standing).length;
  return {
    available,
    cycles,
    problems,
    exact: count("exact"),
    failed: count("failed"),
    incomplete: count("incomplete"),
  };
}

/** Why the records do not show six distinct exact cycles; the launcher fails the run on any. */
export function completenessProblems(root: string): string[] {
  try {
    const standings = cycleStandings(root);
    return [
      ...standings.problems,
      ...standings.cycles
        .filter((c) => c.standing !== "exact")
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
  return `Post-restore: ${String(standings.exact + standings.failed)}/${String(cycleCount)} cycles completed; ${String(standings.exact)} exact, ${String(standings.failed)} failed, ${String(standings.incomplete)} incomplete; ${step}`;
}

/**
 * Writes the summary to the log and the job summary and returns the exit status: failed unless the
 * test step succeeded and the records show six distinct exact cycles.
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
      standings.exact === cycleCount
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
