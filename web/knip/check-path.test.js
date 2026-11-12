// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const config = join(web, "knip.config.js");
const checks = join(web, "..", "tools", "checks");
const lib = pathToFileURL(join(checks, "lib.mjs")).href;
const stages = pathToFileURL(join(checks, "web.mjs")).href;

// The child shares the stage runner and exit-code setter of tools/checks/run.mjs,
// so its exit code is the one check.sh reads.
const stage = `
import { setExitCode } from ${JSON.stringify(lib)};
import { runWebStage, webStages } from ${JSON.stringify(stages)};
const [web, config, dir] = process.argv.slice(1);
const knip = webStages.find(([name]) => name === "knip");
const extra = ["--config", config, "--directory", dir, "--no-progress"];
const r = runWebStage(web, knip, extra);
console.error(\`knip exit \${String(r.code)}\`);
setExitCode();
`;

const runStage = (css) => {
  const root = mkdtempSync(join(tmpdir(), "sl-knip-check-"));
  const files = {
    "package.json": '{ "name": "fixture", "private": true, "type": "module" }',
    "src/Card.test.js": [
      'import styles from "./Card.module.css";',
      "console.log(styles.title, styles.body);",
    ].join("\n"),
    "src/Card.module.css": css,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${text}\n`);
  }
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", stage, web, config, root],
    {
      encoding: "utf8",
      env: { ...process.env, JITI_FS_CACHE: "true" },
      timeout: 30_000,
    },
  );
  // The test timer cannot interrupt spawnSync, so a hung knip is killed here.
  if (r.error) throw r.error;
  if (r.signal) throw new Error(`knip was killed by ${r.signal}.`);
  return r;
};

// Each case spawns the real knip stage; the first spawn loads it cold.
describe("knip stage with the production config", () => {
  it("fails the check run on an unread CSS module class", () => {
    const r = runStage(".title {} .body {} .unread { color: blue }");
    expect(r.stderr).toContain("knip exit 1");
    expect(r.stdout).toMatch(/unread\s+Locals\s+src\/Card\.module\.css/);
    expect(r.stdout).toMatch(/^FAIL knip$/m);
    expect(r.status).toBe(1);
    // The child inherits JITI_FS_CACHE=true, which the stage must override.
    expect(existsSync(join(web, "node_modules", ".cache"))).toBe(false);
  }, 60_000);

  it("passes the check run when every class is read", () => {
    const r = runStage(".title { color: red } .body { color: blue }");
    expect(r.stderr).toContain("knip exit 0");
    expect(r.stdout).toMatch(/^PASS knip$/m);
    expect(r.status).toBe(0);
  }, 60_000);
}, 30_000);

// Every stage runs in a fixture whose script only prints the CI and jiti cache values it gets.
const envStages = `
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runWebStage, webStages } from ${JSON.stringify(stages)};
const [dir] = process.argv.slice(1);
const probe = "console.log(JSON.stringify([process.env.CI, process.env.JITI_FS_CACHE]));";
const scripts = {};
for (const [, script] of webStages) {
  const file = Array.isArray(script) ? script[0] : "probe.js";
  if (!Array.isArray(script)) scripts[script] = "node probe.js";
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), probe);
}
writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, scripts }));
const seen = webStages.map((step) => [step[0], runWebStage(dir, step).out.trim()]);
console.error(JSON.stringify(seen));
`;

describe("check run stage environments", () => {
  it("gives CI=true to the Vitest stage alone", () => {
    const root = mkdtempSync(join(tmpdir(), "sl-stage-env-"));
    // Sentinels, so an unchanged stage shows the parent's value even when the suite runs under CI.
    const parent = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !["CI", "JITI_FS_CACHE"].includes(k.toUpperCase()),
      ),
    );
    try {
      const r = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", envStages, root],
        {
          encoding: "utf8",
          env: { ...parent, CI: "parent", JITI_FS_CACHE: "parent" },
          timeout: 90_000,
        },
      );
      if (r.error) throw r.error;
      if (r.signal) throw new Error(`the stages were killed by ${r.signal}.`);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toMatch(/^FAIL /m);
      const seen = Object.fromEntries(
        JSON.parse(r.stderr.trim().split("\n").at(-1)),
      );
      const want = Object.fromEntries(
        Object.keys(seen).map((name) => [name, '["parent","parent"]']),
      );
      want["Vitest"] = '["true","parent"]';
      want["knip"] = '["parent","false"]';
      expect(seen).toEqual(want);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
