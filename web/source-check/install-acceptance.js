// The real-tree install-health acceptance, run as its own serial stage so no Vite load or
// other install writer is active while the real web tree is read.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHealth } from "./install-health.js";
import { bypassEnv, bypassRc } from "./npm-bypass.js";

const web = join(import.meta.dirname, "..");
const stage = join(import.meta.dirname, "install-health.js");
const failures = [];

const { problems, excused } = await installHealth(web);
for (const problem of problems) failures.push(`real web tree: ${problem}`);
if (process.platform === "win32" && excused.size !== 66)
  failures.push(
    `real web tree: ${String(excused.size)} platform skips excused on Windows, 66 expected`,
  );

const base = mkdtempSync(join(tmpdir(), "install-acceptance-"));
try {
  const rc = join(base, "bypass-user-rc");
  writeFileSync(rc, bypassRc);
  const r = spawnSync(process.execPath, [stage], {
    env: { ...process.env, ...bypassEnv, npm_config_userconfig: rc },
    encoding: "utf8",
  });
  if (r.status !== 0 || !/excused total: \d+/u.test(r.stdout))
    failures.push(
      `stage with every bypass setting: exit ${String(r.status)}\n${r.stdout}${r.stderr}`,
    );
} finally {
  rmSync(base, { recursive: true, force: true });
}

for (const failure of failures) console.log(failure);
console.log(
  failures.length === 0
    ? "real web tree and bypass-setting stage pass"
    : `${String(failures.length)} install acceptance failures`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
