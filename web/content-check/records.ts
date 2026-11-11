import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

export interface Run {
  readonly stdout: Uint8Array;
  readonly stderr: string;
  readonly exit: number | null;
}

let built = false;

// Build output goes to the build's own streams, never into the records protocol. One build per
// process is enough: the compiler sources are never among the trees a run checks.
function buildCompiler(): void {
  if (built) return;
  const r = spawnSync(dotnet, ["build", project, "--nologo", "-v", "q"], {
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0)
    throw new Error(
      `content compiler build failed (${String(r.status ?? r.error)}):\n${r.stdout}${r.stderr}`,
    );
  built = true;
}

/**
 * Runs test-records over the committed payload of a repository-shaped tree, this repository by
 * default, with stdout redirected to a pipe, in a fresh staging folder that is removed
 * afterwards; roots are absolute because the compiler takes no other form.
 */
export function runTestRecords(
  roots: {
    readonly repository?: string;
    readonly staging?: string;
    // Only a test file can rely on it: its run's global setup has always built first.
    readonly builtByGlobalSetup?: true;
  } = {},
): Run {
  const tree = roots.repository ?? repository;
  if (roots.builtByGlobalSetup !== true) buildCompiler();
  // The temporary folder can be an 8.3 alias on Windows, so the compiler gets its real path.
  const parent = realpathSync.native(
    mkdtempSync(join(tmpdir(), "sl-records-")),
  );
  try {
    const r = spawnSync(
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
      { env, maxBuffer: 64 * 1024 * 1024 },
    );
    if (r.error) throw r.error;
    return {
      stdout: new Uint8Array(r.stdout),
      stderr: r.stderr.toString("utf8"),
      exit: r.status,
    };
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}
