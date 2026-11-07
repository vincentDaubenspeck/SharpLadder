// Shared helpers for the tool-based checks: tool lookup, pinned versions and stage output.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export const win = process.platform === "win32";
export const scriptRoot = join(import.meta.dirname, "..", "..");
export const pins = JSON.parse(readFileSync(join(scriptRoot, "tools/tool-pins.json"), "utf8"));
export const installHint = "install the pinned tools with: node tools/install-tools.mjs";

// Tools installed by tools/install-tools.mjs come first; inherited ShellCheck options never apply.
function toolEnv() {
  const t = join(scriptRoot, ".tools");
  const dirs = [
    join(t, "bin"),
    join(t, "node", win ? "" : "bin"),
    join(t, "venv", win ? "Scripts" : "bin"),
  ].filter((d) => existsSync(d));
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[key] = [...dirs, env[key] ?? ""].join(delimiter);
  delete env.SHELLCHECK_OPTS;
  env.DOTNET_CLI_TELEMETRY_OPTOUT = "1";
  env.DOTNET_NOLOGO = "1";
  env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1";
  if (existsSync(dotnetHome)) env.DOTNET_ROOT = dotnetHome;
  return env;
}
const dotnetHome = join(scriptRoot, ".tools", "dotnet");
export const env = toolEnv();
// Named by path so an SDK installed elsewhere on PATH is never picked up instead.
export const dotnet = existsSync(join(dotnetHome, win ? "dotnet.exe" : "dotnet"))
  ? join(dotnetHome, win ? "dotnet.exe" : "dotnet")
  : "dotnet";

// The npm bundled with the running Node, started without a shell (npm is a batch file on Windows).
const nodeDir = dirname(process.execPath);
const npmCli = [
  join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
  join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((p) => existsSync(p));

// Runs a program; returns its exit code (null when it could not start) and merged output.
export function exec(cmd, args, opts = {}) {
  if (cmd === "npm") {
    if (!npmCli) return { code: null, out: "npm not found next to node" };
    return exec(process.execPath, [npmCli, ...args], opts);
  }
  const r = spawnSync(cmd, args, {
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  if (r.error) return { code: null, out: String(r.error.message) };
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// Returns null when the tool runs at the pinned version, else the problem text.
export function toolProblem(cmd, args, pattern, want) {
  const r = exec(cmd, args);
  if (r.code === null) return `${cmd} not found; ${installHint}`;
  const got = pattern.exec(r.out)?.[1];
  if (got !== want) return `${cmd} ${got ?? "(unknown version)"} found, ${want} required; ${installHint}`;
  return null;
}

// The tool prints its own problem lines and a final PASS or FAIL line.
export function toolProblems(r, name) {
  const lines = r.out.split(/\r?\n/).filter((l) => l.trim() !== "");
  const last = lines.pop() ?? "";
  if (r.code === 0 && last === `PASS ${name}`) return [];
  const problems = lines.map((l) => l.replace(/^ {2}/, ""));
  return problems.length > 0 ? problems : [last || `exit ${String(r.code)}`];
}

let failed = false;
export function report(name, problems) {
  for (const p of problems) {
    for (const line of p.replace(/\s+$/, "").split(/\r?\n/)) console.log(`  ${line}`);
  }
  if (problems.length === 0) console.log(`PASS ${name}`);
  else {
    console.log(`FAIL ${name}`);
    failed = true;
  }
}
export const anyFailed = () => failed;
// The run's exit status, which check.sh and check.ps1 read.
export function setExitCode() {
  process.exitCode = failed ? 1 : 0;
}
export function notApplicable(name, reason) {
  console.log(`NOT APPLICABLE ${name} (${reason})`);
}

export function gitFiles(root, patterns) {
  const r = exec("git", ["-c", "core.quotepath=off", "ls-files", "-z", "--", ...patterns], {
    cwd: root,
  });
  if (r.code !== 0) throw new Error(`git ls-files failed: ${r.out}`);
  return r.out.split("\0").filter((f) => f !== "");
}

// Locked restore and the CI build properties follow GITHUB_ACTIONS, so both modes are explicit.
export const localEnv = { ...env };
for (const k of Object.keys(localEnv)) if (k.toUpperCase() === "GITHUB_ACTIONS") delete localEnv[k];
export const ciEnv = { ...localEnv, GITHUB_ACTIONS: "true" };
