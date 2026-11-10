// Runs the browser tests under the provisioning environment, set before Playwright first loads.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { browserEnv } from "../../tools/install-browsers.mjs";
import { completenessProblems } from "./high-contrast-cycles.ts";
import { pinnedEngines } from "./pins.ts";

const repo = join(import.meta.dirname, "..", "..");
const { playwright } = JSON.parse(
  readFileSync(join(repo, "tools", "tool-pins.json"), "utf8"),
);
const browsersPath =
  process.platform === "linux"
    ? playwright.image.browsersPath
    : join(repo, playwright.windows.browsersPath);
const env = { ...process.env, ...browserEnv(browsersPath) };
try {
  pinnedEngines(env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const result = spawnSync(
  process.execPath,
  [cli, "test", ...process.argv.slice(2)],
  { cwd: join(import.meta.dirname, ".."), env, stdio: "inherit" },
);
let status = result.status ?? 1;
// A run that skipped a cycle exits clean, so the real high-contrast run must also show all six.
if (status === 0 && env["SHARPLADDER_REAL_HIGH_CONTRAST"] === "1") {
  const output =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--output="))
      ?.slice("--output=".length) ?? ".cache/playwright/results";
  const problems = completenessProblems(
    resolve(import.meta.dirname, "..", output),
  );
  for (const problem of problems) console.error(`high contrast: ${problem}`);
  if (problems.length > 0) status = 1;
}
process.exit(status);
