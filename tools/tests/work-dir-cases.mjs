// Work-directory cases: content-cases.mjs refuses a missing argument, a file and a nonempty
// directory before it builds or writes anything, and the guard creates a missing directory and
// never adopts one that appears between its check and its create.
// Usage: node tools/tests/work-dir-cases.mjs <empty work directory>
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimWorkDir, createWorkDir } from "./work-dir.mjs";

const usage = "usage: node tools/tests/work-dir-cases.mjs <empty work directory>";
const claim = claimWorkDir(process.argv.slice(2), usage);
if (claim.problem) {
  console.error(claim.problem);
  process.exit(2);
}
const work = claim.dir;
const script = join(import.meta.dirname, "content-cases.mjs");
const contentUsage = "usage: node tools/tests/content-cases.mjs <empty work directory>";

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} work dir: ${label}`);
  if (ok) return;
  failed++;
  for (const line of detail.split(/\r?\n/).filter((l) => l.trim() !== "")) console.log(`  ${line}`);
}

function snapshot(path) {
  if (!statSync(path).isDirectory()) return readFileSync(path).toString("base64");
  return JSON.stringify(readdirSync(path).sort().map((name) => [name, snapshot(join(path, name))]));
}

// Each call runs from its own empty directory, which a run that ignored its argument would fill;
// any output line means a case or the build ran.
let calls = 0;
function refused(label, args, expected, destination) {
  const cwd = join(work, `cwd-${calls++}`);
  mkdirSync(cwd);
  const before = destination ? snapshot(destination) : "";
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  const after = destination ? snapshot(destination) : "";
  check(
    `content cases refuse ${label}`,
    r.status === 2 && r.stdout === "" && r.stderr.trim() === expected && readdirSync(cwd).length === 0 && after === before,
    `exit ${r.status}\n${r.stdout}${r.stderr}${after === before ? "" : "\ndestination changed"}`,
  );
}

refused("an omitted argument", [], contentUsage);

const file = join(work, "file");
writeFileSync(file, Buffer.from([0x6b, 0x65, 0x70, 0x74, 0x00, 0xff, 0x0a]));
refused("a file", [file], `work directory ${file} is not a directory`, file);

const full = join(work, "full");
mkdirSync(full);
writeFileSync(join(full, "sentinel"), "sentinel\n");
refused("a nonempty directory", [full], `work directory ${full} is not empty`, full);

const fresh = join(work, "fresh", "nested");
const absent = !existsSync(fresh);
const made = claimWorkDir([fresh], usage);
check(
  "a missing directory is accepted and created empty",
  absent && made.dir === fresh && statSync(fresh).isDirectory() && readdirSync(fresh).length === 0,
  JSON.stringify(made),
);

// Calls the create step directly, past the emptiness check, as a directory filled after that check would reach it.
const taken = join(work, "taken");
mkdirSync(join(taken, "inner"), { recursive: true });
writeFileSync(join(taken, "sentinel"), Buffer.from([0x74, 0x61, 0x6b, 0x65, 0x6e, 0x00, 0xff]));
writeFileSync(join(taken, "inner", "kept"), "kept\n");
const takenBefore = snapshot(taken);
const collided = createWorkDir(taken);
check(
  "a directory filled after the check is refused by the create step and left as it was",
  collided.dir === undefined &&
    collided.problem?.startsWith(`work directory ${taken} cannot be created: `) &&
    snapshot(taken) === takenBefore,
  JSON.stringify(collided),
);

process.exitCode = failed > 0 ? 1 : 0;
