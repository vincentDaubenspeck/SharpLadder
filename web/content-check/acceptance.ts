// The supported way to run the suite: Vitest itself, then proof from its own results that every
// compiled record's round-trip cases ran and passed. The entry normalises the child runner's
// environment for the keys named below. It trusts the launching process, the reviewed
// configuration, dependencies and toolchain, and a quiet tree; it is not a sandbox against a
// hostile launching environment, and configuration written to fabricate records or results is
// out of scope.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordInventory } from "./inventory.ts";

const web = realpathSync.native(join(import.meta.dirname, ".."));

export const roundTripFile = "src/content/round-trip.test.tsx";
export const roundTripSuite = "the round trip of ";
/** The record-backed cases; a test binds this list to the round-trip file's own source. */
export const roundTripCases: readonly string[] = [
  "renders only after the bytes equal the witness",
  "writes exactly the compiled anchors as ids, labels apart",
  "places block ids and labels on their own elements",
  "builds every link href from its target and chapter only",
  "leaves no empty wrapper element",
  "starts headings at h2 and never skips a level",
  "keeps each list's kind and start",
  "names every link by its author text, never its address",
];

// Keys that would choose what the child runner executes, compared without case. Everything else
// passes through, because the run also starts the .NET content compiler.
const runnerKeys = new Set([
  "node_options",
  "node_env",
  "node_path",
  "node_v8_coverage",
  "update_snapshot",
  "vitest",
  "test",
  "esbuild_binary_path",
  "__vite_additional_server_allowed_hosts",
]);
const runnerPrefixes = ["vitest_", "vite_", "ts_node_", "npm_config_"];
// The one npm setting kept: it names where offline fixture installs find their packages, and
// chooses nothing that runs.
const keptKey = "npm_config_cache";

/** The child runner's environment: the caller's without the runner keys, in test mode. */
export function runnerEnv(
  caller: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(caller)) {
    const lower = key.toLowerCase();
    if (
      value === undefined ||
      runnerKeys.has(lower) ||
      (lower !== keptKey &&
        runnerPrefixes.some((prefix) => lower.startsWith(prefix)))
    )
      continue;
    env[key] = value;
  }
  env["NODE_ENV"] = "test";
  return env;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The same file under any spelling: both names are resolved to the one the disk holds and then
// compared character for character, so two files whose names differ only in case stay apart.
function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync.native(a) === realpathSync.native(b);
  } catch {
    return false;
  }
}

/**
 * What a Vitest JSON report fails to prove: exactly one passed result for every record-backed
 * case of every expected record, in the one round-trip file. A filter, a skip, an excluded file
 * or a missing global setup all end here as a case that did not pass.
 */
export function evidenceProblems(
  report: unknown,
  root: string,
  expected: readonly string[],
): string[] {
  if (expected.length === 0) return ["the compiled inventory is empty"];
  if (!isObject(report) || !Array.isArray(report["testResults"]))
    return ["the Vitest report has no test results"];
  if (report["success"] !== true)
    return ["the Vitest report does not record a successful run"];
  const results: unknown[] = report["testResults"];
  const files = results.filter(
    (file): file is Record<string, unknown> =>
      isObject(file) &&
      typeof file["name"] === "string" &&
      sameFile(file["name"], join(root, roundTripFile)),
  );
  const [file] = files;
  if (file === undefined || files.length !== 1)
    return [
      `${roundTripFile} has ${String(files.length)} results in the Vitest report`,
    ];
  const assertions: unknown = file["assertionResults"];
  if (!Array.isArray(assertions))
    return [`${roundTripFile} has no case results`];
  const outcomes = new Map<string, string[]>();
  const problems: string[] = [];
  for (const assertion of assertions as unknown[]) {
    const suites = isObject(assertion) ? assertion["ancestorTitles"] : null;
    if (
      !isObject(assertion) ||
      !Array.isArray(suites) ||
      typeof assertion["title"] !== "string" ||
      typeof assertion["status"] !== "string"
    )
      return [`${roundTripFile} has a malformed case result`];
    const titles: unknown[] = suites;
    const [suite, ...deeper] = titles;
    if (typeof suite !== "string" || !suite.startsWith(roundTripSuite))
      continue;
    const path = suite.slice(roundTripSuite.length);
    const title = assertion["title"];
    if (
      deeper.length > 0 ||
      !expected.includes(path) ||
      !roundTripCases.includes(title)
    ) {
      problems.push(`${suite}: unexpected case "${title}"`);
      continue;
    }
    const key = JSON.stringify([path, title]);
    outcomes.set(key, [...(outcomes.get(key) ?? []), assertion["status"]]);
  }
  for (const path of expected) {
    for (const title of roundTripCases) {
      const found = outcomes.get(JSON.stringify([path, title])) ?? [];
      if (found.length !== 1 || found[0] !== "passed")
        problems.push(
          `${path}: "${title}" must pass exactly once, found [${found.join(", ")}]`,
        );
    }
  }
  return problems;
}

/**
 * Runs Vitest in the web root with its JSON report written to a fresh folder, keeps the
 * runner's failing exit, and otherwise fails on any gap the report leaves. The extra arguments
 * exist for tests of this function; the command line admits none of them.
 */
export function acceptRun(
  extra: readonly string[] = [],
  log: (line: string) => void = console.error,
): number {
  const out = mkdtempSync(join(tmpdir(), "sl-accept-"));
  const results = join(out, "results.json");
  try {
    const run = spawnSync(
      process.execPath,
      [
        join(web, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${results}`,
        ...extra,
      ],
      { cwd: web, env: runnerEnv(process.env), stdio: "inherit" },
    );
    if (run.status !== 0) return run.status ?? 1;
    let problems: string[];
    try {
      // The global setup of the run above has just had the compiler certify this folder.
      problems = evidenceProblems(
        JSON.parse(readFileSync(results, "utf8")),
        web,
        recordInventory(join(web, "compiled")),
      );
    } catch (error) {
      problems = [`the Vitest report could not be judged: ${String(error)}`];
    }
    for (const problem of problems) log(`round trip evidence: ${problem}`);
    return problems.length > 0 ? 1 : 0;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const invoked =
  process.argv[1] !== undefined &&
  sameFile(process.argv[1], fileURLToPath(import.meta.url));

if (invoked) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    // A filter or another configuration would select which evidence exists.
    console.error(`acceptance: unexpected argument ${String(args[0])}`);
    process.exitCode = 2;
  } else process.exitCode = acceptRun();
}
