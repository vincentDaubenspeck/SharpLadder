// Batch cases: a file list over the command line bound runs in several batches and every file is
// passed on; one failing batch fails the run; a failed shell file discovery fails every shell stage.
// Usage: node tools/tests/batch-cases.mjs <empty work directory>
// The discovery case needs shfmt and ShellCheck from tools/install-tools.mjs.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLength, exec, execBatched } from "../checks/lib.mjs";
import { claimWorkDir } from "./work-dir.mjs";

const src = join(import.meta.dirname, "..", "..");
const claim = claimWorkDir(process.argv.slice(2), "usage: node tools/tests/batch-cases.mjs <empty work directory>");
if (claim.problem) {
  console.error(claim.problem);
  process.exit(2);
}
const work = claim.dir;

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (ok) return;
  failed++;
  for (const line of detail.split(/\r?\n/).filter((l) => l.trim() !== "")) console.log(`  ${line}`);
}
const lines = (text) => text.split(/\r?\n/).filter((l) => l !== "");

// Node stands in for the tool: it prints the files it was given and fails on the one named in SL_FAIL_ON.
const echo = [
  "-e",
  'const a = process.argv.slice(1); console.log(a.join(" ")); process.exitCode = a.includes(process.env.SL_FAIL_ON) ? 1 : 0;',
];
const files = Array.from({ length: 10 }, (_, i) => `f${String(i).padStart(2, "0")}`);
// Room for three files beside the program and its fixed arguments.
const bound = commandLength([process.execPath, ...echo]) + 3 * commandLength([files[0]]);

const all = execBatched(process.execPath, echo, files, {}, bound);
check(
  "a list over the bound runs in several batches and every file is passed on, in order",
  all.code === 0 && lines(all.out).length === 4 && lines(all.out).join(" ") === files.join(" "),
  all.out,
);

const env = { ...process.env, SL_FAIL_ON: "f04" };
const one = execBatched(process.execPath, echo, files, { env }, bound);
check(
  "one failing batch fails the run and the later batches still report",
  one.code === 1 && lines(one.out).join(" ") === files.join(" "),
  one.out,
);

// A tracked file missing from the worktree makes shfmt -f fail; the shell stages must not pass on no files.
const repo = join(work, "repo");
const git = (...args) => exec("git", ["-c", "core.autocrlf=false", ...args], { cwd: repo });
exec("git", ["init", "-q", repo]);
writeFileSync(join(repo, "a.sh"), "#!/bin/sh\necho a\n");
writeFileSync(join(repo, "gone.sh"), "#!/bin/sh\necho gone\n");
git("add", "a.sh", "gone.sh");
rmSync(join(repo, "gone.sh"));
const shell = exec(process.execPath, [join(src, "tools", "checks", "shell.mjs")], { cwd: repo });
const reasons = lines(shell.out).filter((l) => l.startsWith("  shell file discovery (shfmt -f) failed: "));
check(
  "a failed shell file discovery fails every shell stage, suppression reasons included",
  shell.code === 1 &&
    reasons.length === 3 &&
    ["shell format (shfmt)", "shell suppression reasons", "ShellCheck"].every((s) => lines(shell.out).includes(`FAIL ${s}`)),
  shell.out,
);

process.exitCode = failed > 0 ? 1 : 0;
