// @vitest-environment node
import { join, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, link, tree } from "./fixture.js";
import { programInputs, tsconfigShapeProblems } from "./program.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const tsconfig = JSON.stringify({
  compilerOptions: {
    noEmit: true,
    strict: true,
    types: [],
    module: "preserve",
    moduleResolution: "bundler",
  },
  include: ["src"],
});
const fixture = (files, at = "") =>
  programInputs(
    join(tree({ [`${at}tsconfig.json`]: tsconfig, ...files }), at),
    {
      config: [],
    },
  ).problems;

// Suites timed at 30_000 call the real TypeScript compiler, which is cold the first time.

describe("TypeScript program inputs", () => {
  it("passes the real program, React and DOM types included", () => {
    const { problems, inputs } = programInputs(web);
    expect(problems).toEqual([]);
    const kinds = new Set(inputs.map((i) => i.kind));
    expect([...kinds].sort()).toEqual([
      "config",
      "first-party",
      "lib",
      "package",
    ]);
    const names = inputs.map((i) => i.path.split(sep).slice(-3).join("/"));
    expect(names).toContain("@types/react/index.d.ts");
    expect(names).toContain("typescript/lib/lib.dom.d.ts");
  }, 60_000);

  it("passes a fixture whose inputs stay in src", () => {
    expect(fixture({ "src/a.ts": "export const a = 1;\n" })).toEqual([]);
  });

  it("fails on a triple-slash reference to a declaration outside src", () => {
    const problems = fixture({
      "src/a.ts":
        '/// <reference path="../outside.d.ts" />\nexport const a = 1;\n',
      "outside.d.ts": "declare const leaked: number;\n",
    });
    expect(problems).toEqual([
      "program input outside the admitted set: outside.d.ts",
    ]);
  });

  it("fails on a type-only import from outside src", () => {
    const problems = fixture({
      "src/a.ts":
        'import type { X } from "../outside/t";\nexport type Y = X;\n',
      "outside/t.ts": "export type X = number;\n",
    });
    expect(problems).toEqual([
      "program input outside the admitted set: outside/t.ts",
    ]);
  });

  const typeImport = (from) => ({
    "src/a.ts": `import type { X } from "${from}";\nexport type Y = X;\n`,
  });
  const declared = "export type X = number;\n";
  const inWeb = (files) =>
    Object.fromEntries(Object.entries(files).map(([k, v]) => [`web/${k}`, v]));

  it("fails on a package folder inside src", () => {
    const problems = fixture({
      ...typeImport("x"),
      "src/node_modules/x/index.d.ts": declared,
    });
    expect(problems).toEqual([
      "program input in a package folder outside the trusted dependency root: src/node_modules/x/index.d.ts",
    ]);
  });

  it("fails on a look-alike sibling of the dependency root", () => {
    const problems = fixture({
      ...typeImport("../node_modules_evil/x/index"),
      "node_modules/.keep": "",
      "node_modules_evil/x/index.d.ts": declared,
    });
    expect(problems).toEqual([
      "program input outside the admitted set: node_modules_evil/x/index.d.ts",
    ]);
  });

  it("fails on a package folder beside web", () => {
    const problems = fixture(
      {
        ...inWeb(typeImport("x")),
        "web/node_modules/.keep": "",
        "node_modules/x/index.d.ts": declared,
      },
      "web/",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^program input outside the admitted set: .+\/node_modules\/x\/index\.d\.ts$/u,
    );
  });

  it("fails on a link inside the dependency root that leaves web", () => {
    const base = tree({
      "outside/x/index.d.ts": declared,
      "web/tsconfig.json": tsconfig,
      "web/node_modules/.keep": "",
      ...inWeb(typeImport("x")),
    });
    link(join(base, "outside", "x"), join(base, "web", "node_modules", "x"));
    const { problems } = programInputs(join(base, "web"), { config: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^program input outside the admitted set: .+\/outside\/x\/index\.d\.ts$/u,
    );
  });

  it("fails on a dependency root that is itself a link", () => {
    const base = tree({
      "elsewhere/x/index.d.ts": declared,
      "web/tsconfig.json": tsconfig,
      ...inWeb(typeImport("x")),
    });
    link(join(base, "elsewhere"), join(base, "web", "node_modules"));
    const { problems } = programInputs(join(base, "web"), { config: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^program input outside the admitted set: .+\/elsewhere\/x\/index\.d\.ts$/u,
    );
  });

  // Trust model: npm ci fills the dependency root from the integrity-hashed lockfile, so a
  // declaration planted there is tooling compromise and deliberately admitted.
  it("admits a plain declaration planted inside the trusted dependency root", () => {
    expect(
      fixture({
        ...typeImport("planted"),
        "node_modules/planted/index.d.ts": declared,
      }),
    ).toEqual([]);
  });
}, 30_000);

describe("tsconfig shape", () => {
  it("accepts the real tsconfig", () => {
    expect(tsconfigShapeProblems(join(web, "tsconfig.json"))).toEqual([]);
  });

  it("rejects extends, references, aliases and a widened include", () => {
    const base = tree({
      "tsconfig.json": JSON.stringify({
        extends: "./base.json",
        references: [{ path: "../other" }],
        compilerOptions: {
          types: ["vite/client"],
          baseUrl: ".",
          paths: { "@/*": ["../*"] },
        },
        include: ["src", "vite.config.ts", ".."],
      }),
    });
    expect(tsconfigShapeProblems(join(base, "tsconfig.json"))).toEqual([
      "tsconfig.json top-level keys are compilerOptions, extends, include, references; only compilerOptions and include are allowed",
      'tsconfig.json include must be ["src","vite.config.ts"]',
      "tsconfig.json must not set paths",
      "tsconfig.json must not set baseUrl",
    ]);
  });
}, 30_000);
