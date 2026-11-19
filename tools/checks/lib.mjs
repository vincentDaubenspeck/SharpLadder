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
export const npmCli = [
  join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
  join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((p) => existsSync(p));

// Runs a program; returns its exit code (null when it could not start, was killed or timed
// out), the signal that ended it, merged output in out, each stream on its own, and the
// error message in error when the run failed.
export function exec(cmd, args, opts = {}) {
  if (cmd === "npm") {
    if (!npmCli) {
      const error = "npm not found next to node";
      return { code: null, signal: null, out: error, stdout: "", stderr: "", error };
    }
    return exec(process.execPath, [npmCli, ...args], opts);
  }
  const r = spawnSync(cmd, args, {
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  const signal = r.signal ?? null;
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const out = `${stdout}${stderr}`;
  // Output written before a timeout or an overfull buffer is often the only clue to the cause.
  if (r.error) {
    const error = String(r.error.message);
    const sep = out === "" || out.endsWith("\n") ? "" : "\n";
    return { code: null, signal, out: `${out}${sep}${error}`, stdout, stderr, error };
  }
  return { code: r.status, signal, out, stdout, stderr };
}

// Well below the Windows limit of 32,767 characters, which leaves room for launchers such as
// Python's console scripts that start the interpreter on a longer command line of their own.
export const commandBound = 24_000;

// At most what Windows quoting makes of an argument: one that is empty or holds a space, tab
// or quote is wrapped in quotes, and each quote or backslash in it may gain an escape.
const quotedLength = (arg) => (arg === "" || /[ \t"]/.test(arg) ? 2 * arg.length + 2 : arg.length);
export const commandLength = (args) => args.reduce((n, a) => n + quotedLength(a) + 1, 0);

// Each batch's output starts on its own line, so the last line of one never runs into the next.
const joinOutputs = (parts) =>
  parts.reduce((all, p) => (all === "" || all.endsWith("\n") ? all + p : `${all}\n${p}`), "");

// Runs cmd with fixed arguments over files in batches whose whole command line stays within
// bound; outputs are joined in order. The result fails when any batch fails or cannot start,
// or when one file cannot fit at all. An empty list runs once, as an unbatched call would.
export function execBatched(cmd, fixed, files, opts = {}, bound = commandBound) {
  const base = commandLength([cmd, ...fixed]);
  const batches = [[]];
  let length = base;
  for (const f of files) {
    const add = commandLength([f]);
    if (base + add > bound) {
      const error = `${f}: too long for one command line of at most ${String(bound)} characters`;
      return { code: null, signal: null, out: error, stdout: "", stderr: "", error };
    }
    if (length + add > bound) {
      batches.push([]);
      length = base;
    }
    batches.at(-1).push(f);
    length += add;
  }
  const runs = [];
  for (const batch of batches) {
    const r = exec(cmd, [...fixed, ...batch], opts);
    runs.push(r);
    // A tool that could not start or was killed cannot check the batches after it either.
    if (r.code === null) break;
  }
  const failed = runs.find((r) => r.code !== 0);
  return {
    code: failed === undefined ? 0 : failed.code,
    signal: failed?.signal ?? null,
    out: joinOutputs(runs.map((r) => r.out)),
    stdout: joinOutputs(runs.map((r) => r.stdout)),
    stderr: joinOutputs(runs.map((r) => r.stderr)),
    ...(failed?.error === undefined ? {} : { error: failed.error }),
  };
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
// The run's exit status, which check.sh reads.
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
