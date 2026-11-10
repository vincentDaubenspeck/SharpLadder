// @vitest-environment node
import { execFileSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, link, tree } from "./fixture.js";
import { programInputs, programProblems, programs } from "./program.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const windows = process.platform === "win32";
const options = {
  noEmit: true,
  strict: true,
  target: "es2023",
  lib: ["es2023", "dom"],
  module: "preserve",
  moduleResolution: "bundler",
};
const appConfig = (types = [], include = ["src"]) =>
  JSON.stringify({ compilerOptions: { ...options, types }, include });
const app = {
  tsconfig: "tsconfig.json",
  include: ["src"],
  types: [],
  root: "src",
  config: [],
  forbiddenPackages: programs[0].forbiddenPackages,
  parser: { projectService: true },
};

const under = (prefix, files) =>
  Object.fromEntries(
    Object.entries(files).map(([path, text]) => [`${prefix}/${path}`, text]),
  );
const nodeTypes = (name = "@types/node", extra = {}) => ({
  "package.json": JSON.stringify({ name, types: "index.d.ts", ...extra }),
  "index.d.ts":
    '/// <reference path="globals.d.ts" />\n/// <reference path="fs.d.ts" />\n',
  "globals.d.ts": "declare var process: { version: string };\n",
  "fs.d.ts":
    'declare module "fs" {\n  export const sep: string;\n}\ndeclare module "node:fs" {\n  export * from "fs";\n}\n',
});
const installed = {
  ...under("node_modules/@types/node", nodeTypes()),
  ...under("node_modules/undici-types", {
    "package.json": JSON.stringify({
      name: "undici-types",
      types: "index.d.ts",
    }),
    "index.d.ts": "export declare class Agent {}\n",
  }),
  ...under("node_modules/tool", {
    "package.json": JSON.stringify({ name: "tool", types: "index.d.ts" }),
    "index.d.ts":
      '/// <reference types="node" />\nexport declare const t: number;\n',
  }),
};
const fixture = (files, config = appConfig()) =>
  tree({ "tsconfig.json": config, ...installed, ...files });
const run = (base, extra) => programInputs(base, app, extra).problems;
const boundary = (problems) =>
  problems.filter((p) => p.startsWith("tsconfig.json must not contain "));
const at = (path, reason) =>
  `tsconfig.json must not contain ${path}: ${reason}`;
const nodeAt = (file) =>
  at(`node_modules/@types/node/${file}`, "installed at @types/node");

// Suites timed at 60_000 call the real TypeScript compiler, which is cold the first time.

describe("the installed graph splits at the Node types boundary", () => {
  it("keeps every Node types file out of the app program", () => {
    const { problems, inputs } = programInputs(web, programs[0]);
    expect(problems).toEqual([]);
    const node = inputs.filter((i) =>
      /[\\/]node_modules[\\/](?:@types[\\/]node|undici-types)[\\/]/iu.test(
        i.path,
      ),
    );
    expect(node).toEqual([]);
    expect(inputs.some((i) => i.path.endsWith(`${sep}vite.config.ts`))).toBe(
      false,
    );
  }, 60_000);

  it("compiles the tooling program with library checking on", () => {
    const { problems, inputs } = programInputs(web, programs[1]);
    expect(problems).toEqual([]);
    const paths = inputs.map((i) => i.path.split(sep).join("/"));
    expect(paths.some((p) => p.includes("/@types/node/"))).toBe(true);
    expect(paths.some((p) => p.includes("/undici-types/"))).toBe(true);
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(web, "tsconfig.browser.json"),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    );
    expect(parsed.options.skipLibCheck).toBeUndefined();
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    expect(ts.getPreEmitDiagnostics(program).map((d) => d.code)).toEqual([]);
  }, 60_000);

  it("type-checks and lints the Vite config in the tooling program", () => {
    const { problems, linted } = programProblems(web);
    expect(problems).toEqual([]);
    const tooling = linted.find((l) => l.tsconfig === "tsconfig.browser.json");
    expect(tooling.files).toContain(join(web, "vite.config.ts"));
    expect(tooling.parser).toEqual(programs[1].parser);
  }, 60_000);

  it("keeps the app canary: process and Buffer are unknown names", () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(web, "tsconfig.json"),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    );
    const canary = join(web, "src", "canary.ts").split(sep).join("/");
    const host = ts.createCompilerHost(parsed.options);
    const read = host.getSourceFile.bind(host);
    const exists = host.fileExists.bind(host);
    host.fileExists = (name) => name === canary || exists(name);
    host.getSourceFile = (name, language, ...rest) =>
      name === canary
        ? ts.createSourceFile(
            name,
            'export const c = [process.version, Buffer.byteLength("x")];\n',
            language,
          )
        : read(name, language, ...rest);
    const program = ts.createProgram({
      rootNames: [...parsed.fileNames, canary],
      options: parsed.options,
      host,
    });
    const codes = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === canary)
      .map((d) => d.code);
    expect(codes).toEqual([2591, 2591]);
  }, 60_000);
});

describe("the app program refuses Node types by any route", () => {
  it("passes a fixture that never reaches them", () => {
    expect(run(fixture({ "src/a.ts": "export const a = 1;\n" }))).toEqual([]);
  });

  it("fails an explicit types entry", () => {
    const base = fixture({ "src/a.ts": "export {};\n" }, appConfig(["node"]));
    expect(boundary(run(base))).toContain(nodeAt("index.d.ts"));
  });

  it("fails a reference path straight into the package", () => {
    const base = fixture({
      "src/a.ts":
        '/// <reference path="../node_modules/@types/node/globals.d.ts" />\nexport {};\n',
    });
    expect(boundary(run(base))).toEqual([nodeAt("globals.d.ts")]);
  });

  it("fails a relative import of a Node declaration file", () => {
    const base = fixture({
      "src/a.ts":
        'import type * as F from "../node_modules/@types/node/globals";\nexport type G = typeof F;\n',
    });
    expect(boundary(run(base))).toEqual([nodeAt("globals.d.ts")]);
  });

  it("fails type queries that reach the package", () => {
    const base = fixture({
      ...under("node_modules/fs", nodeTypes()),
      "src/a.ts":
        'export type F = typeof import("fs");\nexport type U = typeof import("undici-types");\nexport type N = typeof import("node:fs");\n',
      "src/b.ts": '/// <reference types="node" />\nexport {};\n',
    });
    const found = boundary(run(base));
    expect(found).toContain(
      at("node_modules/fs/index.d.ts", "inside a package named @types/node"),
    );
    expect(found).toContain(
      at("node_modules/undici-types/index.d.ts", "installed at undici-types"),
    );
    expect(found).toContain(nodeAt("fs.d.ts"));
  });

  it("fails a transitive dependency that loads them", () => {
    const base = fixture({
      "src/a.ts": 'import type { t } from "tool";\nexport type T = typeof t;\n',
    });
    expect(boundary(run(base)).sort()).toEqual([
      nodeAt("fs.d.ts"),
      nodeAt("globals.d.ts"),
      nodeAt("index.d.ts"),
    ]);
  });

  it("fails an alias folder reached through package exports", () => {
    const base = fixture({
      ...under(
        "node_modules/router",
        nodeTypes("@types/node", {
          exports: { "./fs": { types: "./fs.d.ts" } },
        }),
      ),
      "src/a.ts": 'import type * as F from "router/fs";\nexport type G = F;\n',
    });
    expect(boundary(run(base))).toEqual([
      at("node_modules/router/fs.d.ts", "inside a package named @types/node"),
    ]);
  });

  it("fails a nested copy whatever it calls itself", () => {
    // Without a top-level copy the type reference resolves to the nested one.
    const base = tree({
      "tsconfig.json": appConfig(),
      ...under("node_modules/tool", {
        "package.json": JSON.stringify({ name: "tool", types: "index.d.ts" }),
        "index.d.ts":
          '/// <reference types="node" />\nexport declare const t: number;\n',
      }),
      ...under(
        "node_modules/tool/node_modules/@types/node",
        nodeTypes("renamed"),
      ),
      "src/a.ts": 'import type { t } from "tool";\nexport type T = typeof t;\n',
    });
    const found = boundary(run(base));
    expect(found).toContain(
      at(
        "node_modules/tool/node_modules/@types/node/index.d.ts",
        "installed at @types/node",
      ),
    );
    expect(found.every((p) => p.includes("/tool/node_modules/"))).toBe(true);
  });

  it("fails the Vite config re-added to or imported by the app", () => {
    const config = {
      "vite.config.ts": 'import type { t } from "tool";\nexport default t;\n',
    };
    const added = run(
      fixture(
        { ...config, "src/a.ts": "export {};\n" },
        appConfig([], ["src", "vite.config.ts"]),
      ),
    );
    expect(added).toContain(
      "program input outside the admitted set: vite.config.ts",
    );
    expect(boundary(added)).toContain(nodeAt("index.d.ts"));
    const imported = run(
      fixture({
        ...config,
        "src/a.ts":
          'import type c from "../vite.config";\nexport type C = typeof c;\n',
      }),
    );
    expect(boundary(imported)).toContain(nodeAt("index.d.ts"));
  });

  it.runIf(windows)("fails a case-folded folder name", () => {
    // A separate tree, since a case-insensitive file system would merge it into the real copy.
    const base = tree({
      "tsconfig.json": appConfig(),
      ...under("node_modules/@Types/Node", nodeTypes("case-alias")),
      "src/a.ts":
        '/// <reference path="../node_modules/@Types/Node/globals.d.ts" />\nexport {};\n',
    });
    expect(boundary(run(base))).toEqual([
      at("node_modules/@Types/Node/globals.d.ts", "installed at @types/node"),
    ]);
  });

  it.runIf(windows)("fails a short-path alias", (context) => {
    const base = fixture({});
    const short = execFileSync(
      "cmd",
      ["/d", "/s", "/c", `"for %I in ("${base}") do @echo %~sI"`],
      { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true },
    ).trim();
    if (short.toLowerCase() === base.toLowerCase()) context.skip();
    const target = join(
      short,
      "node_modules",
      "@types",
      "node",
      "globals.d.ts",
    );
    const problems = run(
      fixture({
        "src/a.ts": `/// <reference path="${target.split(sep).join("/")}" />\nexport {};\n`,
      }),
    );
    expect(
      boundary(problems).some((p) => p.endsWith("installed at @types/node")),
    ).toBe(true);
  });

  it("fails a junction or directory link alias", () => {
    const base = fixture({
      "src/a.ts":
        '/// <reference path="../alias/globals.d.ts" />\nexport {};\n',
    });
    link(join(base, "node_modules", "@types", "node"), join(base, "alias"));
    expect(boundary(run(base))).toEqual([nodeAt("globals.d.ts")]);
  });

  it("fails a file symlink alias", (context) => {
    const base = fixture({
      "src/a.ts": '/// <reference path="../alias.d.ts" />\nexport {};\n',
    });
    try {
      symlinkSync(
        join(base, "node_modules", "@types", "node", "globals.d.ts"),
        join(base, "alias.d.ts"),
        "file",
      );
    } catch (error) {
      // Unprivileged Windows accounts cannot create file symlinks.
      if (error.code === "EPERM") context.skip();
      throw error;
    }
    expect(boundary(run(base))).toEqual([nodeAt("globals.d.ts")]);
  });

  it("fails closed when canonicalisation or identity reads fail", () => {
    const base = fixture({ "src/a.ts": "export const a = 1;\n" });
    const realpath = (path) => {
      if (path.endsWith("a.ts"))
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      return ts.sys.realpath(path);
    };
    expect(run(base, { realpath })).toContain(
      `program input ${join(base, "src", "a.ts").split(sep).join("/")} has no real path`,
    );
    const readFile = (path) => {
      throw Object.assign(new Error(`denied ${path}`), { code: "EACCES" });
    };
    expect(
      boundary(run(base, { readFile })).every((p) =>
        p.endsWith("is unreadable: EACCES"),
      ),
    ).toBe(true);
    expect(boundary(run(base, { readFile })).length).toBeGreaterThan(0);
  });

  it("fails a package root without its identity file", () => {
    const base = fixture({
      "node_modules/bare/index.d.ts": "export declare const b: number;\n",
      "src/a.ts": 'import type { b } from "bare";\nexport type B = typeof b;\n',
    });
    expect(boundary(run(base))).toEqual([
      at(
        "node_modules/bare/index.d.ts",
        "package root bare has no package.json",
      ),
    ]);
  });

  it("fails when the dependency root is unavailable", () => {
    const base = tree({
      "tsconfig.json": appConfig(),
      "src/a.ts": "export {};\n",
    });
    expect(run(base)).toEqual([
      "tsconfig.json: the trusted dependency root is unavailable, so forbidden packages cannot be excluded",
    ]);
  });
}, 60_000);

const toolingConfig = JSON.stringify({
  compilerOptions: { ...options, types: [] },
  include: ["playwright.config.ts", "vite.config.ts", "browser"],
});
const tooling = {
  ...programs[1],
  types: [],
  config: ["playwright.config.ts", "vite.config.ts", "browser/named.d.ts"],
};
const toolingRun = (files, spec = tooling) =>
  programInputs(
    tree({
      "tsconfig.browser.json": toolingConfig,
      "node_modules/.keep": "",
      "playwright.config.ts": "export {};\n",
      "vite.config.ts": "export {};\n",
      "browser/a.ts": "export {};\n",
      ...files,
    }),
    spec,
  ).problems;

describe("the tooling program", () => {
  it("passes the fixture tooling program", () => {
    expect(toolingRun({})).toEqual([]);
  });

  it("refuses app source imported by the Vite config", () => {
    expect(
      toolingRun({
        "vite.config.ts": 'import { a } from "./src/a";\nexport default a;\n',
        "src/a.ts": "export const a = 1;\n",
      }),
    ).toEqual(["program input outside the admitted set: src/a.ts"]);
  });

  it("refuses first-party global augmentations", () => {
    expect(
      toolingRun({
        "browser/a.ts":
          "declare global {\n  var leaked: number;\n}\nexport {};\n",
        "vite.config.ts":
          'declare module "x" {\n  global {\n    var nested: number;\n  }\n}\nexport {};\n',
        "browser/named.d.ts": "declare var script: number;\n",
        "browser/b.ts": '/// <reference path="named.d.ts" />\nexport {};\n',
      }),
    ).toEqual([
      "vite.config.ts: declare global is not admitted here",
      "browser/a.ts: declare global is not admitted here",
      "browser/named.d.ts: a script file declares globals",
    ]);
  });

  it("admits a global augmentation only in a named file", () => {
    const files = {
      "browser/a.ts":
        "declare global {\n  var leaked: number;\n}\nexport {};\n",
    };
    expect(
      toolingRun(files, { ...tooling, globalAugmentations: ["browser/a.ts"] }),
    ).toEqual([]);
  });
}, 60_000);
