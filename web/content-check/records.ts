import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { supervise } from "./supervise.ts";

const web = realpathSync.native(join(import.meta.dirname, ".."));
const repository = dirname(web);
const project = join(
  repository,
  "tools",
  "SharpLadder.Content",
  "SharpLadder.Content.csproj",
);
const compiler = join(
  repository,
  "tools",
  "SharpLadder.Content",
  "bin",
  "Debug",
  "net10.0",
  "SharpLadder.Content.dll",
);
const pinned = join(
  repository,
  ".tools",
  "dotnet",
  process.platform === "win32" ? "dotnet.exe" : "dotnet",
);
// The same choice as the check run: the pinned SDK whenever it is installed.
const dotnet = existsSync(pinned) ? pinned : "dotnet";
const env = {
  ...process.env,
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_NOLOGO: "1",
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
  ...(existsSync(pinned) ? { DOTNET_ROOT: dirname(pinned) } : {}),
};

// Three times the slowest build seen (29 s on a hosted runner); the grace is a policy ceiling.
export const buildLimits = { run: 90_000, grace: 5_000 } as const;
// Three times the slowest test-records run seen (5.5 s); the grace is a policy ceiling.
export const recordsLimits = { run: 20_000, grace: 2_000 } as const;
// A policy ceiling on the wait only: rm takes no signal, so a removal can run on after it.
export const cleanupBound = 10_000;
/** The longest a prebuilt call can take: the run, its grace and the staging cleanup. */
export const recordsBudget =
  recordsLimits.run + recordsLimits.grace + cleanupBound;
/** The longest a call that builds first can take, before its caller's own work. */
export const buildingBudget =
  buildLimits.run + buildLimits.grace + recordsBudget;

export interface Run {
  readonly stdout: Uint8Array;
  readonly stderr: string;
  readonly exit: number;
}

let built: Promise<void> | undefined;

// Build output goes to the build's own streams, never into the records protocol. One build per
// process is enough: the compiler sources are never among the trees a run checks. A failed build
// stays failed, so every caller gets the same rejection and nothing builds twice.
function buildCompiler(): Promise<void> {
  built ??= supervise(
    "content compiler build",
    dotnet,
    ["build", project, "--nologo", "-v", "q", "--disable-build-servers"],
    buildLimits,
    { env },
  ).then((r) => {
    if (r.status !== 0)
      throw new Error(
        `content compiler build failed (exit ${String(r.status)}):\n${r.stdout.toString("utf8")}${r.stderr.toString("utf8")}`,
      );
  });
  return built;
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// The losing removal keeps its handler, so a late failure is never an unhandled rejection.
async function removeStaging(parent: string): Promise<Error | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const removal = rm(parent, { recursive: true, force: true }).then(
    () => undefined,
    (error: unknown) =>
      new Error(`staging cleanup of ${parent} failed: ${messageOf(error)}`, {
        cause: error,
      }),
  );
  const overrun = new Promise<Error>((resolve) => {
    timer = setTimeout(() => {
      resolve(
        new Error(
          `staging cleanup of ${parent} did not finish within ${String(cleanupBound)} ms; the folder may be left behind`,
        ),
      );
    }, cleanupBound);
  });
  try {
    return await Promise.race([removal, overrun]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs test-records over the committed payload of a repository-shaped tree, this repository by
 * default, with stdout redirected to a pipe, in a fresh staging folder that is removed
 * afterwards; roots are absolute because the compiler takes no other form. A failed run keeps
 * its own diagnostic and cause, with any cleanup failure appended.
 */
export async function runTestRecords(
  roots: {
    readonly repository?: string;
    readonly staging?: string;
    // Only a test file can rely on it: its run's global setup has always built first.
    readonly builtByGlobalSetup?: true;
  } = {},
): Promise<Run> {
  const tree = roots.repository ?? repository;
  if (roots.builtByGlobalSetup !== true) await buildCompiler();
  // The temporary folder can be an 8.3 alias on Windows, so the compiler gets its real path.
  const parent = realpathSync.native(
    mkdtempSync(join(tmpdir(), "sl-records-")),
  );
  let result: Awaited<ReturnType<typeof supervise>> | undefined;
  let failure: unknown;
  try {
    // The built output runs directly, so nothing here can build, restore or take a build lock.
    result = await supervise(
      "content compiler test-records",
      dotnet,
      [
        compiler,
        "test-records",
        join(tree, "content", "schema"),
        join(tree, "tools", "SharpLadder.Content.Tests", "fixtures", "content"),
        join(tree, "web", "compiled"),
        join(tree, "web", "src", "generated"),
        roots.staging ?? join(parent, "staging"),
      ],
      recordsLimits,
      { env },
    );
  } catch (error) {
    failure = error;
  }
  const cleanup = await removeStaging(parent);
  if (result === undefined) {
    if (cleanup === undefined) throw failure;
    throw new Error(`${messageOf(failure)}\n${cleanup.message}`, {
      cause: failure instanceof Error ? failure.cause : undefined,
    });
  }
  if (cleanup !== undefined) throw cleanup;
  return {
    stdout: new Uint8Array(result.stdout),
    stderr: result.stderr.toString("utf8"),
    exit: result.status,
  };
}
