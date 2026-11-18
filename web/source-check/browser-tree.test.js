// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, fixture, link } from "../build-guard/fixture.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const sources = (dir, at = "") =>
  readdirSync(join(web, dir, at), { withFileTypes: true }).flatMap((entry) => {
    const path = at === "" ? entry.name : `${at}/${entry.name}`;
    if (entry.isDirectory()) return sources(dir, path);
    return entry.name.includes(".test.")
      ? []
      : [[`${dir}/${path}`, readFileSync(join(web, dir, path))]];
  });
// The lint policy and all it loads, so the copy's own factory binds the copy's web root and the
// production configuration, which a fixture can change only by editing the copy.
const policy = Object.fromEntries([
  ...["eslint.config.js", "eslint.comments.config.js", "package.json"].map(
    (p) => [p, readFileSync(join(web, p))],
  ),
  [
    "../tools/forbidden-phrases.txt",
    readFileSync(join(web, "..", "tools", "forbidden-phrases.txt")),
  ],
  ...["eslint-rules", "source-check", "source-policy", "stylelint"].flatMap(
    (dir) => sources(dir),
  ),
]);
// Runs the copy's browser-tree check in its own process, as the source check runs it; the
// options a child cannot receive as values are rebuilt from plain data.
const runner = `import { readdirSync } from "node:fs";
import { join } from "node:path";
import { browserTreeProblems } from "./browser-tree.js";

const { inventory, inputs, denied } = JSON.parse(process.argv[2]);
const options = {};
if (inventory) options.inventory = inventory;
if (inputs) options.inputs = new Set(inputs);
if (denied)
  options.readdir = (dir, how) => {
    if (dir.endsWith(denied))
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    return readdirSync(dir, how);
  };
const web = join(import.meta.dirname, "..");
console.log(JSON.stringify(await browserTreeProblems(web, options)));
`;
const files = {
  "playwright.config.ts": "export {};\n",
  "browser/a.ts": "export {};\n",
  "browser/harness.mjs": "export {};\n",
  "browser/harness.test.js": "export {};\n",
  "browser/observed.mjs": "export {};\n",
  "browser/run.mjs": "export {};\n",
  "browser/serve.mjs": "export {};\n",
  "browser/specimen.mjs": "export {};\n",
  "browser/specimen.test.js": "export {};\n",
  "browser/font-baselines.json": "{}\n",
};

function copied(extra = {}) {
  return fixture(
    {
      ...policy,
      ...files,
      ...extra,
      "source-check/tree-runner.mjs": runner,
    },
    { tokens: false, helpers: false },
  );
}

function judged(root, spec = {}) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const run = spawnSync(
    process.execPath,
    [join(root, "source-check", "tree-runner.mjs"), JSON.stringify(spec)],
    { cwd: root, encoding: "utf8", env, timeout: 60_000 },
  );
  expect([run.status, run.stderr]).toEqual([0, ""]);
  return JSON.parse(run.stdout);
}

const problems = (extra, spec) => judged(copied(extra).root, spec);

// Each case starts a child that loads the production configuration cold.

describe("browser tree inventory", () => {
  it("passes the exact fixture inventory", () => {
    const { root } = copied({ "browser/named.d.ts": "export {};\n" });
    const inventory = {
      tooling: [
        "harness.mjs",
        "harness.test.js",
        "observed.mjs",
        "run.mjs",
        "serve.mjs",
        "specimen.mjs",
        "specimen.test.js",
      ],
      declarations: ["named.d.ts"],
      assets: ["font-baselines.json"],
    };
    const inputs = [
      "browser/a.ts",
      "browser/named.d.ts",
      "playwright.config.ts",
    ].map((path) => join(root, path));
    expect(judged(root, { inventory, inputs })).toEqual([]);
  });

  it("fails an unimported script the production configuration ignores", () => {
    const at = 'globalIgnores(["dist", "coverage", ".cache"])';
    const config = String(policy["eslint.config.js"]);
    expect(config.split(at)).toHaveLength(2);
    const ignoring = config.replace(
      at,
      'globalIgnores(["dist", "coverage", ".cache", "browser/run.mjs"])',
    );
    expect(problems({ "eslint.config.js": ignoring })).toEqual([
      "browser/run.mjs: ignored by ESLint or matched by no configuration",
    ]);
  });

  it.each([".tsx"])("refuses a %s file", (suffix) => {
    expect(problems({ [`browser/x${suffix}`]: "export {};\n" })).toEqual([
      `browser/x${suffix}: ${suffix} is not admitted under browser`,
    ]);
  });

  it("fails an unnamed declaration file", () => {
    expect(
      problems({ "browser/extra.d.ts": "declare const x: number;\n" }),
    ).toEqual([
      "browser/extra.d.ts: declaration file is not on the named list",
    ]);
  });

  it("fails an unlisted script", () => {
    expect(problems({ "browser/extra.mjs": "export {};\n" })).toEqual([
      "browser/extra.mjs: script is not on the named tooling list",
    ]);
  });

  it("fails an unlisted asset", () => {
    expect(problems({ "browser/notes.json": "{}\n" })).toEqual([
      "browser/notes.json: not on the browser inventory",
    ]);
  });

  it("fails a listed entry that is missing", () => {
    const { root } = copied();
    rmSync(join(root, "browser", "font-baselines.json"));
    expect(judged(root)).toEqual([
      "browser/font-baselines.json: listed but missing",
    ]);
  });

  it("fails a linked entry", () => {
    const { base, root } = copied();
    mkdirSync(join(base, "outside"));
    link(join(base, "outside"), join(root, "browser", "linked"));
    expect(judged(root)).toEqual(["browser/linked: symlink or junction"]);
  });

  it("fails a TypeScript file outside the browser program", () => {
    expect(problems({}, { inputs: [] })).toEqual([
      "browser/a.ts: not an input of the browser program",
      "playwright.config.ts: not an input of the browser program",
    ]);
  });

  it("reports a failing discovery", () => {
    expect(problems({}, { denied: "browser" })).toEqual([
      "browser tree discovery failed: cannot read browser: EPERM",
    ]);
  });
}, 60_000);
