// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tseslint from "typescript-eslint";
import { afterAll, describe, expect, it } from "vitest";
import { buildFixture, cleanUp } from "../build-guard/fixture.js";
import { production } from "../eslint-rules/production-eslint.js";
import { checkProgram, describeFinding, parseSource } from "./index.js";

afterAll(cleanUp);

const app = "sharpladder/app-capabilities";

// The build parses through parseSource; the editor hands typescript-eslint output to the rule.
const parsers = {
  build: (code) => parseSource(code, "src/Probe.tsx"),
  "typescript-eslint": (code) =>
    tseslint.parser.parseForESLint(code, {
      sourceType: "module",
      ecmaFeatures: { jsx: true },
      range: true,
      loc: true,
    }),
};
const judge = ({ ast, scopeManager }) =>
  checkProgram(ast, scopeManager).map(describeFinding);
const scan = (parse, code) => judge(parse(code));

// Each case is [name, source, the global the finding must name, also built for real].
const refused = [
  [
    "computed Worker through an alias",
    'const g = globalThis;\nconst k = "Worker";\nnew (g[k] as any)("/x.js");',
    "globalThis",
    true,
  ],
  [
    "a cast eval alias",
    'const e = eval as (s: string) => unknown;\nconsole.log(e("1"));',
    "eval",
    true,
  ],
  [
    "new Function",
    'console.log(new Function("return 3")());',
    "Function",
    true,
  ],
  ["globalThis.eval", 'globalThis.eval("1");', "globalThis", true],
  [
    "a destructured Worker",
    'const { Worker: W } = self;\nnew W("/x.js");',
    "self",
    true,
  ],
  [
    "an array of globalThis",
    "console.log([globalThis][0]);",
    "globalThis",
    true,
  ],
  ["window as an argument", "console.log(window);", "window", true],
  ["an optional computed read", 'console.log(window?.["x"]);', "window", true],
  ["a cast global", "console.log((globalThis as any).x);", "globalThis", true],
  ["a non-null global", "console.log(self!.name);", "self", true],
  [
    "a satisfies global",
    "console.log((window satisfies object).name);",
    "window",
    true,
  ],
  ["top.location", "console.log(top.location);", "top", true],
  ["parent", "console.log(parent);", "parent", true],
  ["frames", "console.log(frames);", "frames", true],
  [
    "a document alias",
    "const d = document;\nconsole.log(d);",
    "document",
    true,
  ],
  [
    "a computed root lookup",
    'console.log(document["getElementById"]("root"));',
    "document",
    true,
  ],
  [
    "a root lookup by variable",
    'const id = "root";\nconsole.log(document.getElementById(id));',
    "document",
    true,
  ],
  [
    "an optional root lookup",
    'console.log(document?.getElementById("root"));',
    "document",
    true,
  ],
  [
    "another root id",
    'console.log(document.getElementById("app"));',
    "document",
    true,
  ],
  ["document.body", "console.log(document.body);", "document", true],
  [
    "a global written",
    "export const f = () => {\n  window = 1;\n};",
    "window",
    false,
  ],
  ["a runtime typeof", "console.log(typeof globalThis);", "globalThis", true],
  [
    "an erased declaration",
    "declare const window: { x: number };\nconsole.log(window.x);",
    "window",
    true,
  ],
  [
    "a type-only import",
    'import type { A as window } from "./a.ts";\nconsole.log(window);',
    "window",
    false,
  ],
  [
    "a block binding out of scope",
    "{\n  const window = 1;\n  console.log(window);\n}\nconsole.log(window);",
    "window",
    true,
  ],
  [
    "a default before a body var",
    "export function f(a = window) {\n  var window = 2;\n  return [a, window];\n}",
    "window",
    true,
  ],
  ["a shorthand property", "console.log({ globalThis });", "globalThis", true],
  ["a JSX component", "export const e = <Worker />;", "Worker", false],
  ["a JSX member", "export const e = <window.X />;", "window", false],
  [
    "an inline type-only import",
    'import { type A as window } from "./a.ts";\nconsole.log(window);',
    "window",
    false,
  ],
  [
    "a declared function",
    'declare function eval(s: string): unknown;\nconsole.log(eval("1"));',
    "eval",
    true,
  ],
  [
    "a declared namespace",
    "declare namespace self {\n  const x: number;\n}\nconsole.log(self.x);",
    "self",
    true,
  ],
  [
    "a let in an inner function",
    "const f = () => {\n  let self = 1;\n  return self;\n};\nconsole.log(self, f);",
    "self",
    true,
  ],
  [
    "a class name outside its class",
    "const C = class top {\n  m() {\n    return top;\n  }\n};\nconsole.log(C, top);",
    "top",
    true,
  ],
  [
    "a catch binding outside its clause",
    "try {\n  console.log(1);\n} catch (top) {\n  console.log(top);\n}\nconsole.log(top);",
    "top",
    true,
  ],
  [
    "a loop binding outside its loop",
    "for (const self of [1]) console.log(self);\nconsole.log(self);",
    "self",
    true,
  ],
  [
    "a cast to a worker type",
    "console.log(window as unknown as Worker);",
    "window",
    true,
  ],
  [
    "an assigned alias",
    "let w: unknown;\nw = window;\nconsole.log(w);",
    "window",
    true,
  ],
  ["an exported global", "export { window };", "window", false],
  [
    "an import-equals alias",
    "import d = window.document;\nconsole.log(d);",
    "window",
    false,
  ],
  [
    "a computed key in a class",
    "export class C {\n  [globalThis.x] = 1;\n}",
    "globalThis",
    true,
  ],
];

const allowed = [
  [
    "a named function expression",
    "export const f = function window() {\n  return window;\n};",
  ],
  [
    "a named class expression",
    "export const C = class self {\n  m() {\n    return self;\n  }\n};",
  ],
  ["an attribute-free re-export", 'export { a } from "./a.ts";'],
  ["a type query", "export type G = typeof globalThis;"],
  ["a type reference", "export let w: Worker | undefined;"],
  ["a type query in a cast", "console.log(1 as unknown as typeof window);"],
  [
    "a type-only import used as a type",
    'import type { A as window } from "./a.ts";\nexport let w: window | undefined;',
  ],
  [
    "a var hoisted out of a block",
    "{\n  var window = 1;\n}\nconsole.log(window);",
  ],
  [
    "a hoisted function",
    "console.log(top());\nfunction top() {\n  return 1;\n}",
  ],
  [
    "an earlier parameter in a default",
    "export function f(window = 1, b = window) {\n  return b;\n}",
  ],
  ["a local class", "class parent {}\nconsole.log(new parent());"],
  ["a local enum", "enum frames {\n  A,\n}\nconsole.log(frames.A);"],
  ["a local window", "const window = 1;\nconsole.log(window + 1);"],
  [
    "a parameter named self",
    "export const f = (self: { x: number }) => self.x;",
  ],
  [
    "a local document",
    "const document = { body: 1 };\nconsole.log(document.body);",
  ],
  [
    "a catch binding",
    "try {\n  console.log(1);\n} catch (top) {\n  console.log(top);\n}",
  ],
  [
    "names that are not references",
    "const o = { window: 1, top: 2 };\nconsole.log(o.window, o.top);\nexport { o as parent };",
  ],
];

// An empty clause carries no attributes, so only its presence marks it.
const emptyAttributes = [
  ["an empty with clause", 'import "./a.ts" with {};'],
  ["an empty assert clause", 'import "./a.ts" assert {};'],
  ["an empty export-all clause", 'export * from "./a.ts" with {};'],
  ["an empty re-export clause", 'export { a } from "./a.ts" with {};'],
];

const disabled =
  "// eslint-disable-next-line sharpladder/app-capabilities, no-eval -- probe\n" +
  'globalThis.eval("1");\n';

describe.each(Object.entries(parsers))("the engine on %s trees", (_, parse) => {
  it.each(refused)("refuses %s", (_name, code, global) => {
    expect(scan(parse, code)).toContain(`reference to ${global}`);
  });

  it.each(emptyAttributes)("refuses %s", (_name, code) => {
    expect(scan(parse, code)).toEqual(["import attributes"]);
  });

  it("refuses dynamic import options", () => {
    expect(scan(parse, 'void import("./a.ts", {});')).toContain("import()");
  });

  it.each(allowed)("allows %s", (_name, code) => {
    expect(scan(parse, code)).toEqual([]);
  });

  it.each(["App.tsx", "App.test.tsx", "main.tsx", "test-setup.ts"])(
    "allows src/%s",
    (file) => {
      const code = readFileSync(join(import.meta.dirname, "..", "src", file));
      expect(scan(parse, String(code))).toEqual([]);
    },
  );

  it("refuses the global behind a disable comment", () => {
    expect(scan(parse, disabled)).toContain("reference to globalThis");
  });

  it("fails closed on syntax it does not know", () => {
    const parsed = parse("console.log(1);");
    parsed.ast.body.push({ type: "FutureStatement" });
    expect(judge(parsed)).toContain("unsupported syntax FutureStatement");
  });
});

// Every banned value name the real scope manager leaves unresolved outside a type query must
// be a finding too.
describe("agreement with the typescript-eslint scope manager", () => {
  const banned =
    /^(?:Function|SharedWorker|Worker|document|eval|frames|globalThis|parent|self|top|window)$/u;
  it.each([...refused, ...allowed])("covers %s", (_name, code) => {
    const { ast, scopeManager } = tseslint.parser.parseForESLint(code, {
      sourceType: "module",
      ecmaFeatures: { jsx: true },
      range: true,
      loc: true,
    });
    // The parser sets no parent links, so type queries are found by source range.
    const queries = [];
    const collect = (node) => {
      if (node.type === "TSTypeQuery") queries.push(node.range);
      for (const [key, value] of Object.entries(node)) {
        if (key === "parent" || value === null || typeof value !== "object")
          continue;
        for (const child of [value].flat())
          if (typeof child?.type === "string") collect(child);
      }
    };
    collect(ast);
    const inTypeQuery = ({ range: [start] }) =>
      queries.some(([from, to]) => from <= start && start < to);
    const unresolved = scopeManager.globalScope.through
      .filter((r) => r.isValueReference && !inTypeQuery(r.identifier))
      .map((reference) => reference.identifier.name)
      .filter((name) => banned.test(name));
    const named = checkProgram(ast, scopeManager).map(
      (finding) => finding.name,
    );
    for (const name of unresolved) {
      if (name === "document" && code.includes('getElementById("root")'))
        continue;
      expect(named).toContain(name);
    }
  });
});

describe("the ESLint adapter in the production configuration", () => {
  const lint = async (code) => {
    const [result] = await production.lintText(`${code}\n`, {
      filePath: "src/Probe.tsx",
    });
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
    return result.messages;
  };

  it.each(refused)("refuses %s", async (_name, code, global) => {
    const messages = await lint(code);
    expect(
      messages.some((m) => m.ruleId === app && m.message.includes(global)),
    ).toBe(true);
  });

  it.each(allowed)("allows %s", async (_name, code) => {
    const messages = await lint(code);
    expect(messages.filter((m) => m.ruleId === app)).toEqual([]);
  });

  it("can be silenced by a reason-bearing disable comment", async () => {
    const messages = await lint(disabled);
    expect(messages.filter((m) => m.ruleId === app)).toEqual([]);
  });

  // Angle-bracket assertions parse only outside JSX, so these cases run as .ts.
  it.each([
    ["refuses", "console.log((<any>window).x);", ["reference to window"]],
    ["allows", "export const w = <Worker | undefined>undefined;", []],
  ])("%s an angle-bracket assertion", async (_verb, code, expected) => {
    const parsed = parseSource(`${code}\n`, "src/Probe.ts");
    expect(judge(parsed)).toEqual(expected);
    const [result] = await production.lintText(`${code}\n`, {
      filePath: "src/Probe.ts",
    });
    const messages = result.messages.filter((m) => m.ruleId === app);
    expect(messages.map((m) => m.message.split(" ")[0])).toEqual(
      expected.map((e) => e.split(" ").at(-1)),
    );
  });
});

// The build adapter and the ESLint adapter must reach the same complete verdict on every case.
describe("parity between the build and ESLint adapters", () => {
  const sources = ["App.tsx", "App.test.tsx", "main.tsx", "test-setup.ts"].map(
    (file) => [
      `src/${file}`,
      String(readFileSync(join(import.meta.dirname, "..", "src", file))),
    ],
  );
  const cases = [
    ...[...refused, ...emptyAttributes, ...allowed].map(([name, code]) => [
      name,
      `${code}\n`,
    ]),
    ["the disabled global", disabled],
    ...sources,
  ];
  const named = /^(\S+) is (?:not allowed|outside)/u;
  const fixed = new Map(
    ["importMeta", "dynamicImport", "attributes", "requireImport"].map(
      (kind) => [kind, describeFinding({ kind })],
    ),
  );
  const fromEslint = (m) => {
    const name = named.exec(m.message)?.[1];
    const label =
      fixed.get(m.messageId) ??
      describeFinding({ kind: m.messageId, name: name ?? "" });
    return `${m.line}:${m.column} ${m.messageId} ${label}`;
  };

  it.each(cases)("agrees on %s", async (name, code) => {
    // A real path would collide with the project service, so each case is a probe file.
    const filePath = name.endsWith(".ts") ? "src/Probe.ts" : "src/Probe.tsx";
    const { ast, scopeManager } = parseSource(code, filePath);
    const build = checkProgram(ast, scopeManager).map(
      (f) =>
        `${f.node.loc.start.line}:${f.node.loc.start.column + 1} ${f.kind} ${describeFinding(f)}`,
    );
    // The disable comment silences ESLint, so that case is judged without it.
    const [result] = await production.lintText(
      code.replace(/^\/\/ eslint-disable.*\n/u, "\n"),
      { filePath },
    );
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
    const eslint = result.messages.filter((m) => m.ruleId === app);
    expect(eslint.map(fromEslint).sort()).toEqual(build.sort());
  });
});

describe("the build guard in a real build", () => {
  const build = (code) => buildFixture({ "src/main.tsx": `${code}\n` });
  const rejects = async (code, pattern) => {
    const error = await build(code).then(
      () => null,
      (e) => e,
    );
    expect(error?.message).toMatch(/build guard: /u);
    expect(error?.message).toMatch(pattern);
  };

  it.each(refused.filter((c) => c[3]))(
    "fails on %s",
    async (_name, code, global) => {
      await rejects(code, new RegExp(`reference to ${global}\\b`, "u"));
    },
  );

  it.each(emptyAttributes)("fails on %s", async (_name, code) => {
    await rejects(code, /import attributes/u);
  });

  it("fails on a global behind a disable comment", async () => {
    await rejects(disabled, /reference to globalThis/u);
  });

  it("builds the root lookup and local bindings", async () => {
    await expect(
      build(
        'const root = document.getElementById("root");\n' +
          "const window = 1;\n" +
          "export const f = (self: { x: number }) => self.x + window;\n" +
          "export const g = function top() {\n  return top;\n};\n" +
          "export const C = class parent {\n  m() {\n    return parent;\n  }\n};\n" +
          "console.log(root);",
      ),
    ).resolves.toBeDefined();
  });
});
