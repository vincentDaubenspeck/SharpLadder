// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, link, tree } from "./fixture.js";
import { sourceTreeProblems } from "./index.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const tsconfig = JSON.stringify({
  compilerOptions: { types: ["vite/client"] },
  include: ["src", "vite.config.ts"],
});

describe("source tree stage", () => {
  it("passes the real tree", async () => {
    expect(await sourceTreeProblems(web)).toEqual([]);
  }, 60_000);

  it("fails a fixture tree on every bad entry, nested and linked", async () => {
    const base = tree({
      "tsconfig.json": tsconfig,
      "vite.config.ts": "export {};\n",
      "src/App.tsx": "export {};\n",
      "src/Untested.JS": "",
      "src/nested/x.vue": "",
      "outside/t.ts": "",
    });
    link(join(base, "outside"), join(base, "src", "linked"));
    const problems = await sourceTreeProblems(base);
    expect(problems).toContain("src/Untested.JS: extension is not admitted");
    expect(problems).toContain("src/nested/x.vue: extension is not admitted");
    expect(problems).toContain("src/linked: symlink or junction");
  }, 60_000);

  it("fails when a directory cannot be read", async () => {
    const base = tree({
      "tsconfig.json": tsconfig,
      "src/locked/a.ts": "export {};\n",
    });
    const readdir = (dir, options) => {
      if (dir.endsWith("locked"))
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      return readdirSync(dir, options);
    };
    const problems = await sourceTreeProblems(base, { readdir });
    expect(problems[0]).toBe(
      "source tree discovery failed: cannot read src/locked: EPERM",
    );
  }, 60_000);
});
