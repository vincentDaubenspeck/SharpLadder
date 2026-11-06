// Licence expressions are judged by licensee alone, so no hand-written parser can disagree with it.
// Usage: node license-check.js   (from the package root, where licensee reads .licensee.json)
// Exceptions are the "packages" map (name to exact version); "reasons" is keyed name@version,
// and licensee ignores that key, so its config and the reasons stay in one file.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const problems = [];
const licensee = fileURLToPath(import.meta.resolve("licensee/licensee"));
const run = spawnSync(process.execPath, [licensee, "--errors-only"], {
  stdio: "inherit",
});
if (run.status !== 0)
  problems.push(`licensee rejected the tree (exit ${String(run.status)})`);

const config = JSON.parse(readFileSync(".licensee.json", "utf8"));
const packages = config.packages ?? {};
const reasons = config.reasons ?? {};
// An exact version keeps an exception from covering a later release unreviewed.
const exact = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
for (const [name, version] of Object.entries(packages)) {
  const key = `${name}@${version}`;
  if (!exact.test(version))
    problems.push(`${key}: exception version must be exact`);
  const reason = reasons[key];
  if (
    typeof reason !== "string" ||
    reason.trim() === "" ||
    /[\r\n]/.test(reason)
  ) {
    problems.push(`${key}: exception needs a one-line reason in "reasons"`);
  }
}
for (const key of Object.keys(reasons)) {
  const at = key.lastIndexOf("@");
  if (at <= 0 || packages[key.slice(0, at)] !== key.slice(at + 1)) {
    problems.push(`${key}: reason has no matching exception in "packages"`);
  }
}
for (const p of problems) console.log(p);
process.exitCode = problems.length === 0 ? 0 : 1;
