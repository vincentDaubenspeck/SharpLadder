// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { cleanUp, tree } from "./fixture.js";
import {
  generatedProblems,
  typeModuleProblems,
  witnessProblems,
  witnessValue,
} from "./generated.js";
import { admitTree } from "./walk.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const emitterFixtures = join(
  web,
  "..",
  "tools",
  "SharpLadder.Content.Tests",
  "fixtures",
  "witness",
);
// Escapes are built from code points so no tool or editor decodes them on the way in.
const bs = String.fromCharCode(92);
const u = (hex) => `${bs}u${hex}`;
const at = "witness/chapters/a/b.ts";
const witnessHead =
  "// SharpLadder.Content witness emitter output, grammar 1. Do not edit.\n\n";
const contentImport =
  'import type { ContentDoc } from "../../../content.ts";\n\n';
const witness = (value, { head = witnessHead, imports = contentImport } = {}) =>
  `${head}${imports}export const witness = ${value} satisfies ContentDoc;\n`;
const base = '{\n  type: "part",\n  order: 2,\n  sections: [],\n}';

describe("witness grammar", () => {
  it("passes every committed witness and both type modules", () => {
    const src = admitTree(join(web, "src"));
    const generated = src.admitted.filter(({ path }) =>
      /[\\/]generated[\\/]/u.test(path),
    );
    expect(generated.length).toBeGreaterThanOrEqual(6);
    expect(generatedProblems(src.root, src.admitted)).toEqual([]);
  });

  it("passes the emitter's stress golden and decodes it to the same value", () => {
    const text = readFileSync(
      join(emitterFixtures, "stress.ts.expected"),
      "utf8",
    );
    const json = readFileSync(join(emitterFixtures, "stress.json"), "utf8");
    expect(witnessProblems(at, text)).toEqual([]);
    expect(witnessValue(at, text)).toStrictEqual(JSON.parse(json));
  });

  it("decodes hostile strings to their exact values", () => {
    const values = [
      'say "hi"',
      `back${bs}slash`,
      "line\r\nbreak",
      "Grüße 日本語 😀",
      `${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}`,
      "${x}",
      "*/ /*",
      "<script>alert(1)</script>",
      "it's `x`",
      `${bs}u0041`,
      "",
    ];
    // Plain JSON escaping and the emitter's all-ASCII escaping must both decode exactly.
    const ascii = (s) => {
      const json = JSON.stringify(s);
      let out = "";
      for (let i = 0; i < json.length; i += 1) {
        const c = json.charCodeAt(i);
        const hex = c.toString(16).toUpperCase().padStart(4, "0");
        out +=
          c < 0x20 || c > 0x7e || "'<>&`+".includes(json[i]) ? u(hex) : json[i];
      }
      return out;
    };
    for (const encode of [JSON.stringify, ascii]) {
      const items = values.map((v) => `    ${encode(v)},`).join("\n");
      const text = witness(`{\n  type: "part",\n  list: [\n${items}\n  ],\n}`);
      expect(witnessProblems(at, text)).toEqual([]);
      expect(witnessValue(at, text)).toStrictEqual({
        type: "part",
        list: values,
      });
    }
  });

  it("decodes the admitted number and boolean forms", () => {
    const text = witness(
      "{\n  a: 0,\n  b: -1,\n  c: 9007199254740991,\n  d: -9007199254740991,\n  e: true,\n  f: false,\n  g: {},\n}",
    );
    expect(witnessValue(at, text)).toStrictEqual({
      a: 0,
      b: -1,
      c: 9007199254740991,
      d: -9007199254740991,
      e: true,
      f: false,
      g: {},
    });
  });

  const values = {
    null: "{ a: null }",
    undefined: "{ a: undefined }",
    spread: "{ ...other }",
    "spread in an array": "{ a: [...other] }",
    "shorthand property": "{ a }",
    method: "{ a() {} }",
    getter: "{ get a() { return 1; } }",
    "computed key": '{ ["a"]: 1 }',
    "quoted key": '{ "a": 1 }',
    "numeric key": "{ 1: 1 }",
    "escaped key": `{ ${u("0061")}: 1 }`,
    "__proto__ key": "{ __proto__: 1 }",
    "upper-case key": "{ Type: 1 }",
    "duplicate key": "{ a: 1, a: 2 }",
    "template literal": "{ a: `x` }",
    "tagged template": "{ a: tag`x` }",
    call: "{ a: f() }",
    "new expression": "{ a: new Date() }",
    "as assertion": "{ a: 1 as number }",
    "angle-bracket assertion": "{ a: <number>1 }",
    "non-null assertion": "{ a: x! }",
    "nested satisfies": "{ a: 1 satisfies number }",
    "identifier value": "{ a: other }",
    "parenthesised value": "{ a: (1) }",
    "binary expression": "{ a: 1 + 1 }",
    "single-quoted string": "{ a: 'x' }",
    "hole in an array": "{ a: [1, , 2] }",
    "trailing hole": "{ a: [1, ,] }",
    fraction: "{ a: 1.5 }",
    exponent: "{ a: 1e2 }",
    "fraction zero": "{ a: 1.0 }",
    "negative zero": "{ a: -0 }",
    "above the safe range": "{ a: 9007199254740992 }",
    "below the safe range": "{ a: -9007199254740992 }",
    hexadecimal: "{ a: 0x1 }",
    "numeric separator": "{ a: 1_000 }",
    "unary plus": "{ a: +1 }",
    "double negative": "{ a: - -1 }",
    "negative string": '{ a: -"1" }',
    "regular expression": "{ a: /x/u }",
    "arrow function": "{ a: () => 1 }",
    "array root": "[]",
  };
  for (const [name, value] of Object.entries(values))
    it(`refuses ${name}`, () => {
      expect(witnessProblems(at, witness(value))).not.toEqual([]);
    });

  const good = witness(base);
  const modules = {
    "extra statement": `${good}other;\n`,
    "second export": `${good}export const other = {} satisfies ContentDoc;\n`,
    "default export": `${good}export default witness;\n`,
    "extra import": witness(base, {
      imports: `${contentImport.trim()}\nimport type { Body } from "../../../body.ts";\n\n`,
    }),
    "value import": witness(base, {
      imports: 'import { ContentDoc } from "../../../content.ts";\n\n',
    }),
    "inline type import": witness(base, {
      imports: 'import { type ContentDoc } from "../../../content.ts";\n\n',
    }),
    "wrong alias": witness(base, {
      imports: 'import type { ChapterFile } from "../../../content.ts";\n\n',
    }).replace("satisfies ContentDoc", "satisfies ChapterFile"),
    "renamed alias": witness(base, {
      imports:
        'import type { ContentDoc as Doc } from "../../../content.ts";\n\n',
    }).replace("satisfies ContentDoc", "satisfies Doc"),
    "second imported name": witness(base, {
      imports:
        'import type { ContentDoc, Order } from "../../../content.ts";\n\n',
    }),
    "namespace import": witness(base, {
      imports: 'import type * as C from "../../../content.ts";\n\n',
    }).replace("satisfies ContentDoc", "satisfies C.ContentDoc"),
    "wrong specifier": witness(base, {
      imports: 'import type { ContentDoc } from "../../content.ts";\n\n',
    }),
    "single-quoted specifier": witness(base, {
      imports: "import type { ContentDoc } from '../../../content.ts';\n\n",
    }),
    "import attributes": witness(base, {
      imports:
        'import type { ContentDoc } from "../../../content.ts" with { type: "json" };\n\n',
    }),
    "import after the export": `${witnessHead}export const witness = ${base} satisfies ContentDoc;\n${contentImport}`,
    "extra block comment": good.replace("order: 2,", "order: 2 /* x */,"),
    "extra line comment": good.replace("order: 2,", "order: 2, // x"),
    "trailing comment": `${good}// x\n`,
    "second header": witness(base, { head: `${witnessHead}${witnessHead}` }),
    "changed header": witness(base, {
      head: witnessHead.replace("grammar 1", "grammar 2"),
    }),
    "no header": witness(base, { head: "" }),
    "byte-order mark": `${String.fromCharCode(0xfeff)}${good}`,
    "carriage returns": good.replaceAll("\n", "\r\n"),
    "let declaration": good.replace("export const", "export let"),
    "unexported constant": good.replace("export const", "const"),
    "declare modifier": good.replace("export const", "export declare const"),
    "type annotation": good.replace("witness =", "witness: ContentDoc ="),
    "definite assignment": good.replace("witness =", "witness! ="),
    "other name": good.replace("witness =", "fixture ="),
    "two declarations": good.replace(
      "satisfies ContentDoc;",
      "satisfies ContentDoc, other = 1;",
    ),
    "satisfies another type": good.replace(
      "satisfies ContentDoc",
      "satisfies Object",
    ),
    "satisfies with type arguments": good.replace(
      "satisfies ContentDoc",
      "satisfies ContentDoc<1>",
    ),
    "double satisfies": good.replace(
      "satisfies ContentDoc;",
      "satisfies ContentDoc satisfies ContentDoc;",
    ),
    "parenthesised object": good
      .replace("witness = {", "witness = ({")
      .replace("} satisfies", "}) satisfies"),
    "as instead of satisfies": good.replace(
      "satisfies ContentDoc",
      "as ContentDoc",
    ),
    "syntax error": good.replace("order: 2,", "order: 2,,"),
  };
  for (const [name, text] of Object.entries(modules))
    it(`refuses a module with ${name}`, () => {
      expect(witnessProblems(at, text)).not.toEqual([]);
    });

  it("computes the specifier from the module's depth", () => {
    const shallow = witness(base, {
      imports: 'import type { ContentDoc } from "../content.ts";\n\n',
    });
    expect(witnessProblems("witness/a.ts", shallow)).toEqual([]);
    expect(witnessProblems(at, shallow)).not.toEqual([]);
  });
});

const typesHead =
  "// SharpLadder.Content type emitter output, grammar 1. Do not edit.\n\n";
const types = (body, head = typesHead) => `${head}${body}\n`;
const everyKind = [
  'import type { Body, Spans } from "./body.ts";',
  "",
  "export type Plain = string;",
  "",
  "export type Shape = {",
  '  type: "x";',
  "  order: 12;",
  "  low: -2;",
  "  flag?: boolean;",
  "  count: number;",
  "  none?: never;",
  "  list: Spans[];",
  "  some: [Body, ...Body[]];",
  "  mixed: (Plain | Body)[];",
  "};",
  "",
  "export type ContentDoc = Shape | Plain;",
].join("\n");

describe("type module grammar", () => {
  it("passes a module using every admitted node kind", () => {
    expect(typeModuleProblems("content.ts", types(everyKind))).toEqual([]);
  });

  const refused = {
    interface: "export interface Shape { a: string }",
    "unexported alias": "type Shape = string;",
    "generic alias": "export type Shape<T> = T;",
    "lower-case alias": "export type shape = string;",
    any: "export type Shape = any;",
    unknown: "export type Shape = unknown;",
    "object keyword": "export type Shape = object;",
    undefined: "export type Shape = undefined;",
    null: "export type Shape = null;",
    "boolean literal": "export type Shape = true;",
    intersection: "export type Shape = { a: string } & { b: string };",
    function: "export type Shape = () => void;",
    conditional: "export type Shape = A extends B ? C : D;",
    mapped: "export type Shape = { [K in A]: string };",
    "indexed access": 'export type Shape = A["a"];',
    typeof: "export type Shape = typeof x;",
    keyof: "export type Shape = keyof A;",
    "template literal type": "export type Shape = `a${string}`;",
    "type arguments": "export type Shape = Array<string>;",
    "qualified name": "export type Shape = A.B;",
    "readonly property": "export type Shape = { readonly a: string };",
    "method signature": "export type Shape = { a(): void };",
    "index signature": "export type Shape = { [k: string]: string };",
    "quoted property": 'export type Shape = { "a": string };',
    "__proto__ property": "export type Shape = { __proto__: string };",
    "single-quoted literal": "export type Shape = 'a';",
    "fraction literal": "export type Shape = 1.5;",
    "negative zero literal": "export type Shape = -0;",
    "unsafe literal": "export type Shape = 9007199254740992;",
    "fixed tuple": "export type Shape = [A, B];",
    "named tuple": "export type Shape = [a: A, ...rest: A[]];",
    "optional tuple element": "export type Shape = [A?, ...A[]];",
    "readonly array": "export type Shape = readonly A[];",
    "duplicate alias": "export type Shape = A;\n\nexport type Shape = B;",
    enum: "export enum Shape { A }",
    constant: "export const shape = 1;",
    "default export": "export default 1;",
    "extra comment": "// x\nexport type Shape = string;",
    "import in body.ts": 'import type { A } from "./content.ts";',
  };
  for (const [name, body] of Object.entries(refused))
    it(`refuses ${name}`, () => {
      const file = name === "import in body.ts" ? "body.ts" : "content.ts";
      expect(typeModuleProblems(file, types(body))).not.toEqual([]);
    });

  const imports = {
    "value import": 'import { Body } from "./body.ts";',
    "renamed import": 'import type { Body as B } from "./body.ts";',
    "other specifier": 'import type { Body } from "./other.ts";',
    "default import": 'import type Body from "./body.ts";',
  };
  for (const [name, line] of Object.entries(imports))
    it(`refuses a content module with a ${name}`, () => {
      const text = types(everyKind.replace(everyKind.split("\n")[0], line));
      expect(typeModuleProblems("content.ts", text)).not.toEqual([]);
    });

  it("refuses a content module without ContentDoc", () => {
    const text = types(everyKind.replace("ContentDoc", "Doc"));
    expect(typeModuleProblems("content.ts", text)).toEqual([
      "does not export ContentDoc",
    ]);
  });

  // The constraint each shape breaks, so a refusal for another reason does not pass.
  const constrained = {
    "empty object type": [
      "export type Probe = {};",
      "object type has no members",
    ],
    "empty object array": [
      "export type Probe = {}[];",
      "object type has no members",
    ],
    "empty tuple": ["export type Probe = [];", "tuple is not [T, ...T[]]"],
    "upper-case literal": [
      'export type Probe = "UPPER";',
      "outside the literal grammar",
    ],
    "escaped literal": [
      'export type Probe = "\\u0061";',
      "outside the literal grammar",
    ],
    "empty literal": ['export type Probe = "";', "outside the literal grammar"],
    "different tuple rest": [
      "export type Probe = [string, ...number[]];",
      "tuple rest does not repeat the first item type",
    ],
    "different nested tuple rest": [
      "export type Probe = [{ a: string }, ...{ a?: string }[]];",
      "tuple rest does not repeat the first item type",
    ],
    "single-member parentheses": [
      "export type Probe = (string)[];",
      "parentheses are not around an array or tuple element union",
    ],
    "parenthesised alias type": [
      "export type Probe = (A | B);",
      "parentheses are not around an array or tuple element union",
    ],
    "parenthesised property type": [
      "export type Probe = { a: (A | B) };",
      "parentheses are not around an array or tuple element union",
    ],
    "nested union": [
      "export type Probe = A | (B | C);",
      "union member is itself a union or parenthesised",
    ],
    "repeated union member": [
      "export type Probe = A | B | A;",
      "union repeats a member",
    ],
    "leading-bar single member": [
      "export type Probe = | A;",
      "union has fewer than two members",
    ],
    "never alias": ["export type Probe = never;", "never is not an optional"],
    "required never": [
      "export type Probe = { a: never };",
      "never is not an optional",
    ],
    "never element": [
      "export type Probe = { a?: never[] };",
      "never is not an optional",
    ],
    "duplicate property": [
      "export type Probe = { a: string; a: string };",
      "property a is declared twice",
    ],
    "reserved alias": ["export type Record = string;", "reserved alias name"],
  };
  for (const [name, [body, reason]] of Object.entries(constrained))
    it(`refuses ${name}`, () => {
      const problems = typeModuleProblems("body.ts", types(body));
      expect(problems.some((p) => p.includes(reason))).toBe(true);
    });

  it("refuses ContentDoc outside content.ts", () => {
    const text = types("export type ContentDoc = string;");
    expect(typeModuleProblems("body.ts", text)).toEqual([
      "ContentDoc: is a reserved alias name",
    ]);
  });

  // Emitter output for arrays and tuples of an At-most-one object.
  const variants = (pad) =>
    [
      `| {`,
      `    a?: string;`,
      `    b?: never;`,
      `  }`,
      `| {`,
      `    a?: never;`,
      `    b?: string;`,
      `  }`,
    ]
      .map((l) => pad + l)
      .join("\n");
  const elementForms = [
    `export type ProbeArray = (\n${variants("  ")}\n)[];`,
    `export type ProbeNested = (\n${variants("  ")}\n)[][];`,
    `export type ProbeTuple = [\n  (\n${variants("    ")}\n  ),\n  ...(\n${variants("    ")}\n  )[],\n];`,
    "export type ProbeRefs = [A | B, ...(A | B)[]];",
  ].join("\n\n");

  it("passes arrays and tuples of an object union", () => {
    expect(typeModuleProblems("body.ts", types(elementForms))).toEqual([]);
  });

  it("type-checks validator-accepted values against those forms", () => {
    const source = [
      elementForms,
      "type A = { type: 'a' };",
      "type B = { type: 'b' };",
      'export const one: ProbeArray = [{ a: "accepted" }, {}];',
      'export const two: ProbeNested = [[{ b: "accepted" }], []];',
      'export const three: ProbeTuple = [{ a: "x" }, { b: "y" }];',
      "export const four: ProbeRefs = [{ type: 'a' }, { type: 'b' }];",
      '// @ts-expect-error both of an at-most-one set\nexport const bad: ProbeArray = [{ a: "x", b: "y" }];',
      "// @ts-expect-error an empty non-empty tuple\nexport const none: ProbeTuple = [];",
    ].join("\n");
    const options = { strict: true, noEmit: true, types: [] };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, version) =>
      name === "probe.ts"
        ? ts.createSourceFile(name, source, version)
        : getSourceFile(name, version);
    const program = ts.createProgram(["probe.ts"], options, host);
    const found = ts
      .getPreEmitDiagnostics(program, program.getSourceFile("probe.ts"))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(found).toEqual([]);
  });

  it("refuses a changed header", () => {
    const head = typesHead.replace("type emitter", "witness emitter");
    expect(typeModuleProblems("body.ts", types("", head))).not.toEqual([]);
  });
});

describe("generated tree", () => {
  it("names the file for every problem and refuses stray modules", () => {
    const root = tree({
      "src/generated/body.ts": types("export type A = any;"),
      "src/generated/extra.ts": "export {};\n",
      "src/generated/witness/a.ts": witness("{ a: null }", {
        imports: 'import type { ContentDoc } from "../content.ts";\n\n',
      }),
    });
    const src = admitTree(join(root, "src"));
    const found = generatedProblems(src.root, src.admitted).sort();
    expect(found).toHaveLength(3);
    expect(found[0]).toMatch(
      /^src\/generated\/body\.ts: A: \w+ is not an admitted type node$/u,
    );
    expect(found[1]).toBe(
      "src/generated/extra.ts: is not a generated type or witness module",
    );
    expect(found[2]).toMatch(
      /^src\/generated\/witness\/a\.ts: witness\.a: \w+ is not an admitted value$/u,
    );
  });
});
