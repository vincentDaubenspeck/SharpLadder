// @vitest-environment node
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eslintCoverage, stylelintCoverage } from "./coverage.js";
import { cleanUp, tree } from "./fixture.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");

// Loads the real eslint config with typescript-eslint; the first load is cold.
describe("ESLint coverage with the real config", () => {
  it("covers src scripts with the type-aware configuration", async () => {
    const files = ["src/App.tsx", "src/test-setup.ts", "src/deep/new.ts"].map(
      (f) => join(web, f),
    );
    expect(await eslintCoverage(web, files)).toEqual([]);
  });

  it("reports ignored, unmatched and untyped files", async () => {
    const files = [
      join(web, "dist", "a.ts"),
      join(web, "src", "x.vue"),
      join(web, "src", "a.js"),
    ];
    expect(await eslintCoverage(web, files)).toEqual([
      "dist/a.ts: ignored by ESLint or matched by no configuration",
      "src/x.vue: ignored by ESLint or matched by no configuration",
      "src/a.js: not under the type-aware ESLint configuration",
    ]);
  });

  it("lints each program's files through that program's config only", async () => {
    const browser = {
      projectService: false,
      project: "./tsconfig.browser.json",
    };
    const tests = [
      "playwright.config.ts",
      "vite.config.ts",
      "browser/new.pw.ts",
    ].map((f) => join(web, f));
    expect(await eslintCoverage(web, tests, browser)).toEqual([]);
    expect(await eslintCoverage(web, tests)).toEqual([
      "playwright.config.ts: not under the type-aware ESLint configuration",
      "vite.config.ts: not under the type-aware ESLint configuration",
      "browser/new.pw.ts: not under the type-aware ESLint configuration",
    ]);
    expect(
      await eslintCoverage(web, [join(web, "src", "App.tsx")], browser),
    ).toEqual(["src/App.tsx: not under the type-aware ESLint configuration"]);
  });
}, 30_000);

describe("Stylelint coverage", () => {
  it("matches the Stylelint stage's own file set", () => {
    const base = tree({ "src/a.css": "", "src/m/b.module.css": "" });
    const src = join(base, "src");
    const files = [join(src, "a.css"), join(src, "m", "b.module.css")];
    expect(stylelintCoverage(base, src, files)).toEqual([]);
    expect(stylelintCoverage(base, src, files.slice(0, 1))).toEqual([
      "src/m/b.module.css: linted by Stylelint but not admitted",
    ]);
    expect(
      stylelintCoverage(base, src, [...files, join(src, "c.css")]),
    ).toEqual(["src/c.css: not in the Stylelint file set"]);
  });
});
