// @vitest-environment node
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, expect, it } from "vitest";
import rule, { reservedNames } from "./css-module-access.js";
import { production } from "./production-eslint.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const card = 'import styles from "./Card.module.css";\n';
const tick = "`";
const ts = { languageOptions: { parser: tseslint.parser } };
const jsx = {
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
};

const valid = [
  [
    "dot read of an upper-case module",
    'import s from "./Card.MODULE.CSS";\ns.card;',
  ],
  ["a plain stylesheet beside the family", 'import "./Card.scss";'],
  ["read passed as an argument", `${card}f(styles.card);`],
  ["read as a conditional branch", `${card}const c = x ? styles.card : "";`],
  ["read as a logical operand", `${card}const c = styles.card ?? "";`],
  ["read as an array element", `${card}const c = [styles.card].join(" ");`],
  [
    "read as a JSX attribute",
    `${card}const C = () => <i className={styles.card} />;`,
    jsx,
  ],
  ["dot access", `${card}styles.card;`],
  ["optional dot access", `${card}styles?.card;`],
  ["string-literal bracket", `${card}styles["card-title"];`],
  [
    "expression-free template bracket",
    `${card}styles[${tick}card-title${tick}];`,
  ],
  ["renamed import", 'import s from "./Card.module.css";\ns.card;'],
  [
    "default by name",
    'import { default as s } from "./Card.module.css";\ns.card;',
  ],
  ["destructuring", `${card}const { card, title } = styles;`],
  ["renamed destructuring", `${card}const { card: c, title: t } = styles;`],
  ["side-effect import", 'import "./Card.module.css";'],
  [
    "non-module import left untouched",
    'import data from "./data.js";\nconst k = "a";\ndata[k];\nf(data);',
  ],
  [
    "a shadowing local is another binding",
    `${card}function f(styles, k) { return styles[k]; }`,
  ],
  [
    "JSX className by dot",
    `${card}const C = () => <div className={styles.card} />;`,
    jsx,
  ],
  ["typeof in a type", `${card}let t: typeof styles;`, ts],
  ["keyof typeof in a type", `${card}type K = keyof typeof styles;`, ts],
  ["Function.prototype name read", `${card}styles.name;`],
  ["Function.prototype length read", `${card}styles.length;`],
  ["Function.prototype call read", `${card}styles.call;`],
  ["Function.prototype name destructured", `${card}const { name } = styles;`],
  // Locals hold class strings, so calling one is a runtime TypeError, not an escape.
  [
    "call of a read alias",
    `${card}const f = styles.card;
f();`,
  ],
  [
    "call of a destructured local",
    `${card}const { card } = styles;
card();`,
  ],
  [
    "type-only reference beside a dot read",
    `${card}const c: (typeof styles)["card"] = styles.card;`,
    ts,
  ],
];

const families = ["pcss", "postcss", "scss", "less", "styl", "sss"];

const invalid = [
  ...families.flatMap((family) => [
    [
      `default import of .module.${family}`,
      `import s from "./Card.module.${family}";\ns.card;`,
      "family",
    ],
    [
      `side-effect import of .module.${family}`,
      `import "./Card.module.${family}";`,
      "family",
    ],
    [
      `re-export of .module.${family}`,
      `export { default } from "./Card.module.${family}";`,
      "family",
    ],
    [
      `re-export all of .module.${family}`,
      `export * from "./Card.module.${family}";`,
      "family",
    ],
    [
      `import() of .module.${family}`,
      `import("./Card.module.${family}");`,
      "family",
    ],
    [
      `glob of .module.${family}`,
      `import.meta.glob("./*.module.${family}");`,
      "dynamic",
    ],
  ]),
  [
    "query-suffixed import of another family",
    'import s from "./Card.module.scss?inline";',
    "family",
  ],
  // Vite treats the upper-case name as plain CSS; the rule still applies the module policy.
  [
    "computed read of an upper-case module",
    'import s from "./Card.MODULE.CSS";\ns[k];',
    "computed",
  ],
  [
    "glob with a character class",
    'import.meta.glob("./*.module.c[s]s");',
    "dynamic",
  ],
  ["namespace import", 'import * as ns from "./Card.module.css";', "namespace"],
  [
    "named class import",
    'import { card } from "./Card.module.css";\nf(card);',
    "named",
  ],
  [
    "named beside default",
    'import s, { card } from "./Card.module.css";\ns.card;',
    "named",
  ],
  [
    "query-suffixed default import",
    'import s from "./Card.module.css?inline";',
    "query",
  ],
  [
    "query-suffixed named import",
    'import { a } from "./Card.module.css?url";',
    "query",
  ],
  [
    "query-suffixed namespace import",
    'import * as n from "./Card.module.css?x";',
    "query",
  ],
  ["empty query", 'import s from "./Card.module.css?";', "query"],
  ["literal import()", 'import("./Card.module.css");', "dynamic"],
  ["template import()", `import(${tick}./Card.module.css${tick});`, "dynamic"],
  ["query-suffixed import()", 'import("./Card.module.css?inline");', "dynamic"],
  ["non-literal import()", "import(path);", "dynamic"],
  [
    "template import() with an expression",
    `import(${tick}./\${n}.module.css${tick});`,
    "dynamic",
  ],
  ["literal require()", 'require("./Card.module.css");', "dynamic"],
  [
    "query-suffixed require()",
    'require("./Card.module.css?inline");',
    "dynamic",
  ],
  ["non-literal require()", "require(path);", "dynamic"],
  ["glob of modules", 'import.meta.glob("./*.module.css");', "dynamic"],
  [
    "glob array of modules",
    'import.meta.glob(["./a.js", "./*.module.css"]);',
    "dynamic",
  ],
  [
    "TypeScript import-equals",
    'import s = require("./Card.module.css");',
    "dynamic",
    ts,
  ],
  [
    "re-export of the default",
    'export { default } from "./Card.module.css";',
    "reExport",
  ],
  ["re-export all", 'export * from "./Card.module.css";', "reExport"],
  [
    "re-export as a namespace",
    'export * as ns from "./Card.module.css";',
    "reExport",
  ],
  [
    "query-suffixed re-export",
    'export { default } from "./Card.module.css?inline";',
    "reExport",
  ],
  ["computed key", `${card}const k = "card";\nstyles[k];`, "computed"],
  [
    "template key with an expression",
    `${card}styles[${tick}c\${1}${tick}];`,
    "computed",
  ],
  ["optional computed key", `${card}styles?.[k];`, "computed"],
  ["numeric key", `${card}styles[0];`, "computed"],
  [
    "renamed import with a computed key",
    'import s from "./Card.module.css";\ns[k];',
    "computed",
  ],
  [
    "default by name with a computed key",
    'import { default as s } from "./Card.module.css";\ns[k];',
    "computed",
  ],
  [
    "destructuring with a rest element",
    `${card}const { card, ...rest } = styles;`,
    "destructure",
  ],
  [
    "nested destructuring",
    `${card}const { card: { length } } = styles;`,
    "destructure",
  ],
  [
    "default-valued destructuring",
    `${card}const { card = "x" } = styles;`,
    "destructure",
  ],
  [
    "string-key destructuring",
    `${card}const { "card-title": t } = styles;`,
    "destructure",
  ],
  [
    "computed-key destructuring",
    `${card}const { [k]: picked } = styles;`,
    "destructure",
  ],
  [
    "destructuring assignment",
    `${card}let c;\n({ card: c } = styles);`,
    "escape",
  ],
  ["array destructuring", `${card}const [first] = styles;`, "escape"],
  ["alias", `${card}const alias = styles;\nalias[k];`, "escape"],
  ["argument", `${card}f(styles);`, "escape"],
  ["spread", `${card}const o = { ...styles };`, "escape"],
  ["JSX spread", `${card}const C = () => <div {...styles} />;`, "escape", jsx],
  ["return", `${card}function f() { return styles; }`, "escape"],
  ["assignment", `${card}let o;\no = styles;`, "escape"],
  ["export by name", `${card}export { styles };`, "escape"],
  ["default export", `${card}export default styles;`, "escape"],
  ["value cast", `${card}(styles as Record<string, string>)[k];`, "escape", ts],
  [
    "value cast read by dot",
    `${card}(styles as Record<string, string>).card;`,
    "escape",
    ts,
  ],
  ["non-null assertion", `${card}styles!.card;`, "escape", ts],
  ["for...in", `${card}for (const k in styles) f(k);`, "escape"],
  ["Object.keys", `${card}Object.keys(styles);`, "escape"],
  ["JSON.stringify", `${card}JSON.stringify(styles);`, "escape"],
  ["value typeof", `${card}typeof styles;`, "escape"],
  ["in operator", `${card}"card" in styles;`, "escape"],
  ["member write", `${card}styles.card = "x";`, "escape"],
  ["member delete", `${card}delete styles.card;`, "escape"],
  ["call by dot", `${card}styles.card();`, "call"],
  ["optional member call", `${card}styles?.card();`, "call"],
  ["optional call", `${card}styles.card?.();`, "call"],
  ["call by string-literal key", `${card}styles["card"]();`, "call"],
  ["call by template key", `${card}styles[${tick}card${tick}]();`, "call"],
  ["call of a parenthesised optional read", `${card}(styles?.card)();`, "call"],
  ["call through a sequence", `${card}(0, styles.card)();`, "call"],
  ["call through a logical operand", `${card}(styles.card || f)();`, "call"],
  ["call through a conditional", `${card}(x ? styles.card : f)();`, "call"],
  ["tagged template", `${card}styles.card${tick}x${tick};`, "call"],
  ["new", `${card}new styles.card();`, "call"],
  ["class heritage", `${card}class A extends styles.card {}`, "call"],
  ["call through a non-null assertion", `${card}styles.card!();`, "call", ts],
  ["call through a cast", `${card}(styles.card as () => void)();`, "call", ts],
  ["reserved call", `${card}styles.valueOf();`, "reserved"],
  [
    "reserved introspection",
    `${card}styles.hasOwnProperty("card");`,
    "reserved",
  ],
  ["reserved by optional dot", `${card}styles?.constructor;`, "reserved"],
  ["reserved by string-literal key", `${card}styles["__proto__"];`, "reserved"],
  [
    "reserved by template key",
    `${card}styles[${tick}toString${tick}];`,
    "reserved",
  ],
  ...reservedNames.map((name) => [
    `reserved read of ${name}`,
    `${card}styles.${name};`,
    "reserved",
  ]),
  ...reservedNames.map((name) => [
    `reserved destructuring of ${name}`,
    `${card}const { ${name}: v } = styles;`,
    "destructure",
  ]),
];

tester.run("css-module-access", rule, {
  valid: valid.map(([name, code, options]) => ({ name, code, ...options })),
  invalid: invalid.map(([name, code, messageId, options]) => ({
    name,
    code,
    errors: [{ messageId }],
    ...options,
  })),
});

describe("css-module-access reserved names", () => {
  it("match the Object.prototype names of the running Node", () => {
    expect(new Set(reservedNames)).toEqual(
      new Set(Object.getOwnPropertyNames(Object.prototype)),
    );
    expect(reservedNames).toHaveLength(new Set(reservedNames).size);
  });
});

describe("css-module-access in the production configuration", () => {
  it("fails a computed read of a CSS module class", async () => {
    const [result] = await production.lintText(
      `${card}const tone = String(Date.now());
export const pick = () => styles[tone];
`,
      { filePath: "src/Tone.tsx" },
    );
    expect(result.messages.map((m) => m.ruleId)).toEqual([
      "sharpladder/css-module-access",
    ]);
  });

  it("fails recovering the module object through valueOf", async () => {
    const [result] = await production.lintText(
      `${card}const alias = styles.valueOf();
const key = String(Date.now());
console.log(alias[key]);
`,
      { filePath: "src/Alias.tsx" },
    );
    expect(result.messages.map((m) => [m.ruleId, m.messageId, m.line])).toEqual(
      [["sharpladder/css-module-access", "reserved", 2]],
    );
  });
});
