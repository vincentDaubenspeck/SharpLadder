// @vitest-environment node
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, link, tree } from "./fixture.js";
import {
  programInputs,
  programProblems,
  programs,
  tsconfigShapeProblems,
} from "./program.js";

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
const app = {
  tsconfig: "tsconfig.json",
  include: ["src"],
  types: [],
  root: "src",
  config: [],
  parser: { projectService: true },
};
const fixture = (files, at = "") =>
  programInputs(
    join(tree({ [`${at}tsconfig.json`]: tsconfig, ...files }), at),
    app,
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
    const { problems } = programInputs(join(base, "web"), app);
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
    const { problems } = programInputs(join(base, "web"), app);
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

const browserConfig = JSON.stringify({
  compilerOptions: JSON.parse(tsconfig).compilerOptions,
  include: ["browser"],
});
const browser = {
  tsconfig: "tsconfig.browser.json",
  include: ["browser"],
  types: [],
  root: "browser",
  config: ["browser/named.d.mts"],
  parser: { projectService: false, project: "./tsconfig.browser.json" },
};
const both = {
  "tsconfig.json": tsconfig,
  "tsconfig.browser.json": browserConfig,
  "src/a.ts": "export const a = 1;\n",
  "browser/b.ts": "export const b = 1;\n",
};
const twoPrograms = (files) =>
  programProblems(tree({ ...both, ...files }), [app, browser]).problems;

describe("app and browser programs", () => {
  it("passes the real programs, each with its own first-party root", () => {
    const { problems, linted } = programProblems(web);
    expect(problems).toEqual([]);
    const [own] = linted.slice(1);
    const names = own.files.map((f) => f.split(sep).slice(-2).join("/"));
    expect(names).toContain("web/playwright.config.ts");
    expect(names).toContain("browser/tokens.pw.ts");
    expect(names.every((n) => !n.startsWith("src/"))).toBe(true);
  }, 60_000);

  it("passes two exact fixture programs", () => {
    expect(twoPrograms({})).toEqual([]);
  });

  it("fails a browser file added to the app include before building it", () => {
    expect(
      twoPrograms({
        "tsconfig.json": JSON.stringify({
          ...JSON.parse(tsconfig),
          include: ["src", "browser"],
        }),
      }),
    ).toEqual(['tsconfig.json include must be ["src"]']);
  });

  it("fails an app file pulled into the browser program", () => {
    expect(
      twoPrograms({
        "browser/b.ts": 'import { a } from "../src/a";\nexport const b = a;\n',
      }),
    ).toEqual(["program input outside the admitted set: src/a.ts"]);
  });

  it("fails an input outside both sets", () => {
    expect(
      twoPrograms({
        "browser/b.ts":
          '/// <reference path="../outside.d.ts" />\nexport const b = 1;\n',
        "outside.d.ts": "declare const leaked: number;\n",
      }),
    ).toEqual(["program input outside the admitted set: outside.d.ts"]);
  });

  it("admits a named declaration and fails an unnamed one", () => {
    expect(
      twoPrograms({
        "browser/b.ts":
          'import { n } from "./named.mjs";\nimport { u } from "./unnamed.mjs";\nexport const b = n + u;\n',
        "browser/named.d.mts": "export declare const n: number;\n",
        "browser/unnamed.d.mts": "export declare const u: number;\n",
      }),
    ).toEqual([
      "program input outside the admitted set: browser/unnamed.d.mts",
    ]);
  });

  it("fails a missing browser config", () => {
    const base = tree({
      "tsconfig.json": tsconfig,
      "src/a.ts": "",
      "browser/b.ts": "",
    });
    expect(programProblems(base, [app, browser]).problems).toEqual([
      "tsconfig.browser.json: missing",
    ]);
  });

  it("fails a browser file pulled into the app program", () => {
    expect(
      twoPrograms({
        "src/a.ts": 'import { b } from "../browser/b";\nexport const a = b;\n',
      }),
    ).toEqual(["program input outside the admitted set: browser/b.ts"]);
  });

  it("refuses a .tsx file in the browser program", () => {
    expect(
      twoPrograms({
        "browser/b.ts": 'import { c } from "./c";\nexport const b = c;\n',
        "browser/c.tsx": "export const c = 1;\n",
      }),
    ).toEqual(["program input outside the admitted set: browser/c.tsx"]);
  });

  it("reports a config discovery read error", () => {
    const readdir = (dir, options) => {
      if (dir.endsWith("browser"))
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      return readdirSync(dir, options);
    };
    const base = tree(both);
    expect(programProblems(base, [app, browser], { readdir }).problems).toEqual(
      ["browser: cannot list for TypeScript configs: EPERM"],
    );
  });

  it("fails an altered browser include before building it", () => {
    expect(
      twoPrograms({
        "tsconfig.browser.json": JSON.stringify({
          ...JSON.parse(browserConfig),
          include: ["browser", "src"],
        }),
      }),
    ).toEqual(['tsconfig.browser.json include must be ["browser"]']);
  });

  it("fails an unknown third config, beside web or inside a root", () => {
    expect(
      twoPrograms({
        "tsconfig.other.json": tsconfig,
        "browser/tsconfig.json": tsconfig,
      }),
    ).toEqual([
      "browser/tsconfig.json: unknown TypeScript config",
      "tsconfig.other.json: unknown TypeScript config",
    ]);
  });
}, 30_000);

describe("tsconfig shape", () => {
  it("accepts the real configs", () => {
    for (const spec of programs)
      expect(tsconfigShapeProblems(join(web, spec.tsconfig), spec)).toEqual([]);
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
      'tsconfig.json include must be ["src"]',
      "tsconfig.json must not set paths",
      "tsconfig.json must not set baseUrl",
    ]);
  });
}, 30_000);
