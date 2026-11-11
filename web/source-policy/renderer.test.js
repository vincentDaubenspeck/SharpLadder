// @vitest-environment node
import { ESLint } from "eslint";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isTestOnly, scriptViolations } from "../build-guard/classify.js";
import {
  buildFixture,
  cleanUp,
  fixture,
  link as linkFolder,
} from "../build-guard/fixture.js";
import { web } from "../eslint-rules/production-eslint.js";
import { checkProgram, describeFinding, parseSource } from "./index.js";
import {
  helperDigest,
  helperPins,
  rendererModules,
  rendererTests,
} from "./renderer.js";

afterAll(cleanUp);

const app = "sharpladder/app-capabilities";

// Probe paths that do not exist on disk open in a default project built from the real tsconfig.
const lint = new ESLint({
  cwd: web,
  overrideConfig: {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "src/Probe.ts",
            "src/content/Extra.tsx",
            "src/content/extra.test.tsx",
            "src/content-tests/extra.test.ts",
          ],
          defaultProject: "tsconfig.json",
        },
      },
    },
  },
});

const read = (unit) => readFileSync(join(web, "src", unit), "utf8");

// A negative is a real module with one exact edit, so every other line stays a passing form.
const mutate = (unit, from, to) => {
  const code = read(unit);
  if (!code.includes(from)) throw new Error(`no anchor ${from} in ${unit}`);
  return code.replace(from, to);
};

const build = (unit, code) => scriptViolations(code, `src/${unit}`, unit);

const eslint = async (unit, code) => {
  const [result] = await lint.lintText(code, { filePath: `src/${unit}` });
  expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  return result.messages.filter((m) => m.ruleId === app);
};

const blocks = "content/Blocks.tsx";
const link = "content/ContentLink.tsx";
const spans = "content/Spans.tsx";
const view = "content/ContentView.tsx";
const never = "content/assertNever.ts";
const href = "content/href.ts";
// A row that edits a pinned helper also expects this finding, so no row is exempt from the pin.
const pinChanged = (unit) => `src/${unit}: the reviewed helper source changed`;
const expectAll = (found, expected) => {
  for (const one of [expected].flat()) expect(found).toContain(one);
};
const anchor = "href={internalHref(link, slugs)}";
const listCall = "return <ListNode block={block} slugs={slugs} />;";
const para = "<p>\n          <Spans";
const labelSpan = "<span id={labelId}>";
const labelPre = "<pre aria-labelledby={labelId}>";
const divId = "<div id={block.id}>";
const hrefImport = 'import { internalHref, type SlugMap } from "./href.ts";';

const assigned = "an assignment is not admitted in the renderer";
const freshConst = "a loop must declare a fresh const";
const badCall = "this call is not admitted in a JSX renderer module";
const optional = "an optional, generic or spread call is not admitted";
const accessor = "an accessor or method is not admitted";
const asyncFn = "an async or generator function is not admitted";
const helperDeclaration = `${badCall}: a helper must be a top-level function declaration`;

// Each case is [name, unit, source, a text the finding must contain].
const refused = [
  // Component bindings.
  [
    "an alias of a component",
    blocks,
    mutate(
      blocks,
      listCall,
      `const L = ListNode;\n      return <L block={block} slugs={slugs} />;`,
    ),
    "component L is not a reviewed",
  ],
  [
    "a tag selected by data",
    blocks,
    mutate(blocks, listCall, `const T = block.type;\n      return <T />;`),
    "component T is not a reviewed",
  ],
  [
    "a lower-case tag selected by data",
    blocks,
    mutate(blocks, listCall, `const t = block.type;\n      return <t />;`),
    "element <t> is not admitted",
  ],
  [
    "a member tag",
    blocks,
    mutate(blocks, listCall, "return <Spans.x />;"),
    "plain reviewed binding",
  ],
  [
    "a destructured component",
    blocks,
    mutate(
      blocks,
      listCall,
      `const { L } = { L: ListNode };\n      return <L block={block} slugs={slugs} />;`,
    ),
    "component L is not a reviewed",
  ],
  [
    "a component taken from a parameter",
    blocks,
    `${read(blocks)}\nfunction Pick({ C }: { C: () => ReactElement }): ReactElement {\n  return <C />;\n}\n`,
    "component C is not a reviewed",
  ],
  [
    "a reassigned component function",
    blocks,
    mutate(blocks, listCall, `ListNode = SourceBlock;\n      ${listCall}`),
    "component ListNode is not a reviewed",
  ],
  [
    "a component inside a function",
    blocks,
    mutate(
      blocks,
      listCall,
      `function Inner(): ReactElement {\n        return <p />;\n      }\n      return <Inner />;`,
    ),
    "component Inner is not a reviewed",
  ],
  // Element factories and markup sinks.
  [
    "a computed createElement member",
    view,
    mutate(
      view,
      "switch (doc.type) {",
      'console.log(React["createElement"]);\n  switch (doc.type) {',
    ),
    "createElement is not admitted",
  ],
  [
    "a createElement member",
    view,
    mutate(
      view,
      "switch (doc.type) {",
      "console.log(React.cloneElement);\n  switch (doc.type) {",
    ),
    "cloneElement is not admitted",
  ],
  [
    "a computed innerHTML built from parts",
    view,
    mutate(
      view,
      "switch (doc.type) {",
      'const el = { a: 1 };\n  console.log(el["inner" + "HTML"]);\n  switch (doc.type) {',
    ),
    "non-literal key",
  ],
  [
    "a computed object key",
    view,
    mutate(
      view,
      "switch (doc.type) {",
      'const k = "x";\n  console.log({ [k]: 1 });\n  switch (doc.type) {',
    ),
    "computed property key",
  ],
  // Spreads.
  [
    "a spread on an element",
    blocks,
    mutate(blocks, para, `<p {...block}>\n          <Spans`),
    "JSX spread",
  ],
  [
    "a spread on a component",
    blocks,
    mutate(blocks, listCall, "return <ListNode {...{ block, slugs }} />;"),
    "JSX spread",
  ],
  // Imports.
  [
    "a jsx runtime import",
    view,
    `import { jsx } from "react/jsx-runtime";\n${read(view)}`,
    "import jsx from react/jsx-runtime is not admitted",
  ],
  [
    "a namespace import of React",
    view,
    `import * as R from "react";\n${read(view)}`,
    "default or namespace import from react",
  ],
  [
    "a default React import destructured to createElement",
    view,
    mutate(
      view,
      "switch (doc.type) {",
      "const { createElement: make } = React;\n  console.log(make);\n  switch (doc.type) {",
    ).replace(
      'import type { ReactElement } from "react";',
      'import React from "react";\nimport type { ReactElement } from "react";',
    ),
    "default or namespace import from react",
  ],
  [
    "the createElement key of that destructuring",
    view,
    mutate(
      view,
      "switch (doc.type) {",
      "const { createElement: make } = React;\n  console.log(make);\n  switch (doc.type) {",
    ),
    "createElement is not admitted",
  ],
  [
    "a renamed useRef",
    blocks,
    mutate(
      blocks,
      'import { useId } from "react";',
      'import { useId, useRef as keep } from "react";',
    ),
    "import useRef from react must keep its own name",
  ],
  [
    "useRef under its own name",
    blocks,
    mutate(
      blocks,
      'import { useId } from "react";',
      'import { useId, useRef } from "react";',
    ),
    "import useRef from react is not admitted",
  ],
  [
    "a renamed useId",
    blocks,
    mutate(
      blocks,
      'import { useId } from "react";',
      'import { useId as u } from "react";',
    ),
    "import useId from react must keep its own name",
  ],
  [
    "a value import of a React type",
    blocks,
    mutate(
      blocks,
      'import type { ReactElement } from "react";',
      'import { ReactElement } from "react";',
    ),
    "import ReactElement from react is not admitted",
  ],
  [
    "a react-dom import",
    view,
    `import { createPortal } from "react-dom";\n${read(view)}`,
    "from react-dom is not admitted",
  ],
  [
    "a value import from the generated types",
    view,
    mutate(view, "import type {\n  ChapterFile,", "import {\n  ChapterFile,"),
    "from ../generated/content.ts is not admitted",
  ],
  [
    "a witness import",
    view,
    `import type { witness } from "../generated/witness/chapters/fixture-basics/chapter.ts";\n${read(view)}`,
    "from ../generated/witness/",
  ],
  [
    "an import from outside the renderer",
    view,
    `import { App } from "../App.tsx";\n${read(view)}`,
    "import App from ../App.tsx is not admitted",
  ],
  [
    "a renderer import without its extension",
    view,
    mutate(view, 'from "./Blocks.tsx";', 'from "./Blocks";'),
    "import Blocks from ./Blocks is not admitted",
  ],
  [
    "an unexported name from a renderer module",
    view,
    mutate(
      view,
      'import { Blocks } from "./Blocks.tsx";',
      'import { Blocks, BlockNode } from "./Blocks.tsx";',
    ),
    "import BlockNode from ./Blocks.tsx is not admitted",
  ],
  [
    "a side-effect import",
    view,
    `import "./Blocks.tsx";\n${read(view)}`,
    "side-effect import",
  ],
  [
    "a type query through an import type",
    view,
    `${read(view)}\nexport type X = import("react").ReactNode;\n`,
    "this import form is not admitted",
  ],
  // Exports.
  [
    "an extra exported function",
    never,
    `${read(never)}export function extra(): void {}\n`,
    ["export extra is not in the module's frozen list", pinChanged(never)],
  ],
  [
    "an exported constant",
    never,
    `${read(never)}export const extra = 1;\n`,
    ["export of VariableDeclaration is not admitted", pinChanged(never)],
  ],
  [
    "a default export",
    never,
    `${read(never)}export default assertNever;\n`,
    ["only local named exports", pinChanged(never)],
  ],
  [
    "a re-export",
    spans,
    `${read(spans)}export { Blocks } from "./Blocks.tsx";\n`,
    "only local named exports",
  ],
  [
    "a renamed export",
    never,
    `${read(never)}export { assertNever as fail };\n`,
    ["must keep its own name", pinChanged(never)],
  ],
  [
    "a missing export",
    blocks,
    mutate(blocks, "export function Blocks(", "function Blocks("),
    "export Blocks is missing",
  ],
  // Module scope.
  [
    "a renderer file missing from the list",
    "content/Extra.tsx",
    read(never),
    "src/content/Extra.tsx is not in the renderer module list",
  ],
  [
    "a test file missing from the list",
    "content-tests/extra.test.ts",
    "export const x = 1;\n",
    "src/content-tests/extra.test.ts is not in the renderer module list",
  ],
  // href provenance.
  [
    "a literal href",
    link,
    mutate(link, anchor, 'href="#x"'),
    "href on <a> is not from",
  ],
  [
    "a template href",
    link,
    mutate(link, anchor, "href={`#${link.target}`}"),
    "href on <a> is not from",
  ],
  [
    "a variable holding the href",
    link,
    mutate(link, anchor, "href={h}").replace(
      "return (",
      "const h = internalHref(link, slugs);\n  return (",
    ),
    "href on <a> is not from",
  ],
  [
    "an alias of internalHref",
    link,
    mutate(link, anchor, "href={b(link, slugs)}").replace(
      "return (",
      "const b = internalHref;\n  return (",
    ),
    "href on <a> is not from",
  ],
  [
    "a renamed internalHref import",
    link,
    mutate(link, anchor, "href={b(link, slugs)}").replace(
      hrefImport,
      'import { internalHref as b, type SlugMap } from "./href.ts";',
    ),
    "href on <a> is not from",
  ],
  [
    "a conditional around the call",
    link,
    mutate(
      link,
      anchor,
      'href={link.content.length > 0 ? internalHref(link, slugs) : "#"}',
    ),
    "href on <a> is not from",
  ],
  [
    "a different first argument",
    link,
    mutate(link, anchor, "href={internalHref(other, slugs)}").replace(
      "return (",
      "const other = link;\n  return (",
    ),
    "href on <a> is not from",
  ],
  [
    "spread arguments",
    link,
    mutate(link, anchor, "href={internalHref(...args)}").replace(
      "return (",
      "const args = [link, slugs] as const;\n  return (",
    ),
    "href on <a> is not from",
  ],
  [
    "an extra argument",
    link,
    mutate(link, anchor, "href={internalHref(link, slugs, slugs)}"),
    "href on <a> is not from",
  ],
  [
    "a member call",
    link,
    mutate(link, anchor, "href={api.internalHref(link, slugs)}").replace(
      "return (",
      "const api = { internalHref };\n  return (",
    ),
    "href on <a> is not from",
  ],
  [
    "a reassigned link",
    link,
    mutate(link, "return (", 'link = { ...link, target: "x" };\n  return ('),
    "link is written",
  ],
  [
    "an inner function declaring internalHref",
    link,
    mutate(
      link,
      "return (",
      "function inner(internalHref: string): string {\n    return internalHref;\n  }\n  console.log(inner);\n  return (",
    ),
    "internalHref is declared more than once",
  ],
  [
    "an inner function declaring link",
    link,
    mutate(
      link,
      "return (",
      "const inner = (link: string): string => link;\n  console.log(inner);\n  return (",
    ),
    "link is declared more than once",
  ],
  [
    "a second element with href",
    link,
    mutate(
      link,
      "<LinkContent spans={link.content} />",
      `<LinkContent spans={link.content} />\n      <a ${anchor} />`,
    ),
    "must write exactly one href",
  ],
  [
    "href in Spans",
    spans,
    mutate(
      spans,
      "return <code>{span.text}</code>;",
      'return <a href="#x">{span.text}</a>;',
    ),
    "href on <a> is not from",
  ],
  [
    "href on a component",
    spans,
    mutate(
      spans,
      "return <ContentLink link={span} slugs={slugs} />;",
      'return <ContentLink link={span} slugs={slugs} href="#x" />;',
    ),
    "prop href is not admitted",
  ],
  [
    "a src attribute",
    link,
    mutate(link, "<a href", '<a src="x" href'),
    "attribute src is not admitted on <a>",
  ],
  // Intrinsic elements and attributes.
  [
    "a style element with a text child",
    blocks,
    mutate(
      blocks,
      para,
      "<p>\n          <style>{block.type}</style>\n          <Spans",
    ),
    "element <style> is not admitted",
  ],
  [
    "a script element with a text child",
    blocks,
    mutate(blocks, listCall, "return <script>{block.type}</script>;"),
    "element <script> is not admitted",
  ],
  ...["iframe", "svg", "section", "article", "img", "form", "h1", "button"].map(
    (tag) => [
      `an unlisted ${tag} element`,
      blocks,
      mutate(blocks, listCall, `return <${tag} />;`),
      `element <${tag}> is not admitted`,
    ],
  ),
  ...[
    ["className", "p"],
    ["title", "p"],
    ["data-x", "p"],
    ["aria-label", "p"],
    ["role", "p"],
    ["ref", "p"],
    ["id", "p"],
    ["lang", "p"],
  ].map(([attribute, tag]) => [
    `an unlisted ${attribute} attribute`,
    blocks,
    mutate(blocks, para, `<${tag} ${attribute}="x">\n          <Spans`),
    `attribute ${attribute} is not admitted on <${tag}>`,
  ]),
  [
    "an inline style",
    blocks,
    mutate(blocks, divId, '<div id={block.id} style={{ color: "red" }}>'),
    "attribute style is not admitted on <div>",
  ],
  [
    "an onClick handler",
    blocks,
    mutate(blocks, para, "<p onClick={() => undefined}>\n          <Spans"),
    "attribute onClick is not admitted on <p>",
  ],
  [
    "a mixed-case event attribute",
    blocks,
    mutate(blocks, para, "<p ONCLICK={() => undefined}>\n          <Spans"),
    "attribute ONCLICK is not admitted on <p>",
  ],
  [
    "an event prop on a component",
    blocks,
    mutate(
      blocks,
      listCall,
      "return <ListNode block={block} slugs={slugs} onFocus={undefined} />;",
    ),
    "prop onFocus is not admitted",
  ],
  [
    "a namespaced attribute",
    blocks,
    mutate(blocks, para, '<p xlink:href="x">\n          <Spans'),
    "namespaced attribute on <p>",
  ],
  [
    "a block id from the label",
    blocks,
    mutate(blocks, divId, "<div id={block.label}>"),
    "id on <div> is not from",
  ],
  [
    "a block id from the source",
    blocks,
    mutate(blocks, divId, "<div id={block.source}>"),
    "id on <div> is not from",
  ],
  [
    "a blockId anchor",
    blocks,
    mutate(blocks, divId, "<div id={block.blockId}>"),
    "id on <div> is not from",
  ],
  [
    "a group anchor",
    blocks,
    mutate(blocks, divId, "<div id={block.group}>"),
    "id on <div> is not from",
  ],
  [
    "a block id from a local object",
    blocks,
    mutate(blocks, divId, "<div id={copy.id}>").replace(
      "const labelId",
      "const copy = { id: labelId };\n  const labelId",
    ),
    "id on <div> is not from",
  ],
  [
    "a heading id from the title",
    view,
    mutate(view, "<h2 id={section.id}>", "<h2 id={section.title}>"),
    "id on <h2> is not from",
  ],
  [
    "a literal label id",
    blocks,
    mutate(blocks, labelSpan, '<span id="label">'),
    "id on <span> is not from",
  ],
  [
    "a label id from a local useId",
    blocks,
    `${mutate(blocks, 'import { useId } from "react";\n', "")}\nfunction useId(): string {\n  return "x";\n}\n`,
    "id on <span> is not from",
  ],
  [
    "a shadowed label variable",
    blocks,
    mutate(blocks, labelSpan, "<span id={labelId}>").replace(
      "<>\n          <span id={labelId}>{block.label}</span>",
      "<>\n          {[block.label].map((labelId) => (\n            <span key={labelId} id={labelId}>{labelId}</span>\n          ))}",
    ),
    "id on <span> is not from",
  ],
  [
    "aria-labelledby naming a different binding",
    blocks,
    mutate(blocks, labelPre, "<pre aria-labelledby={otherId}>").replace(
      "const labelId = useId();",
      "const labelId = useId();\n  const otherId = useId();",
    ),
    "aria-labelledby on <pre> is not from",
  ],
  [
    "aria-labelledby without the label",
    blocks,
    mutate(
      blocks,
      "<pre>{code}</pre>",
      "<pre aria-labelledby={labelId}>{code}</pre>",
    ),
    "aria-labelledby on <pre> is not from",
  ],
  [
    "an arbitrary list start",
    blocks,
    mutate(blocks, "<ol start={block.start}>", "<ol start={2}>"),
    "start on <ol> is not from",
  ],
  [
    "a start from another field",
    blocks,
    mutate(
      blocks,
      "<ol start={block.start}>",
      "<ol start={block.items.length}>",
    ),
    "start on <ol> is not from",
  ],
  // Writes, whatever their target, and the calls and constructs that could hide one.
  ...[
    ["block.id = ...", 'block.id = "x";', assigned],
    ["block.start = ...", "block.start = 2;", assigned],
    ["block.start++", "block.start++;", assigned],
    ["delete block.id", "delete block.id;", "delete is not admitted"],
    [
      "a destructuring write to block.id",
      '({ id: block.id } = { id: "x" });',
      assigned,
    ],
    ["a loop write to block.id", 'for (block.id of ["x"]) break;', freshConst],
    ["a nested write", 'block.items[0].blockId = "x";', assigned],
    [
      "a write through an alias",
      'const alias = block;\n  alias.id = "fabricated";',
      assigned,
    ],
    [
      "a write to a local copy",
      "const copy = { start: 1 };\n  copy.start = 2;",
      assigned,
    ],
    [
      "a loop write through an alias",
      'const alias = block;\n  for (alias.id of ["x"]) {}',
      freshConst,
    ],
    [
      "a for-in member target",
      "const alias = block;\n  for (alias.id in block) {}",
      freshConst,
    ],
    ["a let loop", "for (let x of block.items) x = item0;", freshConst],
    ["Object.assign", 'Object.assign(block, { id: "intro" });', badCall],
    ["Reflect.set", 'Reflect.set(block, "id", "x");', badCall],
    [
      "Object.defineProperty",
      'Object.defineProperty(block, "id", { value: "x" });',
      badCall,
    ],
    ["push", "block.items.push(block.items[0]);", badCall],
    ["sort", "block.items.sort();", badCall],
    ["splice", "block.items.splice(0, 1);", badCall],
    ["bind", "ListNode.bind(null);", badCall],
    ["call", "ListNode.call(null, { block, slugs });", badCall],
    ["apply", "ListNode.apply(null, [{ block, slugs }]);", badCall],
    ["map with Object.assign", "block.items.map(Object.assign);", badCall],
    [
      "map with a named callback",
      "const fn = (x: unknown) => x;\n  block.items.map(fn);",
      badCall,
    ],
    ["map with two arguments", "block.items.map((x) => x, null);", badCall],
    [
      "map on a local array",
      "const local = [1];\n  local.map((x) => x);",
      badCall,
    ],
    ["map on a call result", "Array.from(block.items).map((x) => x);", badCall],
    ["map on a computed chain", 'block["items"].map((x) => x);', badCall],
    ["map on an optional chain", "block.items?.map((x) => x);", badCall],
    ["an optional map call", "block.items.map?.((x) => x);", optional],
    ["a spread argument", "ListNode(...[{ block, slugs }]);", optional],
    ["new", "new Map();", "NewExpression is not admitted"],
    [
      "a tagged template",
      "String.raw`x`;",
      "TaggedTemplateExpression is not admitted",
    ],
    ["a class", "class Shadow {}", "ClassDeclaration is not admitted"],
    [
      "a class expression",
      "const Shadow = class {};",
      "ClassExpression is not admitted",
    ],
    ["a getter", "const o = { get id() { return 1; } };", accessor],
    ["a setter", "const o = { set id(v: string) {} };", accessor],
    ["a method", "const o = { id() { return 1; } };", accessor],
    ["an async map callback", "block.items.map(async (x) => x);", asyncFn],
    ["a generator", "function* gen() {}", asyncFn],
    ["an imported non-renderer name", "useState();", badCall],
    [
      "a shadowed renderer name",
      "const assertNever = (x: unknown) => x;\n  assertNever(block);",
      badCall,
    ],
    [
      "a reassigned local function",
      "let local = () => 1;\n  local = () => 2;\n  local();",
      badCall,
    ],
    [
      "map over the callback's array parameter",
      "block.items.map((item, index, array) => array.map((o) => o));",
      badCall,
    ],
    ["a counting for loop", "for (let i = 0; i < 1; i++) {}", assigned],
    [
      "a JSX spread child",
      "const spread = <p>{...block.items}</p>;",
      "JSX spread is not admitted in the renderer",
    ],
  ].map(([name, statement, expected]) => [
    `${name} in a renderer module`,
    blocks,
    mutate(
      blocks,
      "return block.ordered ? (",
      `${statement}\n  return block.ordered ? (`,
    ),
    expected,
  ]),
  [
    "a top-level const arrow helper",
    blocks,
    `${mutate(
      blocks,
      "return block.ordered ? (",
      "helper(1);\n  return block.ordered ? (",
    )}const helper = (x: number): number => x;\n`,
    helperDeclaration,
  ],
  [
    "Object.assign on a link",
    link,
    mutate(
      link,
      "  return (",
      '  Object.assign(link, { id: "intro" });\n  return (',
    ),
    badCall,
  ],
  [
    "a call of a global",
    blocks,
    mutate(
      blocks,
      "<li key={item.blockId}>",
      "<li key={String(item.blockId)}>",
    ),
    badCall,
  ],
  [
    "section.id = ... in a renderer module",
    view,
    mutate(
      view,
      "  return (\n    <>\n      <h2 id={section.id}>",
      '  section.id = "x";\n  return (\n    <>\n      <h2 id={section.id}>',
    ),
    assigned,
  ],
  [
    "a non-renderer file under content",
    "content/extra.test.tsx",
    "export const x = 1;\n",
    "src/content/extra.test.tsx is not in the renderer module list",
  ],
  // Assertions, any and code generation.
  [
    "an as assertion",
    view,
    mutate(view, "switch (doc.type) {", "switch ((doc as ContentDoc).type) {"),
    "type assertion TSAsExpression",
  ],
  [
    "an as const assertion",
    view,
    mutate(view, 'return "Syntax";', 'return "Syntax" as const;'),
    "type assertion TSAsExpression",
  ],
  [
    "an angle-bracket assertion",
    never,
    mutate(never, "JSON.stringify(value)", "JSON.stringify(<unknown>value)"),
    ["type assertion TSTypeAssertion", pinChanged(never)],
  ],
  [
    "a non-null assertion",
    view,
    mutate(view, "switch (doc.type) {", "switch (doc!.type) {"),
    "type assertion TSNonNullExpression",
  ],
  [
    "any in a renderer module",
    never,
    mutate(never, "value: never", "value: any"),
    ["any is not admitted", pinChanged(never)],
  ],
  [
    "eval in a renderer module",
    never,
    mutate(never, "JSON.stringify(value)", 'eval("1")'),
    ["reference to eval", pinChanged(never)],
  ],
  [
    "new Function in a renderer module",
    never,
    mutate(never, "JSON.stringify(value)", 'String(new Function("return 1"))'),
    ["reference to Function", pinChanged(never)],
  ],
  // Pinned helpers: any edit to their text, however small, is a finding until reviewed.
  [
    "a slugOf that writes its private map",
    href,
    mutate(
      href,
      "return this.#slugs.get(chapter);",
      'this.#slugs.set(chapter, "changed");\n    return this.#slugs.get(chapter);',
    ),
    pinChanged(href),
  ],
  [
    "a sort of the link content in internalHref",
    href,
    mutate(
      href,
      "const { id, chapter } = link;",
      "link.content.sort();\n  const { id, chapter } = link;",
    ),
    pinChanged(href),
  ],
  [
    "an Object.assign onto the link in internalHref",
    href,
    mutate(
      href,
      "const { id, chapter } = link;",
      'Object.assign(link, { id: "intro" });\n  const { id, chapter } = link;',
    ),
    pinChanged(href),
  ],
  [
    "a borrowed push onto the chapter list in buildSlugMap",
    href,
    mutate(
      href,
      "return new SlugMap(chapters);",
      "Array.prototype.push.call(chapters, chapters[0]);\n  return new SlugMap(chapters);",
    ),
    pinChanged(href),
  ],
  [
    "a whitespace-only edit of href.ts",
    href,
    mutate(
      href,
      "const { id, chapter } = link;",
      "const { id, chapter }  = link;",
    ),
    pinChanged(href),
  ],
  [
    "a comment-only edit of href.ts",
    href,
    mutate(href, "to the wrong page.", "to the wrong chapter."),
    pinChanged(href),
  ],
  [
    "a one-character edit of assertNever.ts",
    never,
    mutate(never, "Unknown content variant", "Unknown content varianT"),
    pinChanged(never),
  ],
];

// Rules that hold across all of src, tests and generated files included.
const refusedAnywhere = [
  [
    "dangerouslySetInnerHTML as an attribute",
    "content-tests/renderer.test.tsx",
    `${read("content-tests/renderer.test.tsx")}\nexport const d = <p dangerouslySetInnerHTML={{ __html: "x" }} />;\n`,
    "dangerouslySetInnerHTML is not admitted",
  ],
  [
    "dangerouslySetInnerHTML as an object key",
    "Probe.ts",
    'export const p = { "dangerouslySetInnerHTML": 1 };\n',
    "dangerouslySetInnerHTML is not admitted",
  ],
  [
    "innerHTML in a test",
    "content-tests/renderer.test.tsx",
    `${read("content-tests/renderer.test.tsx")}\nconsole.log(document.body.innerHTML);\n`,
    "innerHTML is not admitted",
  ],
  [
    "a literal outerHTML member",
    "Probe.ts",
    'export const f = (el: Element): string => el["outerHTML"];\n',
    "outerHTML is not admitted",
  ],
  [
    "a destructured insertAdjacentHTML",
    "Probe.ts",
    "export const f = ({ insertAdjacentHTML }: Element): unknown => insertAdjacentHTML;\n",
    "insertAdjacentHTML is not admitted",
  ],
  [
    "a srcdoc member",
    "Probe.ts",
    "export const f = (el: { srcdoc: string }): string => el.srcdoc;\n",
    "srcdoc is not admitted",
  ],
  [
    "@ts-ignore",
    "Probe.ts",
    "// @ts-ignore\nexport const x: number = 1;\n",
    "@ts-ignore is not admitted",
  ],
  [
    "@ts-nocheck",
    "Probe.ts",
    "/* @ts-nocheck */\nexport const x = 1;\n",
    "@ts-nocheck is not admitted",
  ],
  [
    "@ts-expect-error",
    "content-tests/href.test.ts",
    `${read("content-tests/href.test.ts")}\n// @ts-expect-error\nexport const x: string = 1;\n`,
    "@ts-expect-error is not admitted",
  ],
  [
    "an assertion in a generated file",
    "generated/body.ts",
    `${read("generated/body.ts")}\nexport const x = 1 as const;\n`,
    "type assertion TSAsExpression",
  ],
];

// Every admitted element, attribute form, fragment and key, in one module.
const allForms = `import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import type { CodeBlock, ListBlock } from "../generated/body.ts";
import type { ChapterSection } from "../generated/content.ts";

export function Blocks({
  block,
  list,
  section,
}: {
  block: CodeBlock;
  list: ListBlock;
  section: ChapterSection;
}): ReactElement {
  return (
    <>
      <Labelled key={block.blockId} block={block} />
      <Ordered block={list} />
      <Headings section={section} />
      <Inline />
    </>
  );
}

function Labelled({ block }: { block: CodeBlock }): ReactElement {
  const labelId = useId();
  return (
    <div id={block.id} key={block.blockId}>
      <span id={labelId}>{block.label}</span>
      <pre aria-labelledby={labelId}>
        <code>{block.source}</code>
      </pre>
    </div>
  );
}

function Ordered({ block }: { block: ListBlock }): ReactElement {
  return (
    <>
      <ol start={block.start}>
        {block.items.map((item) => (
          <li key={item.blockId}>x</li>
        ))}
      </ol>
      <ul>
        <li>y</li>
      </ul>
    </>
  );
}

function Headings({ section }: { section: ChapterSection }): ReactElement {
  return (
    <>
      <h2 id={section.id}>a</h2>
      <h3 id={section.id}>b</h3>
      <h2>c</h2>
      <h3>d</h3>
    </>
  );
}

function Inline(): ReactNode {
  return (
    <p>
      <em>e</em>
      <strong>s</strong>
      <a>t</a>
      <span>u</span>
      <code>v</code>
      <div>w</div>
    </p>
  );
}
`;

// Blocks.tsx with every admitted call form: a top-level function, a renderer import, useId,
// and map over a prop, a prop member and a map callback's parameter.
const callForms = `${read(blocks)}
function Probe({
  rows,
  block,
}: {
  rows: readonly { cells: readonly ListBlock[] }[];
  block: ListBlock;
}): ReactElement {
  const id = useId();
  return (
    <span id={id}>
      {rows.map((row) => row.cells.map((cell) => Shown({ block: cell })))}
      {block.items.map((item) => (
        <li key={item.blockId}>{assertNever(item)}</li>
      ))}
    </span>
  );
}

function Shown({ block }: { block: ListBlock }): ReactElement {
  return <ol start={block.start}>{Probe({ rows: [], block })}</ol>;
}
`;

const allowed = [
  ...[...rendererModules.keys()].map((unit) => [
    `the real ${unit}`,
    unit,
    read(unit),
  ]),
  ...[...helperPins.keys()].map((unit) => [
    `the real ${unit} with CRLF line endings`,
    unit,
    read(unit).replaceAll("\n", "\r\n"),
  ]),
  ...[...rendererTests].map((unit) => [`the real ${unit}`, unit, read(unit)]),
  ["the generated body types", "generated/body.ts", read("generated/body.ts")],
  [
    "the generated content types",
    "generated/content.ts",
    read("generated/content.ts"),
  ],
  ["every admitted element and attribute form", blocks, allForms],
  [
    "a literal key",
    blocks,
    mutate(blocks, "<li key={item.blockId}>", '<li key="fixed">'),
  ],
  ["every admitted call form", blocks, callForms],
];

const bomFinding = (unit) =>
  `src/${unit}: a reviewed helper must not start with a byte order mark`;
const endings = (unit) => [
  ["LF", read(unit)],
  ["CRLF", read(unit).replaceAll("\n", "\r\n")],
];
// ESLint strips up to two marks before a rule runs, so every count must give the one finding.
const marked = [...helperPins.keys()].flatMap((unit) =>
  [1, 2, 3].flatMap((count) =>
    endings(unit).map(([ending, text]) => [
      `${unit} behind ${String(count)} byte order mark(s) with ${ending}`,
      unit,
      "﻿".repeat(count) + text,
    ]),
  ),
);

describe("the renderer rules in the build check", () => {
  it.each(refused)("refuses %s", (_name, unit, code, expected) => {
    expectAll(build(unit, code).join("\n"), expected);
  });

  it.each(refusedAnywhere)("refuses %s", (_name, unit, code, expected) => {
    expectAll(build(unit, code).join("\n"), expected);
  });

  it.each(allowed)("allows %s", (_name, unit, code) => {
    expect(build(unit, code)).toEqual([]);
  });

  it.each(marked)("refuses %s", (_name, unit, code) => {
    expect(build(unit, code)).toEqual([bomFinding(unit)]);
  });

  it("keeps the anchors of the real modules", () => {
    expect(read(link).split("href=").length).toBe(2);
    expect(read(link)).toContain(anchor);
  });
});

// ESLint must agree finding for finding with the build check.
describe("the renderer rules in ESLint", () => {
  const agrees = async (unit, code) => {
    const fromBuild = build(unit, code);
    const messages = await eslint(unit, code);
    expect(messages.length).toBe(fromBuild.length);
    const renderer = messages
      .filter((m) => m.messageId === "renderer")
      .map((m) => m.message.slice(0, -1));
    expect(renderer.sort()).toEqual(
      fromBuild.filter((f) => !f.startsWith("reference to ")).sort(),
    );
    return fromBuild;
  };

  it.each([...refused, ...refusedAnywhere])(
    "refuses %s",
    async (_name, unit, code, expected) => {
      expectAll((await agrees(unit, code)).join("\n"), expected);
    },
  );

  it.each(allowed)("allows %s", async (_name, unit, code) => {
    expect(await agrees(unit, code)).toEqual([]);
  });

  it.each(marked)("refuses %s", async (_name, unit, code) => {
    expect(await agrees(unit, code)).toEqual([bomFinding(unit)]);
  });
}, 120_000);

describe("the reviewed helper pins", () => {
  const helpers = [...rendererModules.keys()].filter((u) => u.endsWith(".ts"));
  const raw = (unit) => readFileSync(join(web, "src", unit));

  it("pin exactly the renderer modules that are not JSX", () => {
    expect([...helperPins.keys()].sort()).toEqual(helpers.sort());
  });

  it.each(helpers)("binds the pin of %s to the file on disk", (unit) => {
    expect(helperDigest(raw(unit).toString("utf8"))).toBe(helperPins.get(unit));
  });

  it.each(helpers)(
    "hashes %s alike under LF and CRLF and apart behind a byte order mark",
    (unit) => {
      const lf = read(unit);
      expect(lf).not.toContain("\r");
      const crlf = lf.replaceAll("\n", "\r\n");
      const digest = helperDigest(lf);
      expect(helperDigest(crlf)).toBe(digest);
      expect(helperDigest(`\uFEFF${lf}`)).not.toBe(digest);
      expect(helperDigest(`\uFEFF${crlf}`)).not.toBe(digest);
      expect(helperDigest(`${lf} `)).not.toBe(digest);
    },
  );

  it("refuses a pinned helper checked without its source text", () => {
    const { ast, scopeManager } = parseSource(read(never), `src/${never}`);
    expect(checkProgram(ast, scopeManager, never).map(describeFinding)).toEqual(
      [`src/${never} has no source text to check against its pin`],
    );
  });
});

// The file system decides whether a second letter case names the same file.
const caseBlind = existsSync(join(web, "src", "CONTENT", "href.ts"));
const copied = [
  "eslint-rules/app-capabilities.js",
  "source-policy/index.js",
  "source-policy/renderer.js",
  "source-policy/unit.js",
];
// A file name in capitals with its extension kept, since ESLint selects files by extension.
const shout = (unit) => {
  const name = unit.slice("content/".length);
  const dot = name.lastIndexOf(".");
  return name.slice(0, dot).toUpperCase() + name.slice(dot);
};
// The names one file can be linted under: its own, a folder link, and another letter case.
const spellings = [
  ["", (unit) => `src/${unit}`],
  [
    " through a folder link",
    (unit) => `src/same/${unit.slice("content/".length)}`,
  ],
  ...(caseBlind
    ? [[" under another letter case", (unit) => `src/CONTENT/${shout(unit)}`]]
    : []),
];

// Run from inside a copy of the tree, so the copied rule finds its units beside it.
const diskLinter = `import parser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import rule from "./eslint-rules/app-capabilities.js";

const root = import.meta.dirname;
const id = "sharpladder/app-capabilities";
const lint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["src/**/*.ts"],
      languageOptions: { parser },
      plugins: { sharpladder: { rules: { "app-capabilities": rule } } },
      rules: { [id]: "error" },
    },
  ],
});
const found = [];
for (const [unit, code, spelled] of JSON.parse(
  readFileSync(join(root, "cases.json"), "utf8"),
)) {
  writeFileSync(join(root, "src", unit), code);
  const [result] = await lint.lintFiles([spelled]);
  found.push({
    fatal: result.messages.filter((m) => m.fatal).length,
    messages: result.messages.filter((m) => m.ruleId === id).map((m) => m.message),
  });
}
process.stdout.write(JSON.stringify(found));
`;

describe("the helper pins on files ESLint reads from disk", () => {
  const plain = [
    ...[...helperPins.keys()].flatMap((unit) =>
      endings(unit).map(([ending, text]) => [
        `allows ${unit} with ${ending}`,
        unit,
        text,
        [],
      ]),
    ),
    ...marked.map(([name, unit, code]) => [
      `refuses ${name}`,
      unit,
      code,
      [`${bomFinding(unit)}.`],
    ]),
    ...[...helperPins.keys()].map((unit) => [
      `refuses a comment added to ${unit}`,
      unit,
      `${read(unit)}// Added.\n`,
      [
        `${pinChanged(unit)}; update its pin only after a review of the whole helper.`,
      ],
    ]),
  ];
  // The lower case of the capital in the first name is two characters; folding it must not move
  // the file out of the renderer folder. The second name is the control.
  const unlisted = ["content/İ.ts", "content/Probe.ts"].map((unit) => [
    `refuses the unlisted ${unit}`,
    unit,
    "export const x = 1;\n",
    [`src/${unit} is not in the renderer module list.`],
  ]);
  // Every row runs again under each other name the file system gives the same file.
  const rows = spellings.flatMap(([how, spell]) =>
    [...plain, ...unlisted].map(([name, unit, code, expected]) => [
      `${name}${how}`,
      unit,
      code,
      expected,
      spell(unit),
    ]),
  );
  let found = [];

  // One child lints every row in turn, since each row rewrites the same file on disk.
  beforeAll(() => {
    const { root } = fixture({
      "package.json": '{ "type": "module" }\n',
      "lint-cases.mjs": diskLinter,
      "cases.json": JSON.stringify(
        rows.map(([, unit, code, , spelled]) => [unit, code, spelled]),
      ),
      ...Object.fromEntries(
        copied.map((path) => [path, readFileSync(join(web, path), "utf8")]),
      ),
    });
    linkFolder(join(root, "src", "content"), join(root, "src", "same"));
    const run = spawnSync(process.execPath, ["lint-cases.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
    });
    if (run.error) throw run.error;
    if (run.signal !== null || run.status !== 0)
      throw new Error(`the lint child failed: ${run.stderr}`);
    found = JSON.parse(run.stdout);
  }, 120_000);

  it("lints every row", () => {
    expect(found.length).toBe(rows.length);
  });

  it.each(rows.map(([name, , , expected], index) => [name, expected, index]))(
    "%s",
    (_name, expected, index) => {
      expect(found[index]).toEqual({ fatal: 0, messages: expected });
    },
  );
});

const cliConfig = `import parser from "@typescript-eslint/parser";
import rule from "./eslint-rules/app-capabilities.js";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser },
    plugins: { sharpladder: { rules: { "app-capabilities": rule } } },
    rules: { "sharpladder/app-capabilities": "error" },
  },
];
`;

describe("the helper pins through the ESLint command line", () => {
  const edits = {
    [never]: [`\uFEFF${read(never)}`, `${bomFinding(never)}.`],
    [href]: [
      `${read(href)}// Added.\n`,
      `${pinChanged(href)}; update its pin only after a review of the whole helper.`,
    ],
  };
  const cases = spellings.flatMap(([how, spell]) =>
    Object.entries(edits).map(([unit, [, expected]]) => [
      `refuses the edited ${unit}${how}`,
      spell(unit),
      expected,
    ]),
  );
  let results = [];

  beforeAll(() => {
    const { root } = fixture({
      "package.json": '{ "type": "module" }\n',
      "eslint.config.mjs": cliConfig,
      ...Object.fromEntries(
        copied.map((path) => [path, readFileSync(join(web, path), "utf8")]),
      ),
      ...Object.fromEntries(
        Object.entries(edits).map(([unit, [code]]) => [`src/${unit}`, code]),
      ),
    });
    linkFolder(join(root, "src", "content"), join(root, "src", "same"));
    const run = spawnSync(
      process.execPath,
      [
        join(web, "node_modules", "eslint", "bin", "eslint.js"),
        "--format",
        "json",
        ...cases.map(([, spelled]) => spelled),
      ],
      { cwd: root, encoding: "utf8", timeout: 90_000 },
    );
    if (run.error) throw run.error;
    if (run.status !== 1)
      throw new Error(
        `the lint command gave ${String(run.status)}: ${run.stderr}`,
      );
    results = JSON.parse(run.stdout);
  }, 120_000);

  it("reports on every name it was given", () => {
    expect(results.length).toBe(cases.length);
  });

  it.each(cases.map(([name, , expected], index) => [name, expected, index]))(
    "%s",
    (_name, expected, index) => {
      // ESLint reports in its own order, so each result is found by the name it was given.
      const spelled = `/${cases[index][1]}`;
      const mine = results.filter((r) =>
        r.filePath.replaceAll("\\", "/").endsWith(spelled),
      );
      expect(mine.map((r) => r.messages.map((m) => m.message))).toEqual([
        [expected],
      ]);
    },
  );
});

// The production configuration, with each file named as an editor or a caller might name it.
describe.runIf(caseBlind)(
  "the renderer rules under another letter case",
  () => {
    const upper = (unit) => `src/CONTENT/${unit.slice("content/".length)}`;
    const mixed = (unit) => `src/Content/${shout(unit)}`;
    const named = async (path, code) => {
      const [result] = await lint.lintText(code, { filePath: path });
      expect(result.messages.filter((m) => m.fatal)).toEqual([]);
      return result.messages
        .filter((m) => m.ruleId === app)
        .map((m) => m.message);
    };
    const aliases = [...helperPins.keys()].flatMap((unit) => [
      [upper(unit), unit],
      [mixed(unit), unit],
      [join(web, upper(unit)), unit],
    ]);

    it.each(aliases)(
      "allows the unchanged helper as %s",
      async (path, unit) => {
        expect(await named(path, read(unit))).toEqual([]);
      },
    );

    it.each(aliases)("refuses a comment added as %s", async (path, unit) => {
      expect(await named(path, `${read(unit)}// Added.\n`)).toEqual([
        `${pinChanged(unit)}; update its pin only after a review of the whole helper.`,
      ]);
    });

    it.each(
      aliases.flatMap(([path, unit]) => [1, 2, 3].map((n) => [n, path, unit])),
    )("refuses %i byte order mark(s) as %s", async (count, path, unit) => {
      expect(await named(path, "\uFEFF".repeat(count) + read(unit))).toEqual([
        `${bomFinding(unit)}.`,
      ]);
    });

    // ESLint selects files by extension as written, so this name never reaches the rule; the
    // lint script fails on the warning, and the build reads the real file whatever it is called.
    it("leaves a capital extension to ESLint, which does not lint the file", async () => {
      const [result] = await lint.lintText(`${read(href)}// Added.\n`, {
        filePath: "src/content/href.TS",
        warnIgnored: true,
      });
      expect(result.messages.map((m) => [m.severity, m.ruleId])).toEqual([
        [1, null],
      ]);
      expect(result.messages[0].message).toMatch(/^File ignored/u);
    });

    it.each([blocks, spans, link, view])(
      "applies the JSX rules to %s under another letter case",
      async (unit) => {
        const code = `${read(unit)}export const extra = 1;\n`;
        const expected = await named(`src/${unit}`, code);
        expect(expected.join("\n")).toContain("is not admitted");
        expect(await named(upper(unit), code)).toEqual(expected);
        expect(await named(mixed(unit), code)).toEqual(expected);
      },
    );
  },
  240_000,
);

describe("a path that only looks like a renderer path", () => {
  const lookalike = (unit) =>
    `src/${unit} differs from a renderer path only in letter case`;

  it.each([
    ["CONTENT/assertNever.ts", never],
    ["Content/href.ts", href],
    ["content/HREF.ts", href],
    ["CONTENT/Blocks.tsx", blocks],
    ["content/blocks.tsx", blocks],
    ["CONTENT/New.ts", null],
    ["Generated/body.ts", null],
    ["GENERATED/New.ts", null],
    ["Content-Tests/href.test.ts", null],
    ["content/Round-Trip.test.tsx", null],
  ])("is refused as %s", (unit, real) => {
    const code = real === null ? "export {};\n" : read(real);
    expect(build(unit, code)).toContain(lookalike(unit));
  });

  it.each([
    never,
    href,
    blocks,
    "content/New.ts",
    "contents/New.ts",
    "App.tsx",
  ])("is not reported for %s", (unit) => {
    expect(build(unit, "export {};\n").join("\n")).not.toContain(
      "only in letter case",
    );
  });

  it("is test-only under any letter case of its folder", () => {
    for (const unit of ["content/a.ts", "CONTENT/a.ts", "Generated/a.ts"])
      expect(isTestOnly(unit)).toBe(true);
    for (const unit of ["contents/a.ts", "content", "App.tsx", null])
      expect(isTestOnly(unit)).toBe(false);
  });
});

describe("a name ESLint is given that is not a source name", () => {
  it.each([
    ["a stream", `src/${href}:zone`],
    ["a trailing dot", `src/${href}.`],
    ["a trailing space", `src/${href} `],
  ])("is never linted clean as %s", async (_name, path) => {
    const [result] = await lint.lintText(read(href), { filePath: path });
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

describe("the helper pins in a real build", () => {
  const main = { "src/main.tsx": "console.log(1);\n" };
  const rejects = async (unit, code, pattern) => {
    const error = await buildFixture({ ...main, [`src/${unit}`]: code }).then(
      () => null,
      (e) => e,
    );
    expect(error?.message).toMatch(/build guard: /u);
    expect(error?.message).toMatch(pattern);
  };

  it("builds an app that imports neither helper", async () => {
    await expect(buildFixture(main)).resolves.toBeDefined();
  });

  it.each([...helperPins.keys()])(
    "fails on a comment added to %s",
    async (unit) => {
      await rejects(
        unit,
        `${read(unit)}// Added.\n`,
        /the reviewed helper source changed/u,
      );
    },
  );

  it.each(marked)("fails on %s", async (_name, unit, code) => {
    await rejects(unit, code, /must not start with a byte order mark/u);
  });

  it.each([...rendererModules.keys()])("fails without %s", async (unit) => {
    await rejects(unit, null, /cannot be read/u);
  });

  it.each([blocks, spans, link, view])(
    "fails on a forbidden edit to %s, which nothing imports",
    async (unit) => {
      await rejects(
        unit,
        `${read(unit)}export const extra = 1;\n`,
        /export of VariableDeclaration is not admitted/u,
      );
    },
  );

  it("fails when a listed module is on disk under another letter case", async () => {
    const error = await buildFixture({
      ...main,
      [`src/${href}`]: null,
      "src/content/HREF.ts": read(href),
    }).then(
      () => null,
      (e) => e,
    );
    expect(error?.message).toMatch(
      /build guard: src\/content\/href\.ts (?:is on disk as src\/content\/HREF\.ts|cannot be read)/u,
    );
  });
}, 240_000);

describe("the frozen renderer file list", () => {
  it("matches the files under src/content and src/content-tests exactly", () => {
    const list = (dir) =>
      readdirSync(join(web, "src", dir))
        .map((name) => `${dir}/${name}`)
        .sort();
    const admitted = [...rendererModules.keys(), ...rendererTests];
    const of = (dir) => admitted.filter((u) => u.startsWith(`${dir}/`)).sort();
    expect(list("content")).toEqual(of("content"));
    expect(list("content-tests")).toEqual(of("content-tests"));
  });

  it("pins the round trip and its declaration under src/content", () => {
    expect([...rendererTests].filter((u) => u.startsWith("content/"))).toEqual([
      "content/round-trip.test.tsx",
      "content/provided.d.ts",
    ]);
  });
});

describe("exhaustive switches", () => {
  const probe = (cases) => `type Kind = "a" | "b" | "c";
function assertNever(value: never): never {
  throw new Error(String(value));
}
export function name(kind: Kind): string {
  switch (kind) {
${cases}
    default:
      return assertNever(kind);
  }
}
`;
  const rule = "@typescript-eslint/switch-exhaustiveness-check";
  const findings = async (code) => {
    const [result] = await lint.lintText(code, { filePath: "src/Probe.ts" });
    return result.messages.filter((m) => m.ruleId === rule || m.fatal);
  };

  it("passes a full switch whose default calls assertNever", async () => {
    const all = ['"a"', '"b"', '"c"'].map(
      (c) => `    case ${c}:\n      return ${c};`,
    );
    expect(await findings(probe(all.join("\n")))).toEqual([]);
  });

  it("fails a missing case even with a default", async () => {
    const two = ['"a"', '"b"'].map((c) => `    case ${c}:\n      return ${c};`);
    const found = await findings(probe(two.join("\n")));
    expect(found.map((m) => m.ruleId)).toEqual([rule]);
  });
}, 60_000);

describe("the production import graph", () => {
  const main = (target) =>
    buildFixture({
      "src/main.tsx": `import { assertNever } from "${target}";\nconsole.log(assertNever);\n`,
      "src/content/assertNever.ts": read(never),
      "src/content-tests/href.test.ts": read(never),
      "src/generated/witness/w.ts": read(never),
      "../harness/entry.ts": read(never),
    });
  const rejects = async (target, pattern) => {
    const error = await main(target).then(
      () => null,
      (e) => e,
    );
    expect(error?.message).toMatch(/build guard: /u);
    expect(error?.message).toMatch(pattern);
  };

  it("fails when production reaches the renderer", async () => {
    await rejects(
      "./content/assertNever.ts",
      /test-only module content\/assertNever\.ts/u,
    );
  });

  it("fails when production reaches a renderer test", async () => {
    await rejects(
      "./content-tests/href.test.ts",
      /test-only module content-tests\/href\.test\.ts/u,
    );
  });

  it("fails when production reaches a witness", async () => {
    await rejects(
      "./generated/witness/w.ts",
      /test-only module generated\/witness\/w\.ts/u,
    );
  });

  // The lower case of this capital is two characters; the file keeps its place under content.
  it.each([
    ["content/İ.ts", "content/İ.ts"],
    ["content/İ/in.ts", "content/İ/in.ts"],
    ["content/Probe.ts", "content/Probe.ts"],
  ])("fails when production reaches the unlisted %s", async (unit, shown) => {
    const error = await buildFixture({
      "src/main.tsx": `import { x } from "./${unit}";\nconsole.log(x);\n`,
      [`src/${unit}`]: "export const x = 1;\n",
    }).then(
      () => null,
      (e) => e,
    );
    expect(error?.message).toMatch(/build guard: /u);
    expect(error?.message).toContain(shown);
  });

  it("fails when production reaches the harness", async () => {
    await rejects("../../harness/entry.ts", /outside src/u);
  });

  it("applies the renderer rules to a renderer module in a real build", async () => {
    const files = {
      "src/main.tsx":
        'import { Spans } from "./content/Spans.tsx";\nconsole.log(Spans);\n',
      "src/generated/body.ts": read("generated/body.ts"),
      "src/generated/content.ts": read("generated/content.ts"),
    };
    for (const unit of rendererModules.keys())
      files[`src/${unit}`] = read(unit);
    // The edit is in a module with no pin, so only the transform hook can report it.
    files[`src/${spans}`] = `${read(spans)}export const extra = 1;\n`;
    const error = await buildFixture(files).then(
      () => null,
      (e) => e,
    );
    expect(error?.message).toMatch(
      /export of VariableDeclaration is not admitted/u,
    );
  });

  it("builds while renderer modules and their tests import each other off the production graph", async () => {
    const files = { "src/main.tsx": "console.log(1);\n" };
    for (const unit of [...rendererModules.keys(), ...rendererTests])
      files[`src/${unit}`] = read(unit);
    await expect(buildFixture(files)).resolves.toBeDefined();
  });
}, 120_000);
