// @vitest-environment node
import { ESLint, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, expect, it } from "vitest";
import rule from "./app-capabilities.js";
import { production, web } from "./production-eslint.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tseslint.parser,
  },
});

const ts = { languageOptions: { parser: tseslint.parser } };
const browser = {
  languageOptions: {
    globals: { SharedWorker: "readonly", Worker: "readonly" },
  },
};

const valid = [
  ["new.target is not import.meta", "function F() { return new.target; }"],
  ["static import", 'import styles from "./Card.module.css";\nstyles.card;'],
  ["static re-export", 'export { a } from "./a";'],
  ["a local named Worker", "class Worker {}\nnew Worker();"],
  ["a local window", "const window = 1;\nwindow + 1;"],
  ["a parameter named self", "export const f = (self) => self.x;"],
  ["the root lookup", 'document.getElementById("root");'],
  ["a local document", "const document = { body: 1 };\ndocument.body;"],
  ["a worker key on an object", "job.Worker;\nconst { Worker: W } = job;"],
  ["a Worker type", "let w: Worker | undefined;"],
  ["an ordinary computed read", "const o = { a: 1 };\nconst k = 'a';\no[k];"],
];

const invalid = [
  [
    "eager glob with a dynamic read",
    'const m = import.meta.glob("./*.css", { eager: true, import: "default" });\nm[k];',
    "importMeta",
  ],
  ["lazy glob", 'import.meta.glob("./*.css");', "importMeta"],
  ["array glob", 'import.meta.glob(["./*.css"]);', "importMeta"],
  ["bracketed glob", 'import.meta.glob("./*.module.c[s]s");', "importMeta"],
  ["computed glob key", 'import.meta["glob"]("./*.css");', "importMeta"],
  ["glob alias", "const g = import.meta.glob;", "importMeta"],
  ["meta alias", 'const m = import.meta;\nm.glob("./*.css");', "importMeta"],
  ["destructured glob", "const { glob } = import.meta;", "importMeta"],
  ["cast glob", '(import.meta as any).glob("./*.css");', "importMeta", ts],
  ["env", "import.meta.env;", "importMeta"],
  ["url", "import.meta.url;", "importMeta"],
  [
    "URL from import.meta.url",
    'new URL("./a.module.css", import.meta.url);',
    "importMeta",
  ],
  ["resolve", 'import.meta.resolve("./a.module.css");', "importMeta"],
  ["import() of source", 'import("./x.ts");', "dynamicImport"],
  ["import() of a variable", "import(x);", "dynamicImport"],
  ["import() of a CSS module", 'import("./Card.module.css");', "dynamicImport"],
  [
    "import() with options",
    'import("./a.json", { with: { type: "json" } });',
    "dynamicImport",
  ],
  ["a runtime typeof globalThis", "const t = typeof globalThis;", "global"],
  ["a static global read", "window.location;", "global"],
  ["new Worker", 'new Worker("./w.js");', "global", browser],
  ["Worker alias", "const W = Worker;\nnew W(u);", "global", browser],
  ["Worker without configured globals", "new Worker(u);", "global"],
  ["globalThis.Worker", "new globalThis.Worker(u);", ["global", "global"]],
  [
    "window SharedWorker key",
    'new window["SharedWorker"](u);',
    ["global", "global"],
  ],
  ["new SharedWorker", "new SharedWorker(u);", "global", browser],
  ["destructured Worker", "const { Worker: W } = self;", "global"],
  ["computed global key", "window[name];", "global"],
  [
    "computed destructured global key",
    "const { [k]: v } = globalThis;",
    "global",
  ],
  ["eval", "eval(s);", "global"],
  ["eval alias", "const e = eval;", "global"],
  ["Function", 'Function("return 1")();', "global"],
  ["new Function", 'new Function("return 1");', "global"],
  ["globalThis.eval", "globalThis.eval(s);", "global"],
  [
    "import attributes",
    'import s from "./Card.module.css" with { type: "css" };',
    "attributes",
  ],
  [
    "export-all attributes",
    'export * from "./a" with { type: "json" };',
    "attributes",
  ],
  [
    "named re-export attributes",
    'export { a } from "./a.json" with { type: "json" };',
    "attributes",
  ],
  ["empty with clause", 'import "./a.ts" with {};', "attributes"],
  ["empty assert clause", 'import "./a.ts" assert {};', "attributes", ts],
  ["empty export-all clause", 'export * from "./a.ts" with {};', "attributes"],
  [
    "legacy import assertion",
    'import a from "./a.json" assert { type: "json" };',
    "attributes",
    ts,
  ],
];

tester.run("app-capabilities", rule, {
  valid: valid.map(([name, code, options]) => ({ name, code, ...options })),
  invalid: invalid.map(([name, code, messageIds, options]) => ({
    name,
    code,
    errors: [messageIds].flat().map((messageId) => ({ messageId })),
    ...options,
  })),
});

const lint = async (code, filePath = "src/Probe.tsx") => {
  const [result] = await production.lintText(code, { filePath });
  return result.messages;
};

const card = 'import styles from "./Card.module.css";\n';
const app = "sharpladder/app-capabilities";
const css = "sharpladder/css-module-access";
const extension = "sharpladder/source-extension";

const composed = [
  [
    "eager glob with a dynamic read",
    'const m = import.meta.glob("./*.css", { eager: true, import: "default" });\nexport const pick = (k: string) => m[k];\n',
    app,
    "importMeta",
  ],
  [
    "lazy glob",
    'export const m = import.meta.glob("./*.css");\n',
    app,
    "importMeta",
  ],
  [
    "array glob",
    'export const m = import.meta.glob(["./*.css"]);\n',
    app,
    "importMeta",
  ],
  [
    "bracketed glob",
    'export const m = import.meta.glob("./*.module.c[s]s");\n',
    app,
    "importMeta",
  ],
  [
    "computed glob key",
    'export const m: unknown = import.meta["glob"]("./*.css");\n',
    app,
    "importMeta",
  ],
  ["glob alias", "export const g = import.meta.glob;\n", app, "importMeta"],
  [
    "meta alias",
    'const m = import.meta;\nexport const x = m.glob("./*.css");\n',
    app,
    "importMeta",
  ],
  [
    "destructured glob",
    "export const { glob } = import.meta;\n",
    app,
    "importMeta",
  ],
  [
    "cast glob",
    'export const x: unknown = (import.meta as any).glob("./*.css");\n',
    app,
    "importMeta",
  ],
  ["env", "export const e = import.meta.env.MODE;\n", app, "importMeta"],
  ["url", "export const u = import.meta.url;\n", app, "importMeta"],
  [
    "URL from import.meta.url",
    'export const u = new URL("./a.module.css", import.meta.url);\n',
    app,
    "importMeta",
  ],
  [
    "resolve",
    'export const r = import.meta.resolve("./a.module.css");\n',
    app,
    "importMeta",
  ],
  [
    "import() of source",
    'export const p = import("./x.ts");\n',
    app,
    "dynamicImport",
  ],
  [
    "import() of a variable",
    "export const p = (x: string) => import(x);\n",
    app,
    "dynamicImport",
  ],
  [
    "import() of a CSS module",
    'export const p = import("./Card.module.css");\n',
    app,
    "dynamicImport",
  ],
  ["new Worker", 'export const w = new Worker("./w.js");\n', app, "global"],
  [
    "Worker alias",
    "const W = Worker;\nexport const w = (u: string) => new W(u);\n",
    app,
    "global",
  ],
  ["globalThis.Worker", "export const W = globalThis.Worker;\n", app, "global"],
  [
    'window["SharedWorker"]',
    'export const W = window["SharedWorker"];\n',
    app,
    "global",
  ],
  [
    "new SharedWorker",
    "export const w = (u: string) => new SharedWorker(u);\n",
    app,
    "global",
  ],
  ["eval alias", "export const e = eval;\n", app, "global"],
  [
    "new Function",
    'export const f = new Function("return 1");\n',
    "no-new-func",
    null,
  ],
  ["eval call", 'export const v: unknown = eval("1");\n', "no-eval", null],
  [
    "import attributes",
    'import s from "./Card.module.css" with { type: "css" };\nexport const c = s.card;\n',
    app,
    "attributes",
  ],
  [
    "export-all attributes",
    'export * from "./a" with { type: "json" };\n',
    app,
    "attributes",
  ],
  ...["pcss", "postcss", "scss", "less", "styl", "sss"].flatMap((family) => [
    [
      `default import of .module.${family}`,
      `import s from "./Card.module.${family}";\nexport const c: unknown = s;\n`,
      css,
      "family",
    ],
    [
      `re-export of .module.${family}`,
      `export { default } from "./Card.module.${family}";\n`,
      css,
      "family",
    ],
    [
      `import() of .module.${family}`,
      `export const p = import("./Card.module.${family}");\n`,
      css,
      "family",
    ],
  ]),
];

describe("application capabilities in the production configuration", () => {
  it.each(composed)("fails %s", async (_, code, ruleId, messageId) => {
    const messages = await lint(code);
    expect(messages.filter((m) => m.fatal)).toEqual([]);
    expect(
      messages.some(
        (m) =>
          m.ruleId === ruleId &&
          (messageId === null || m.messageId === messageId),
      ),
    ).toBe(true);
  });

  it.each(["jsx", "mts", "cts", "js", "mjs", "cjs"])(
    "fails a planted src/w.%s",
    async (ext) => {
      const messages = await lint(
        `${card}export const s = styles;\n`,
        `src/w.${ext}`,
      );
      expect(messages.filter((m) => m.fatal)).toEqual([]);
      expect(messages.map((m) => m.ruleId)).toContain(extension);
      expect(messages.map((m) => m.ruleId)).toContain(css);
    },
  );

  it("passes the approved imports and reads", async () => {
    const messages = await lint(
      `${card}import { default as s } from "./Card.module.css";
export const a = styles.card;
export const b = s["card-title"];
export const c = styles[\`title\`];
export const { card } = s;
export type Classes = keyof typeof styles;
export const fn = function F() {
  return new.target;
};
`,
    );
    expect(messages).toEqual([]);
  });
});

describe("source extension coverage", () => {
  const extensions = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];
  const plain = new ESLint({ cwd: web });

  it.each(extensions)(
    "gives src/*.%s the app policy or a rejection",
    async (ext) => {
      const filePath = `src/Probe.${ext}`;
      expect(await plain.isPathIgnored(filePath)).toBe(false);
      const config = await plain.calculateConfigForFile(filePath);
      expect(config).toBeDefined();
      expect(config.rules[app]).toEqual([2]);
      expect(config.rules[css]).toEqual([2]);
      const typed = ext === "ts" || ext === "tsx";
      if (typed) {
        expect(config.rules[extension]).toBeUndefined();
        expect(
          config.rules["@typescript-eslint/no-unsafe-member-access"],
        ).toEqual([2]);
        expect(config.languageOptions.parserOptions.projectService).toBe(true);
      } else {
        expect(config.rules[extension]).toEqual([2]);
      }
      const messages = await lint("export const x = 1;\n", filePath);
      expect(messages.map((m) => m.message).join("\n")).not.toMatch(
        /No matching configuration|File ignored/u,
      );
      expect(messages.filter((m) => m.fatal)).toEqual([]);
      expect(messages.map((m) => m.ruleId)).toEqual(typed ? [] : [extension]);
    },
  );

  it.each([
    "eslint.config.js",
    "vite.config.test.js",
    "eslint-rules/app-capabilities.test.js",
  ])("leaves %s outside the application bans", async (filePath) => {
    const config = await plain.calculateConfigForFile(filePath);
    expect(config.rules[app]).toBeUndefined();
    expect(config.rules[extension]).toBeUndefined();
  });
});
