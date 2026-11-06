// Tool-based checks shared by tools/check.sh and tools/check.ps1.
// Each stage prints PASS or FAIL; a missing or wrong-version tool is a FAIL, never a skip.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  anyFailed,
  exec,
  gitFiles,
  installHint,
  pins,
  report,
  toolProblem,
  win,
} from "./lib.mjs";
import { shellChecks, trackedShellFiles } from "./shell.mjs";

const top = exec("git", ["rev-parse", "--show-toplevel"]);
if (top.code !== 0) {
  console.log("FAIL not inside a git repository");
  process.exit(1);
}
const root = top.out.trim();
const web = join(root, "web");

const webStages = [
  ["lockfile-lint", "lint:lockfile"],
  ["licence allowlist", "license:check"],
  ["ESLint", "lint"],
  ["ESLint comment policy", "lint:comments"],
  ["Prettier", "format:check"],
  ["TypeScript", "typecheck"],
  ["Vitest", "test"],
  ["knip", "knip"],
  ["markdownlint", "lint:md"],
  ["cspell", "lint:spell"],
];
const nodeProblems = [];
if (!existsSync(join(web, "package.json"))) {
  nodeProblems.push("web/package.json not found");
} else {
  const nodePin = readFileSync(join(web, ".nvmrc"), "utf8").trim();
  const npmPin = JSON.parse(readFileSync(join(web, "package.json"), "utf8")).packageManager.replace(
    /^npm@/,
    "",
  );
  if (process.version !== `v${nodePin}`) {
    nodeProblems.push(`node ${process.version} found, v${nodePin} required; ${installHint}`);
  }
  const npm = toolProblem("npm", ["--version"], /(\d+\.\d+\.\d+)/, npmPin);
  if (npm) nodeProblems.push(npm);
  if (!existsSync(join(web, "node_modules"))) {
    nodeProblems.push("web/node_modules not found; run npm ci in web/");
  }
}
report("Node and npm", nodeProblems);
for (const [name, script] of webStages) {
  if (nodeProblems.length > 0) {
    report(name, ["needs Node and npm (see above)"]);
    continue;
  }
  const r = exec("npm", ["run", "--silent", script], { cwd: web });
  report(name, r.code === 0 ? [] : [r.out]);
}

shellChecks(trackedShellFiles(root));

const psCandidates = win ? ["powershell.exe", "pwsh"] : ["pwsh"];
const ps = psCandidates.find((c) => exec(c, ["-NoProfile", "-Command", "exit 0"]).code === 0);
for (const [name, script] of [
  ["PowerShell suppression reasons", "tools/checks/ps-suppressions.ps1"],
  ["PSScriptAnalyzer", "tools/checks/pssa.ps1"],
]) {
  if (!ps) {
    report(name, [`PowerShell not found (${psCandidates.join(" or ")}); install PowerShell 7`]);
    continue;
  }
  const r = exec(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, script)], {
    cwd: root,
  });
  // The script prints its own problem lines and a final PASS or FAIL line.
  const lines = r.out.split(/\r?\n/).filter((l) => l.trim() !== "");
  const last = lines.pop() ?? "";
  const ok = r.code === 0 && last === `PASS ${name}`;
  const problems = lines.map((l) => l.replace(/^ {2}/, ""));
  if (!ok && problems.length === 0) problems.push(last || `exit ${String(r.code)}`);
  report(name, ok ? [] : problems);
}

const ec = toolProblem("ec", ["--version"], /v?(\d+\.\d+\.\d+)/, pins.ec.version);
if (ec) report("EditorConfig (editorconfig-checker)", [ec]);
else {
  const r = exec("ec", ["-no-color", ...gitFiles(root, [])], { cwd: root });
  report("EditorConfig (editorconfig-checker)", r.code === 0 ? [] : [r.out]);
}

const yl = toolProblem("yamllint", ["--version"], /yamllint (\d+\.\d+\.\d+)/, pins.yamllint.version);
if (yl) report("YAML (yamllint)", [yl]);
else {
  const files = gitFiles(root, ["*.yml", "*.yaml"]);
  const r = exec("yamllint", ["--strict", "-f", "parsable", ...files], { cwd: root });
  report("YAML (yamllint)", r.code === 0 ? [] : [r.out]);
}

process.exitCode = anyFailed() ? 1 : 0;
