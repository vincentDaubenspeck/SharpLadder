// @vitest-environment node
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { browserTreeProblems } from "./browser-tree.js";
import { cleanUp, link, tree } from "./fixture.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const lint = 'export default [{ files: ["**/*.{js,mjs}"] }];\n';
const files = {
  "eslint.config.js": lint,
  "playwright.config.ts": "export {};\n",
  "browser/a.ts": "export {};\n",
  "browser/observed.mjs": "export {};\n",
  "browser/run.mjs": "export {};\n",
  "browser/serve.mjs": "export {};\n",
  "browser/specimen.mjs": "export {};\n",
  "browser/specimen.test.js": "export {};\n",
  "browser/font-baselines.json": "{}\n",
};
const problems = (extra = {}, options = {}) =>
  browserTreeProblems(tree({ ...files, ...extra }), options);

// Suites timed at 30_000 load ESLint configurations, which is slow the first time.

describe("browser tree inventory", () => {
  it("passes the real tree", async () => {
    expect(await browserTreeProblems(web)).toEqual([]);
  });

  it("passes the exact fixture inventory", async () => {
    expect(await problems()).toEqual([]);
  });

  it("fails an unimported script whose lint is ignored", async () => {
    expect(
      await problems({
        "eslint.config.js": `export default [{ ignores: ["browser/run.mjs"] }, { files: ["**/*.{js,mjs}"] }];\n`,
      }),
    ).toEqual([
      "browser/run.mjs: ignored by ESLint or matched by no configuration",
    ]);
  });

  it.each([".mts", ".cts", ".cjs", ".jsx", ".tsx"])(
    "refuses a %s file",
    async (suffix) => {
      expect(
        await problems({ [`browser/x${suffix}`]: "export {};\n" }),
      ).toEqual([
        `browser/x${suffix}: ${suffix} is not admitted under browser`,
      ]);
    },
  );

  it("admits a named declaration only as a browser program input", async () => {
    const inventory = {
      tooling: [
        "observed.mjs",
        "run.mjs",
        "serve.mjs",
        "specimen.mjs",
        "specimen.test.js",
      ],
      declarations: ["named.d.ts"],
      assets: ["font-baselines.json"],
    };
    const extra = { "browser/named.d.ts": "export {};\n" };
    expect(await problems(extra, { inventory })).toEqual([]);
    expect(await problems({}, { inventory })).toEqual([
      "browser/named.d.ts: listed but missing",
    ]);
    expect(await problems(extra, { inventory, inputs: new Set() })).toEqual([
      "browser/a.ts: not an input of the browser program",
      "browser/named.d.ts: not an input of the browser program",
      "playwright.config.ts: not an input of the browser program",
    ]);
  });

  it("fails an unnamed declaration file", async () => {
    expect(
      await problems({ "browser/extra.d.ts": "declare const x: number;\n" }),
    ).toEqual([
      "browser/extra.d.ts: declaration file is not on the named list",
    ]);
  });

  it("fails an unlisted script", async () => {
    expect(await problems({ "browser/extra.mjs": "export {};\n" })).toEqual([
      "browser/extra.mjs: script is not on the named tooling list",
    ]);
  });

  it("fails an unlisted asset", async () => {
    expect(await problems({ "browser/notes.json": "{}\n" })).toEqual([
      "browser/notes.json: not on the browser inventory",
    ]);
  });

  it("fails a listed entry that is missing", async () => {
    const base = tree(files);
    rmSync(join(base, "browser", "font-baselines.json"));
    expect(await browserTreeProblems(base)).toEqual([
      "browser/font-baselines.json: listed but missing",
    ]);
  });

  it("fails a linked entry", async () => {
    const base = tree({ ...files, "outside/x.ts": "export {};\n" });
    link(join(base, "outside"), join(base, "browser", "linked"));
    expect(await browserTreeProblems(base)).toEqual([
      "browser/linked: symlink or junction",
    ]);
  });

  it("classifies nested entries by their path under browser", async () => {
    const base = tree({ ...files, "browser/deep/x.ts": "export {};\n" });
    mkdirSync(join(base, "browser", "empty"));
    expect(await browserTreeProblems(base)).toEqual([]);
    expect(
      await browserTreeProblems(tree({ ...files, "browser/deep/y.txt": "" })),
    ).toEqual(["browser/deep/y.txt: not on the browser inventory"]);
  });

  it("fails a TypeScript file outside the browser program", async () => {
    expect(await problems({}, { inputs: new Set() })).toEqual([
      "browser/a.ts: not an input of the browser program",
      "playwright.config.ts: not an input of the browser program",
    ]);
  });

  it("reports a failing discovery", async () => {
    const readdir = (dir, options) => {
      if (dir.endsWith("browser"))
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      return readdirSync(dir, options);
    };
    expect(await problems({}, { readdir })).toEqual([
      "browser tree discovery failed: cannot read browser: EPERM",
    ]);
  });
}, 30_000);
