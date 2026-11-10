// Node half of the real Windows high-contrast acceptance: the hosted-runner guard, the SPI script,
// the enable and restore contracts, the run-global baseline and the evidence record.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256, writeEvidence } from "./fonts.ts";
import { groupDCells } from "./group-d.ts";
import { type Box, type Engine } from "./high-contrast-cycles.ts";
import {
  colourKeys,
  evidenceOnly,
  own,
  parseState,
  schemes,
  shapeProblems,
  type HighContrastState,
  type Scheme,
} from "./high-contrast-state.ts";

export {
  colourKeys,
  evidenceOnly,
  fontSmoothingKeys,
  nameKeys,
  restoredProblems,
  schemes,
  shapeProblems,
  sysColorCount,
  type HighContrastState,
  type Scheme,
} from "./high-contrast-state.ts";
export { type Engine } from "./high-contrast-cycles.ts";

const repo = join(import.meta.dirname, "..", "..");

/**
 * Every variable a disposable GitHub-hosted windows-2025 runner sets, plus the explicit opt-in.
 * The same table is in tools/high-contrast.ps1; a test keeps the two equal.
 */
export const hostedRunner: Readonly<Record<string, string>> = {
  GITHUB_ACTIONS: "true",
  CI: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  RUNNER_OS: "Windows",
  ImageOS: "win25-vs2026",
  USERNAME: "runneradmin",
  SHARPLADDER_REAL_HIGH_CONTRAST: "1",
};

/** Why this process may not change the OS setting; empty only on an opted-in hosted runner. */
export function hostedProblems(
  env: Record<string, string | undefined>,
  platform: string,
): string[] {
  const problems =
    platform === "win32" ? [] : [`platform is ${platform}, not win32`];
  for (const [name, want] of Object.entries(hostedRunner))
    if (env[name] !== want) problems.push(`${name} is not ${want}`);
  return problems;
}

/** The evidence-only registry values, complete before and after, with presence. */
export function registryEvidence(
  baseline: HighContrastState,
  observed: HighContrastState,
) {
  return evidenceOnly.map((key) => ({
    key,
    before: {
      present: Object.hasOwn(baseline.registry, key),
      value: own(baseline.registry, key) ?? null,
    },
    after: {
      present: Object.hasOwn(observed.registry, key),
      value: own(observed.registry, key) ?? null,
    },
  }));
}

/**
 * Why an observed state is not the requested scheme turned on: on, available, the baseline
 * flags plus the on bit, the exact name, and a palette that differs from the baseline palette.
 */
export function enableProblems(
  baseline: unknown,
  observed: unknown,
  scheme: Scheme,
): string[] {
  if (!(schemes as readonly string[]).includes(scheme))
    throw new Error(`'${scheme}' is not a known scheme`);
  const shape = [
    ...shapeProblems(baseline, "baseline"),
    ...shapeProblems(observed, "observed"),
  ];
  if (shape.length > 0) return shape;
  const [was, now] = [baseline, observed] as HighContrastState[];
  if (was === undefined || now === undefined) return ["malformed state"];
  const problems: string[] = [];
  if (!now.on) problems.push("on false, not true");
  if (!now.available) problems.push("available false, not true");
  const want = was.flags | 1;
  if (now.flags !== want)
    problems.push(`flags ${String(now.flags)}, not ${String(want)}`);
  if (now.scheme !== scheme)
    problems.push(`scheme '${now.scheme}', not '${scheme}'`);
  if (colourKeys.every((key) => now.colours[key] === was.colours[key]))
    problems.push("palette unchanged from the baseline");
  return problems;
}

/** Why a state cannot be the run-global baseline: it must be complete, off and available. */
export function baselineProblems(state: unknown): string[] {
  const shape = shapeProblems(state, "baseline");
  if (shape.length > 0) return shape;
  const problems: string[] = [];
  const { on, available } = state as HighContrastState;
  if (on) problems.push("high contrast is on before the run");
  if (!available) problems.push("high contrast is not available");
  return problems;
}

type Spawn = (
  command: string,
  args: string[],
  timeout: number,
) => {
  status: number | null;
  stdout: string;
  stderr: string;
  signal?: string | null;
};

/** Above the script's 30,000 ms poll deadline, so the deadline always reports first. */
export const transitionWatchdogMs = 45_000;

const run: Spawn = (command, args, timeout) =>
  spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout });

export interface SpiOptions {
  scheme?: Scheme;
  baseline?: string;
  lastEnabled?: Scheme | null;
  evidence?: string;
}

/**
 * Runs the SPI script; the guard is checked here first, so a refused host never starts it.
 * Each transition and its polling run in one invocation, bounded by a watchdog.
 */
export function spi(
  action: "read" | "enable" | "restore",
  options: SpiOptions = {},
  { env = process.env, platform = process.platform, spawn = run } = {},
): HighContrastState {
  const problems = hostedProblems(env, platform);
  if (problems.length > 0)
    throw new Error(
      `high contrast: refused, not an opted-in hosted runner: ${problems.join("; ")}`,
    );
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(repo, "tools", "high-contrast.ps1"),
    "-Action",
    action,
  ];
  if (options.scheme !== undefined) args.push("-Scheme", options.scheme);
  if (options.baseline !== undefined) args.push("-Baseline", options.baseline);
  if (options.lastEnabled !== undefined && options.lastEnabled !== null)
    args.push("-LastEnabled", options.lastEnabled);
  if (options.evidence !== undefined) args.push("-Evidence", options.evidence);
  const result = spawn("powershell.exe", args, transitionWatchdogMs);
  if (result.status !== 0)
    throw new Error(
      `high contrast: ${action} exited ${String(result.status)}${result.signal ? ` (${result.signal})` : ""}: ${result.stderr.trim()}`,
    );
  return parseState(JSON.parse(result.stdout), action);
}

/** Where the global setup leaves the run-global baseline, and the digests that pin it. */
export const runVariable = "SHARPLADDER_HC_RUN";

export interface Run {
  dir: string;
  json: string;
  png: string;
}

const runPaths = (dir: string) => ({
  json: join(dir, "baseline.json"),
  png: join(dir, "baseline.png"),
  lastEnabled: join(dir, "last-enabled.json"),
});

/** Writes a file that must never be replaced: create-only, then read-only. */
function writeOnce(path: string, data: string | Uint8Array) {
  writeFileSync(path, data, { flag: "wx" });
  chmodSync(path, 0o444);
  return sha256(typeof data === "string" ? Buffer.from(data) : data);
}

/** Captures the run-global baseline once; a second capture into the same run fails. */
export function writeBaseline(
  dir: string,
  state: HighContrastState,
  png: Uint8Array,
): Run {
  const problems = baselineProblems(state);
  if (problems.length > 0)
    throw new Error(`high contrast baseline: ${problems.join("; ")}`);
  pngSize(png);
  const paths = runPaths(dir);
  const text = `${JSON.stringify(state, null, 2)}\n`;
  return {
    dir,
    json: writeOnce(paths.json, text),
    png: writeOnce(paths.png, png),
  };
}

export const encodeRun = (run: Run) => JSON.stringify(run);

/** The baseline the global setup wrote, refused if either file no longer has its digest. */
export function loadBaseline(encoded: string | undefined) {
  if (encoded === undefined)
    throw new Error(
      `high contrast: ${runVariable} is not set; the global setup did not capture a baseline`,
    );
  const run = JSON.parse(encoded) as Run;
  const paths = runPaths(run.dir);
  const text = readFileSync(paths.json);
  const png = new Uint8Array(readFileSync(paths.png));
  if (sha256(text) !== run.json || sha256(png) !== run.png)
    throw new Error(
      "high contrast: the baseline changed after it was captured",
    );
  return {
    run,
    path: paths.json,
    state: parseState(JSON.parse(text.toString("utf8")), "baseline"),
    png,
    size: pngSize(png),
  };
}

/** The last scheme any project turned on in this run; null before the first enable. */
export function readLastEnabled(dir: string): Scheme | null {
  const path = runPaths(dir).lastEnabled;
  if (!existsSync(path)) return null;
  const { scheme } = JSON.parse(readFileSync(path, "utf8")) as {
    scheme: unknown;
  };
  if (!(schemes as readonly unknown[]).includes(scheme))
    throw new Error(
      `high contrast: last enabled scheme ${String(scheme)} is unknown`,
    );
  return scheme as Scheme;
}

/** Recorded before the enable is attempted, so a partial change is always covered. */
export function recordLastEnabled(dir: string, scheme: Scheme) {
  writeFileSync(runPaths(dir).lastEnabled, `${JSON.stringify({ scheme })}\n`);
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * One scheme: the change and its body, then the restore in a finally whatever failed. Both the
 * primary and the restoration error are noted before the combined error is thrown; a note that
 * fails is added to them, never thrown in their place.
 */
export async function withRestore(steps: {
  change: () => Promise<void>;
  restore: () => Promise<void>;
  note: (errors: string[]) => void;
}) {
  const errors: unknown[] = [];
  try {
    await steps.change();
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await steps.restore();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    const messages = errors.map(describe);
    try {
      steps.note([...messages]);
    } catch (error) {
      errors.push(error);
      messages.push(`recording the errors: ${describe(error)}`);
    }
    throw new Error(messages.join(" | then: "), {
      cause: new AggregateError(errors),
    });
  }
}

export interface Clock {
  now: () => number;
  after: (ms: number, fire: () => void) => () => void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fire) => {
    const timer = setTimeout(fire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

/**
 * The work's result, or a rejection once ms have passed since start. Expiry calls stop so the
 * work tears itself down; work is never started when the deadline has already passed.
 */
export function beforeDeadline<T>(
  work: () => Promise<T>,
  deadline: { start: number; ms: number; clock: Clock; stop: () => void },
): Promise<T> {
  const { start, ms, clock, stop } = deadline;
  const expired = () =>
    new Error(`timed out: ${String(ms)} ms after the restore was accepted`);
  const left = start + ms - clock.now();
  if (left <= 0) {
    stop();
    return Promise.reject(expired());
  }
  return new Promise<T>((resolve, reject) => {
    const cancel = clock.after(left, () => {
      stop();
      reject(expired());
    });
    // A busy event loop can delay the timer past the deadline, so settling reads the clock itself.
    const overdue = () => {
      cancel();
      if (start + ms - clock.now() > 0) return false;
      stop();
      reject(expired());
      return true;
    };
    work().then(
      (value) => {
        if (!overdue()) resolve(value);
      },
      (error: unknown) => {
        if (!overdue())
          reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunk = String.fromCharCode(...png.subarray(12, 16));
  if (
    png.length < 24 ||
    signature.some((byte, i) => png[i] !== byte) ||
    chunk !== "IHDR"
  )
    throw new Error("high contrast: the capture is not a PNG");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Exact RGBA comparison: the differing-pixel count, their bounding box (null when none), and a
 * mask with each differing pixel pure red over a light grey copy of the first image.
 */
export function pixelDiff(a: Rgba, b: Rgba) {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(
      `high contrast: ${String(b.width)}x${String(b.height)} is not ${String(a.width)}x${String(a.height)}`,
    );
  const size = a.width * a.height * 4;
  if (a.data.length !== size || b.data.length !== size)
    throw new Error("high contrast: pixel data does not match its size");
  const mask = new Uint8Array(size);
  let count = 0;
  let [left, top, right, bottom] = [a.width, a.height, -1, -1];
  for (let i = 0; i < size; i += 4) {
    const same =
      a.data[i] === b.data[i] &&
      a.data[i + 1] === b.data[i + 1] &&
      a.data[i + 2] === b.data[i + 2] &&
      a.data[i + 3] === b.data[i + 3];
    if (same) {
      const sum =
        (a.data[i] ?? 0) + (a.data[i + 1] ?? 0) + (a.data[i + 2] ?? 0);
      // Grey from 192 to 255, so no unmarked pixel is ever the marking red.
      mask.fill(192 + Math.floor(sum / 12), i, i + 3);
      mask[i + 3] = 255;
      continue;
    }
    mask.set([255, 0, 0, 255], i);
    count += 1;
    const pixel = i / 4;
    const [x, y] = [pixel % a.width, Math.floor(pixel / a.width)];
    [left, top] = [Math.min(left, x), Math.min(top, y)];
    [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
  }
  const box: Box | null =
    count === 0
      ? null
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  return { count, box, mask };
}

/** Writes the record now and returns a saver, so every later update reaches the disk at once. */
export function recorder(path: string, record: object) {
  const save = () => writeEvidence(path, record);
  save();
  return save;
}

/**
 * Observed per engine at the pinned versions on hosted windows-2025: whether real high contrast
 * is detected, and whether the page Canvas is the OS window colour. A change in either fails.
 */
export const capability: Readonly<
  Record<Engine, { detects: boolean; followsOs: boolean }>
> = {
  chromium: { detects: true, followsOs: true },
  firefox: { detects: true, followsOs: false },
  webkit: { detects: false, followsOs: false },
};

export function engineNamed(name: unknown): Engine {
  if (name === "chromium" || name === "firefox" || name === "webkit")
    return name;
  throw new Error(`high contrast: unrecorded engine ${String(name)}`);
}

export type Verdict = "pass" | "fail" | "unsupported" | "not-run";

/** One matrix cell's verdict; unsupported only where the engine is recorded as not detecting. */
export function verdictOf(
  engine: Engine,
  detected: boolean,
  fails: readonly string[],
): Verdict {
  if (detected !== capability[engine].detects) return "fail";
  if (!detected) return "unsupported";
  return fails.length === 0 ? "pass" : "fail";
}

/** The evidence rows for a scheme the engine does not detect: every cell named, none a pass. */
export function unsupportedCells(engine: Engine, scheme: Scheme) {
  return groupDCells().map((cell) => ({
    scheme,
    key: cell.key,
    width: cell.width,
    theme: cell.theme ?? "absent",
    verdict: verdictOf(engine, false, []),
    reason: `${engine} does not detect real high contrast`,
  }));
}

/** Every scheme and cell before anything runs; a row stays not-run until its cell is measured. */
export function notRunCells(): {
  scheme: Scheme;
  key: string;
  width: number;
  theme: string;
  verdict: Verdict;
}[] {
  return schemes.flatMap((scheme) =>
    groupDCells().map((cell) => ({
      scheme,
      key: cell.key,
      width: cell.width,
      theme: cell.theme ?? "absent",
      verdict: "not-run",
    })),
  );
}

/** Cells per verdict, the failed keys, and passed only for a complete matrix with no error. */
export function tally(
  rows: readonly { key: string; verdict: Verdict }[],
  errors: readonly string[] = [],
) {
  const count: Record<Verdict, number> = {
    pass: 0,
    fail: 0,
    unsupported: 0,
    "not-run": 0,
  };
  for (const row of rows) count[row.verdict] += 1;
  return {
    count,
    failed: rows.filter((r) => r.verdict === "fail").map((r) => r.key),
    complete: count["not-run"] === 0,
    passed:
      rows.length > 0 &&
      count["not-run"] === 0 &&
      count.fail === 0 &&
      errors.length === 0,
  };
}

/** Parses "#RRGGBB" into its channels. */
export function channels(hex: string): [number, number, number] {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/iu.exec(hex);
  if (match === null) throw new Error(`high contrast: ${hex} is not #RRGGBB`);
  return [1, 2, 3].map((i) => parseInt(match[i] ?? "", 16)) as [
    number,
    number,
    number,
  ];
}
