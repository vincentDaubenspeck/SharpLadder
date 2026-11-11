// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, link, tree } from "./fixture.js";
import { vitestSetupProblems } from "./vitest-setup.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const besides = (at) => `${at}: a Vitest configuration besides vite.config.ts`;

describe("Vitest configuration files below web", () => {
  it("finds none in the real tree", () => {
    expect(vitestSetupProblems(web)).toEqual([]);
  });

  it("admits vite.config.ts and files that only resemble a Vitest configuration", () => {
    expect(
      vitestSetupProblems(
        tree({
          "vite.config.ts": "",
          "src/vitest-setup.ts": "",
          "src/my.vitest.config.ts": "",
          "vitest/config.ts": "",
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    "vitest.config.ts",
    "vitest.config.mjs",
    "vitest.workspace.ts",
    "vitest.workspace.json",
    "vitest.projects.json",
    "VITEST.CONFIG.JS",
  ])("refuses %s at the root and at any depth", (name) => {
    expect(vitestSetupProblems(tree({ [name]: "" }))).toEqual([besides(name)]);
    expect(
      vitestSetupProblems(tree({ [`nested/deeper/${name}`]: "", "a.ts": "" })),
    ).toEqual([besides(`nested/deeper/${name}`)]);
  });

  it("reports every such file, in order", () => {
    expect(
      vitestSetupProblems(
        tree({ "b/vitest.config.ts": "", "a/vitest.workspace.ts": "" }),
      ),
    ).toEqual([
      besides("a/vitest.workspace.ts"),
      besides("b/vitest.config.ts"),
    ]);
  });

  it("refuses a folder named like a configuration without walking past it", () => {
    expect(
      vitestSetupProblems(tree({ "vitest.config.d/inner.ts": "" })),
    ).toEqual([besides("vitest.config.d")]);
  });

  it("skips installed packages only", () => {
    expect(
      vitestSetupProblems(
        tree({
          "node_modules/pkg/vitest.config.ts": "",
          "src/node_modules/pkg/vitest.config.ts": "",
          ".cache/vitest.config.ts": "",
        }),
      ),
    ).toEqual([besides(".cache/vitest.config.ts")]);
  });

  it("refuses a linked folder instead of walking or skipping it", () => {
    const outside = tree({ "vitest.config.ts": "" });
    const base = tree({ "src/a.ts": "" });
    link(outside, join(base, "linked"));
    expect(vitestSetupProblems(base)).toEqual([
      "linked: a link is not walked for Vitest configurations",
    ]);
  });

  it("fails when a folder cannot be listed", () => {
    const base = tree({ "src/a.ts": "" });
    const failing = (path, options) => {
      if (path.endsWith("src"))
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      return readdirSync(path, options);
    };
    expect(vitestSetupProblems(base, failing)).toEqual([
      "src: cannot list for Vitest configurations: EACCES",
    ]);
  });
});
