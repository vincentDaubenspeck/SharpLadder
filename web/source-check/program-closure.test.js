// @vitest-environment node
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, link, tree } from "./fixture.js";
import {
  equivalenceProblems,
  programInputs,
  programProblems,
  programs,
} from "./program.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const options = {
  noEmit: true,
  strict: true,
  target: "es2023",
  lib: ["es2023", "dom"],
  module: "preserve",
  moduleResolution: "bundler",
  jsx: "react-jsx",
  allowImportingTsExtensions: true,
  types: [],
};
const config = (include, extra = {}) =>
  JSON.stringify({
    compilerOptions: { ...options, ...extra },
    include,
  });
const pinned = (index, include) => ({
  ...programs[index],
  types: [],
  ...(include ? { include } : {}),
  // Fixture specs name no Vite or Playwright files, so only the tooling root is checked.
  config: [],
});
const specs = [
  pinned(0),
  pinned(1, ["browser", "content-check"]),
  pinned(2),
  pinned(3),
];
const four = {
  "tsconfig.json": config(["src"]),
  "tsconfig.browser.json": config(["browser", "content-check"]),
  "tsconfig.type-tests.json": config(["type-tests"]),
  "tsconfig.harness.json": config(["harness/content/main.tsx"]),
  "node_modules/.keep": "",
  "src/generated/content.ts": "export type ContentDoc = { type: string };\n",
  "src/generated/body.ts": "export type Body = string[];\n",
  "src/generated/witness/a.ts":
    'import type { ContentDoc } from "../content.ts";\nexport const witness = { type: "a" } satisfies ContentDoc;\n',
  "src/content/View.tsx": "export const View = (): null => null;\n",
  "browser/b.ts": "export const b = 1;\n",
  "content-check/setup.ts": "export const s = 1;\n",
  "type-tests/t.ts":
    'import type { ContentDoc } from "../src/generated/content.ts";\nexport const t = { type: "t" } satisfies ContentDoc;\n',
  "harness/content/main.tsx":
    'import { View } from "../../src/content/View.tsx";\nimport { witness } from "../../src/generated/witness/a.ts";\nexport const m = [View, witness];\n',
};
const closure = (files, list = specs, seams) =>
  programProblems(tree({ ...four, ...files }), list, seams);
const problems = (files, list) => closure(files, list).problems;

// Suites timed at 60_000 call the real TypeScript compiler, which is cold the first time.

describe("the pinned program set", () => {
  it("pins exactly four programs and passes the real tree", () => {
    expect(programs.map((p) => p.tsconfig)).toEqual([
      "tsconfig.json",
      "tsconfig.browser.json",
      "tsconfig.type-tests.json",
      "tsconfig.harness.json",
    ]);
    const { problems: found, linted } = programProblems(web);
    expect(found).toEqual([]);
    expect(linted.map((l) => l.tsconfig)).toEqual(
      programs.map((p) => p.tsconfig),
    );
    const app = linted[0].inputs;
    const generated = readdirSync(join(web, "src", "generated"), {
      recursive: true,
      withFileTypes: true,
    }).filter((e) => e.isFile());
    expect(generated.length).toBeGreaterThan(2);
    for (const entry of generated)
      expect(app.has(join(entry.parentPath, entry.name))).toBe(true);
    const shownOf = (inputs) => [...inputs].map((p) => p.split(sep).join("/"));
    expect(
      shownOf(linted[1].inputs).some((p) => /\/web\/(src|harness)\//u.test(p)),
    ).toBe(false);
    expect(shownOf(linted[2].inputs)).toContain(
      join(web, "src", "generated", "content.ts").split(sep).join("/"),
    );
  }, 60_000);

  it("passes the four fixture programs", () => {
    const { problems: found, linted } = closure({});
    expect(found).toEqual([]);
    expect(linted).toHaveLength(4);
  });

  it("refuses an unpinned config before any program is built", () => {
    // The app source would fail its input check if the app program were built.
    const result = closure({
      "tsconfig.extra.json": '{ "extends": "./missing.json" }',
      "src/a.ts": '/// <reference path="../outside.d.ts" />\nexport {};\n',
      "outside.d.ts": "declare const leaked: number;\n",
    });
    expect(result).toEqual({
      problems: ["tsconfig.extra.json: unknown TypeScript config"],
      linted: [],
    });
  });

  it("refuses a pinned config whose shape changed before building", () => {
    const result = closure({
      "tsconfig.type-tests.json": JSON.stringify({
        extends: "./tsconfig.json",
        include: ["type-tests"],
      }),
      "src/a.ts": '/// <reference path="../outside.d.ts" />\nexport {};\n',
    });
    expect(result.linted).toEqual([]);
    expect(result.problems).toContain(
      "tsconfig.type-tests.json top-level keys are extends, include; only compilerOptions and include are allowed",
    );
    expect(result.problems.join("\n")).not.toContain("outside");
  });

  it("refuses a fifth config anywhere under web outside installed packages", () => {
    expect(
      problems({
        "tsconfig.fifth.json": config(["src"]),
        "type-tests/tsconfig.json": config(["."]),
        "compiled/deep/jsconfig.json": "{}",
        "node_modules/pkg/tsconfig.json": "{}",
      }),
    ).toEqual([
      "compiled/deep/jsconfig.json: unknown TypeScript config",
      "tsconfig.fifth.json: unknown TypeScript config",
      "type-tests/tsconfig.json: unknown TypeScript config",
    ]);
  });

  it("refuses a linked folder rather than walking or skipping it", () => {
    const base = tree(four);
    const outside = tree({ "tsconfig.json": "{}" });
    link(outside, join(base, "browser", "linked"));
    expect(programProblems(base, specs).problems).toEqual([
      "browser/linked: a link is not walked for TypeScript configs",
    ]);
  });

  it("reports a folder that cannot be listed", () => {
    const readdir = (dir, opts) => {
      if (dir.endsWith("harness"))
        throw Object.assign(new Error("no"), { code: "EACCES" });
      return readdirSync(dir, opts);
    };
    expect(closure({}, specs, { readdir }).problems).toEqual([
      "harness: cannot list for TypeScript configs: EACCES",
    ]);
  });
}, 60_000);

describe("program membership", () => {
  it("fails a generated file missing from the app program", () => {
    const narrow = [
      { ...specs[0], include: ["src/content"] },
      ...specs.slice(1),
    ];
    expect(
      problems({ "tsconfig.json": config(["src/content"]) }, narrow).sort(),
    ).toEqual([
      "src/generated/body.ts: not in the tsconfig.json program",
      "src/generated/content.ts: not in the tsconfig.json program",
      "src/generated/witness/a.ts: not in the tsconfig.json program",
    ]);
  });

  for (const [group, file] of [
    ["browser tests", "browser/b.ts"],
    ["content check", "content-check/setup.ts"],
  ]) {
    for (const [what, target, reached] of [
      ["app source", "../src/content/View.tsx", "src/content/View.tsx"],
      [
        "a generated module",
        "../src/generated/body.ts",
        "src/generated/body.ts",
      ],
      [
        "a witness",
        "../src/generated/witness/a.ts",
        "src/generated/witness/a.ts",
      ],
      [
        "the harness",
        "../harness/content/main.tsx",
        "harness/content/main.tsx",
      ],
    ]) {
      it(`fails ${what} reached from the ${group} root group`, () => {
        expect(
          problems({
            [file]: `import type * as M from "${target}";\nexport type T = typeof M;\n`,
          }),
        ).toContain(`tsconfig.browser.json must not reach ${reached}`);
      });
    }
  }

  it("fails a module reached transitively through a tooling file", () => {
    expect(
      problems({
        "browser/b.ts": 'export { s } from "../content-check/setup.ts";\n',
        "content-check/setup.ts":
          'import type { Body } from "../src/generated/body.ts";\nexport const s: Body = [];\n',
      }),
    ).toEqual(["tsconfig.browser.json must not reach src/generated/body.ts"]);
  });

  it("fails a missing content-check root group", () => {
    const without = Object.fromEntries(
      Object.entries(four).filter(
        ([path]) => !path.startsWith("content-check/"),
      ),
    );
    expect(programProblems(tree(without), specs).problems).toEqual([
      "content-check: first-party root group is missing",
    ]);
  });

  it("fails an extra root file in the type-test or harness program", () => {
    const harness = {
      ...specs[3],
      include: ["harness/content/main.tsx", "harness/x.ts"],
    };
    expect(
      problems(
        {
          "tsconfig.harness.json": config(harness.include),
          "harness/x.ts": "export const x = 1;\n",
        },
        [...specs.slice(0, 3), harness],
      ),
    ).toEqual([
      "tsconfig.harness.json root files must be exactly harness/content/main.tsx",
    ]);
    const typeTests = { ...specs[2], include: ["type-tests", "extra.ts"] };
    expect(
      problems(
        {
          "tsconfig.type-tests.json": config(typeTests.include),
          "extra.ts": "export const e = 1;\n",
        },
        [specs[0], specs[1], typeTests, specs[3]],
      ),
    ).toEqual(["program input outside the admitted set: extra.ts"]);
  });

  it("fails app source other than generated types in the type-test program", () => {
    expect(
      problems({
        "type-tests/t.ts":
          'import { View } from "../src/content/View.tsx";\nexport const t = View;\n',
      }),
    ).toEqual(["program input outside the admitted set: src/content/View.tsx"]);
  });
}, 60_000);

describe("app-equivalent resolved options", () => {
  const with4 = (files) => tree({ ...four, ...files });

  it("passes configs whose text differs but whose resolved options agree", () => {
    const base = with4({
      "tsconfig.type-tests.json": JSON.stringify({
        include: ["type-tests"],
        compilerOptions: { ...options, target: "ES2023", module: "Preserve" },
      }),
    });
    expect(equivalenceProblems(base, specs[2], specs)).toEqual([]);
  });

  for (const [index, change, differing] of [
    [2, { strict: false }, "strict"],
    [3, { strict: false }, "strict"],
    [2, { types: ["node"] }, "types"],
    [3, { types: ["node"] }, "types"],
    [3, { exactOptionalPropertyTypes: true }, "exactOptionalPropertyTypes"],
  ]) {
    const name = programs[index].tsconfig;
    it(`fails ${name} with ${differing} changed`, () => {
      const base = with4({
        [name]: config(programs[index].include, change),
      });
      expect(equivalenceProblems(base, specs[index], specs)).toEqual([
        `${name} resolved options differ from tsconfig.json: ${differing}`,
      ]);
    });
  }

  it("runs the comparison inside the program check", () => {
    expect(
      problems({
        "tsconfig.harness.json": config(["harness/content/main.tsx"], {
          strict: false,
        }),
      }),
    ).toEqual([
      "tsconfig.harness.json resolved options differ from tsconfig.json: strict",
    ]);
  });
}, 60_000);

const nodeTypes = {
  "node_modules/@types/node/package.json": JSON.stringify({
    name: "@types/node",
    types: "index.d.ts",
  }),
  "node_modules/@types/node/index.d.ts":
    "declare var process: { version: string };\n",
  "node_modules/tool/package.json": JSON.stringify({
    name: "tool",
    types: "index.d.ts",
  }),
  "node_modules/tool/index.d.ts":
    '/// <reference types="node" />\nexport declare const t: number;\n',
  "node_modules/undici-types/package.json": JSON.stringify({
    name: "undici-types",
    types: "index.d.ts",
  }),
  "node_modules/undici-types/index.d.ts": "export declare class Agent {}\n",
};

describe("Node types stay out of the app, type-test and harness programs", () => {
  for (const [index, file, up] of [
    [0, "src/content/View.tsx", "../.."],
    [2, "type-tests/t.ts", ".."],
    [3, "harness/content/main.tsx", "../.."],
  ]) {
    const spec = specs[index];
    const run = (text) =>
      programInputs(tree({ ...four, ...nodeTypes, [file]: text }), spec)
        .problems;
    const label = spec.tsconfig;

    it(`passes ${label} without them`, () => {
      expect(run("export const ok = 1;\n")).toEqual([]);
    });

    it(`fails ${label} including @types/node directly`, () => {
      expect(
        run(
          `/// <reference path="${up}/node_modules/@types/node/index.d.ts" />\nexport {};\n`,
        ),
      ).toEqual([
        `${label} must not contain node_modules/@types/node/index.d.ts: installed at @types/node`,
      ]);
    });

    it(`fails ${label} including undici-types directly`, () => {
      expect(run('export type U = typeof import("undici-types");\n')).toEqual([
        `${label} must not contain node_modules/undici-types/index.d.ts: installed at undici-types`,
      ]);
    });

    it(`fails ${label} reaching them through another declaration`, () => {
      expect(
        run('import type { t } from "tool";\nexport type T = typeof t;\n'),
      ).toEqual([
        `${label} must not contain node_modules/@types/node/index.d.ts: installed at @types/node`,
      ]);
    });
  }
}, 60_000);
