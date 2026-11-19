// Leak stage cases: the stage scans the repository's committed output with both content pairs and
// passes, fails on a marker planted in a copy of that output, and cannot run on a missing target.
// web/dist exists only after a production build, so these cases scan web/compiled; check.sh scans both.
// Usage: node tools/tests/leak-cases.mjs <empty work directory>
// Needs the pinned .NET SDK and nuget.org.
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leakRun, pairs } from "../checks/leak.mjs";
import { dotnet, exec } from "../checks/lib.mjs";
import { claimWorkDir } from "./work-dir.mjs";

const src = join(import.meta.dirname, "..", "..");
const claim = claimWorkDir(process.argv.slice(2), "usage: node tools/tests/leak-cases.mjs <empty work directory>");
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

const committed = "web/compiled";
const fixturePair = pairs[1];
const marker = "// reference: prob-9001";

const build = exec(dotnet, ["build", "tools/SharpLadder.CodeCheck/SharpLadder.CodeCheck.csproj", "-nologo"], { cwd: src });
if (build.code !== 0) check("code checker builds", false, build.out);
else {
  // A pass counts only when files were scanned, so a scan that never ran cannot pass.
  const runs = pairs.map((pair) => leakRun(src, pair, [committed]));
  check(
    "leak stage passes the committed output with both content pairs",
    runs.every((r) => r.code === 0 && /^[1-9]\d* files? scanned\r?$/m.test(r.out) && /^PASS leak\r?$/m.test(r.out)),
    runs.map((r) => r.out).join("\n"),
  );

  const copy = join(work, "compiled");
  cpSync(join(src, committed), copy, { recursive: true });
  writeFileSync(join(copy, "planted.js"), `export const note = 1;\n${marker}\n`);
  const planted = leakRun(src, fixturePair, [copy]);
  check(
    "leak stage fails on a marker planted in a copy of the output",
    planted.code === 1 && planted.out.includes(`/planted.js: raw view: holds the marker "${marker}" of `),
    planted.out,
  );

  const missing = leakRun(src, fixturePair, [join(work, "dist")]);
  check(
    "leak stage cannot run on a missing target (exit 2)",
    missing.code === 2 && missing.out.includes("/dist: missing or unreadable; a target must be a folder or a file"),
    missing.out,
  );
}

process.exitCode = failed > 0 ? 1 : 0;
