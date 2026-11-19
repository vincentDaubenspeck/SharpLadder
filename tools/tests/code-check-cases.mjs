// Code check cases: the stage passes a fixture whose code groups all run as written, and a copy
// whose one check is false fails with the checker's file, line, block id and reason.
// Usage: node tools/tests/code-check-cases.mjs <empty work directory>
// Needs the pinned .NET SDK, nuget.org and the reference set from tools/install-tools.mjs.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codeCheckProblems } from "../checks/code-check.mjs";
import { dotnet, exec } from "../checks/lib.mjs";
import { claimWorkDir } from "./work-dir.mjs";

const src = join(import.meta.dirname, "..", "..");
const claim = claimWorkDir(process.argv.slice(2), "usage: node tools/tests/code-check-cases.mjs <empty work directory>");
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

const fixture = "tools/SharpLadder.CodeCheck.Tests/fixtures/all-containers";
// The fixture drill's reference and wrong solution, so its suite runs too.
const reference = "tools/SharpLadder.CodeCheck.Tests/fixtures/all-containers-reference";
const truth = 'check="sum == 74"';

const build = exec(dotnet, ["build", "tools/SharpLadder.CodeCheck/SharpLadder.CodeCheck.csproj", "-nologo"], { cwd: src });
if (build.code !== 0) check("code checker builds", false, build.out);
else {
  const passing = codeCheckProblems(src, { input: fixture, reference });
  check("code check passes a fixture whose groups all run", passing.length === 0, passing.join("\n"));

  // The same fixture with one check made false: only running the group can find it.
  const copy = join(work, "false-check");
  cpSync(join(src, fixture), copy, { recursive: true });
  const file = join(copy, "chapters", "fixture-basics", "syntax.md");
  const text = readFileSync(file, "utf8");
  if (!text.includes(truth)) throw new Error(`syntax.md lacks ${truth}`);
  writeFileSync(file, text.replace(truth, 'check="sum == 75"'));
  const failing = codeCheckProblems(src, { input: copy, reference });
  // The checker shows the root in its own resolved form, which may expand 8.3 names, so only the part below it is compared.
  check(
    "code check fails a false check with its file, line, block id and reason",
    failing.length === 1 &&
      failing[0].endsWith("/false-check/chapters/fixture-basics/syntax.md:19 syn-fix-sum2 check is false: sum == 75"),
    failing.join("\n"),
  );
}

process.exitCode = failed > 0 ? 1 : 0;
