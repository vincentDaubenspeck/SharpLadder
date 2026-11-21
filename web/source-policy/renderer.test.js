// @vitest-environment node
import { ESLint } from "eslint";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  guardContext,
  isTestOnly,
  rendererScan,
  scriptViolations,
  sourceUnit,
} from "../build-guard/classify.js";
import { buildFixture, cleanUp, fixture } from "../build-guard/fixture.js";
import rule from "../eslint-rules/app-capabilities.js";
import { web } from "../eslint-rules/production-eslint.js";
import { checkProgram, describeFinding, parseSource } from "./index.js";
import {
  helperDigest,
  helperPins,
  modulePins,
  pinnedUnits,
  rendererModules,
  rendererTests,
} from "./renderer.js";

afterAll(cleanUp);

const app = "sharpladder/app-capabilities";

// Probe paths that do not exist on disk open in a default project built from the real tsconfig.
const probeProject = {
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
};
const lint = new ESLint({ cwd: web, overrideConfig: probeProject });

const read = (unit) => readFileSync(join(web, "src", unit), "utf8");

// A negative is a real module with one exact edit, so every other line stays a passing form.
const mutate = (unit, from, to) => {
  const code = read(unit);
  const present =
    typeof from === "string" ? code.includes(from) : from.test(code);
  if (!present) throw new Error(`no anchor ${String(from)} in ${unit}`);
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
const entries = "content/Entries.tsx";
const cards = "content/Cards.tsx";
const picker = "content/ApproachPicker.tsx";
const buildView = "content/Build.tsx";
const approach = "content/approach.ts";
const pickerType = '          type="button"\n';
const pickerPressed = "aria-pressed={choice.id === pressed}";
const pickerHandler = "onClick={() => {";
const pickerCall = "onChoose(choice.id);";
const pickerGroup = '<div role="group" aria-label="Build approaches">';
const handedDown = "onApproachChange={onApproachChange}";
const hintsView = "content/Hints.tsx";
const hintsHelper = "content/hints.ts";
const hintHandedDown = "onHintChange={onHintChange}";
const approachChooser = "onApproachChange(sectionId, id);";
const term = "content/Term.tsx";
const termId = "const definition = useId();";
const termTarget = "popoverTarget={definition}";
const termAction = 'popoverTargetAction="toggle"';
const termMode = 'popover="auto"';
const termLink = "<a href={termHref(term)}>Definition</a>";
const notSource = (name, tag) =>
  `${name} on <${tag}> is not from its admitted source`;
const never = "content/assertNever.ts";
const href = "content/href.ts";
// A row that edits a pinned helper also expects this finding, so no row is exempt from the pin.
const noun = (unit) => (unit.endsWith(".tsx") ? "module" : "helper");
const pinChanged = (unit) =>
  `src/${unit}: the reviewed ${noun(unit)} source changed`;
const pinReview = (unit) =>
  `${pinChanged(unit)}; update its pin only after a review of ${
    unit.endsWith(".tsx")
      ? "the whole module, its dependencies and its behaviour tests"
      : "the whole helper"
  }`;
const walkStepper = "content/WalkStepper.tsx";
const pinned = [...helperPins.keys(), ...modulePins.keys()];
const expectAll = (found, expected) => {
  for (const one of [expected].flat()) expect(found).toContain(one);
};
const anchor = "href={internalHref(link, slugs)}";
const listCall = "return <ListNode block={block} slugs={slugs} />;";
const para = "<p data-block-id={block.blockId}>\n          <Spans";
const labelSpan = "<span id={labelId}>";
const labelPre = "<pre aria-labelledby={labelId}>";
const divId = "<div id={block.id} data-block-id={block.blockId}>";
const frozenIntro = "<p data-block-id={block.sequences[0].introBlockId}>";
const controlledAnnounce = "announce={walkControl.shownOf(block.id).announce}";
const hrefImport = 'import { internalHref, type SlugMap } from "./href.ts";';

const assigned = "an assignment is not admitted in the renderer";
const freshConst = "a loop must declare a fresh const";
const badCall = "this call is not admitted in a JSX renderer module";
const optional = "an optional, generic or spread call is not admitted";
const accessor = "an accessor or method is not admitted";
const asyncFn = "an async or generator function is not admitted";
const helperDeclaration = `${badCall}: a helper must be a top-level function declaration`;
const componentCall = `${badCall}: a component renders only through its tag`;
const plainHelper = `${badCall}: a called helper must declare a return type of plain values`;

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
    "selectHints in a renderer module",
    hintsView,
    mutate(
      hintsView,
      'import { checkedHintsView } from "./hints.ts";',
      'import { checkedHintsView, selectHints } from "./hints.ts";',
    ),
    "import selectHints from ./hints.ts is withheld from renderer modules",
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
  ...[
    "iframe",
    "svg",
    "aside",
    "article",
    "img",
    "form",
    "h1",
    "button",
    "caption",
    "col",
    "colgroup",
    "tfoot",
  ].map((tag) => [
    `an unlisted ${tag} element`,
    blocks,
    mutate(blocks, listCall, `return <${tag} />;`),
    `element <${tag}> is not admitted`,
  ]),
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
  ...[
    [
      "<table data-block-id={block.blockId}>",
      '<table data-block-id={block.blockId} border="1">',
      "attribute border is not admitted on <table>",
    ],
    [
      "<table data-block-id={block.blockId}>",
      "<table data-block-id={block.blockId} id={block.blockId}>",
      "attribute id is not admitted on <table>",
    ],
    [
      "<table data-block-id={block.blockId}>",
      "<table data-block-id={block.headers}>",
      "data-block-id on <table> is not from",
    ],
    [
      "<table data-block-id={block.blockId}>",
      '<table data-block-id="syn-a/b1">',
      "data-block-id on <table> is not from",
    ],
    [
      "<thead>",
      '<thead className="x">',
      "attribute className is not admitted on <thead>",
    ],
    ["<tbody>", '<tbody id="x">', "attribute id is not admitted on <tbody>"],
    [
      "<tr key={index}>",
      "<tr key={index} data-block-id={block.blockId}>",
      "attribute data-block-id is not admitted on <tr>",
    ],
    [
      '<th key={column} scope="col">',
      "<th key={column} scope={column}>",
      "scope on <th> is not from its admitted source",
    ],
    [
      '<th key={column} scope="col">',
      '<th key={column} scope="col" onClick={() => undefined}>',
      "attribute onClick is not admitted on <th>",
    ],
    [
      "<td key={column}>",
      "<td key={column} colSpan={2}>",
      "attribute colSpan is not admitted on <td>",
    ],
    [
      "<td key={column}>",
      '<td key={column} style={{ color: "red" }}>',
      "attribute style is not admitted on <td>",
    ],
  ].map(([from, to, problem]) => [
    `a table element written as ${to}`,
    blocks,
    mutate(blocks, from, to),
    problem,
  ]),
  ...[
    [
      entries,
      "<h2 id={entry.id}>{entry.term}</h2>",
      "<h2 id={entry.term}>{entry.term}</h2>",
      "id on <h2> is not from its admitted source",
    ],
    [
      entries,
      "<h2 id={entry.id}>{entry.term}</h2>",
      '<h2 id="term-fixture-set">{entry.term}</h2>',
      "id on <h2> is not from its admitted source",
    ],
    [
      entries,
      "<h2 id={entry.id}>{errorTitle(entry)}</h2>",
      "<h2 id={errorTitle(entry)}>{errorTitle(entry)}</h2>",
      "id on <h2> is not from its admitted source",
    ],
    [
      entries,
      "<h3>Cause</h3>",
      "<h3 id={entry.id}>Cause</h3>",
      "id on <h3> is not from its admitted source",
    ],
    [
      entries,
      "<p>{entry.short}</p>",
      "<p data-section-id={entry.id}>{entry.short}</p>",
      "attribute data-section-id is not admitted on <p>",
    ],
    [
      entries,
      "<h3>Hint</h3>",
      "<section data-section-id={entry.id}><h3>Hint</h3></section>",
      "data-section-id on <section> is not from its admitted source",
    ],
    [
      entries,
      "<p>{entry.short}</p>",
      "<p data-block-id={entry.id}>{entry.short}</p>",
      "data-block-id on <p> is not from its admitted source",
    ],
    [
      view,
      "<h2 id={section.id}>",
      "<h2 id={chapter.id}>",
      "id on <h2> is not from its admitted source",
    ],
  ].map(([unit, from, to, problem]) => [
    `an entry heading or hook written as ${to}`,
    unit,
    mutate(unit, from, to),
    problem,
  ]),
  ...[
    [
      cards,
      "<h4 id={card.id}>",
      "<h4 id={card.title}>",
      "id on <h4> is not from its admitted source",
    ],
    [
      cards,
      "<h4 id={card.id}>",
      '<h4 id="card-fix-tally">',
      "id on <h4> is not from its admitted source",
    ],
    [
      cards,
      "<h4 id={card.id}>",
      "<h4 id={card.id} data-section-id={card.id}>",
      "attribute data-section-id is not admitted on <h4>",
    ],
    [
      cards,
      "<h3 id={section.id}>",
      "<h3 id={section.number}>",
      "id on <h3> is not from its admitted source",
    ],
    [
      cards,
      "<dl>",
      "<dl data-block-id={card.id}>",
      "attribute data-block-id is not admitted on <dl>",
    ],
    [
      cards,
      "<dt>Reach for</dt>",
      "<dt id={card.id}>Reach for</dt>",
      "attribute id is not admitted on <dt>",
    ],
    [
      cards,
      "<dt>Why</dt>",
      "<h5>Why</h5>",
      "element <h5> is not admitted in the renderer",
    ],
    [
      cards,
      "<dt>Build</dt>",
      '<dt className="label">Build</dt>',
      "attribute className is not admitted on <dt>",
    ],
    [
      view,
      "<h2>{partLabel(part.kind)}</h2>",
      "<h4>{partLabel(part.kind)}</h4>",
      "element <h4> is not admitted in the renderer",
    ],
    [
      entries,
      "<h3>Hint</h3>",
      "<h4>Hint</h4>",
      "element <h4> is not admitted in the renderer",
    ],
    [
      entries,
      "<h3>Cause</h3>",
      "<dl><dt>Cause</dt><dd>Text</dd></dl>",
      [
        "element <dl> is not admitted in the renderer",
        "element <dt> is not admitted in the renderer",
        "element <dd> is not admitted in the renderer",
      ],
    ],
  ].map(([unit, from, to, problem]) => [
    `a card element written as ${to}`,
    unit,
    mutate(unit, from, to),
    problem,
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
  // A frozen walk's hooks, one negative each: written by hand, taken from another field, and
  // placed on an element that is not admitted.
  [
    "a hand-written frozen intro hook",
    blocks,
    mutate(blocks, frozenIntro, '<p data-block-id="walk/b1.1.s0">'),
    "a frozen walk writes no hook but its block's on its root and sequence 1's intro",
  ],
  [
    "a frozen intro hook taken from a step",
    blocks,
    mutate(
      blocks,
      frozenIntro,
      "<p data-block-id={block.sequences[0].steps[0].blockId}>",
    ),
    "a frozen walk writes no hook but its block's on its root and sequence 1's intro",
  ],
  [
    "a frozen intro hook on the cell list",
    blocks,
    mutate(blocks, frozenIntro, "<p>").replace(
      '<ol role="list">',
      '<ol role="list" data-block-id={block.sequences[0].introBlockId}>',
    ),
    "a frozen walk's intro hook must stand on the <p> at its root that shows sequence 1's intro",
  ],
  // The walk control, one negative per rule: where it is handed down and in what form, where the
  // stepper stands, what it takes, the one choice, and nothing written around the stepper.
  [
    "a walk control made up by a host",
    "content/Drill.tsx",
    mutate(
      "content/Drill.tsx",
      "walkControl={walkControl} />",
      "walkControl={undefined} />",
    ),
    "a host hands the walk control down unchanged",
  ],
  [
    "a walk control handed down by a module that is not a host",
    hintsView,
    mutate(
      hintsView,
      hintHandedDown,
      `${hintHandedDown}\n walkControl={walkControl}`,
    ),
    "the walk control is handed down only by the content hosts",
  ],
  [
    "a walk stepper outside the controlled walk",
    blocks,
    mutate(
      blocks,
      "<ControlledWalk block={block} slugs={slugs} walkControl={walkControl} />",
      "<WalkStepper block={block} slugs={slugs} />",
    ),
    "the walk stepper is shown only as the root of the controlled walk in Blocks.tsx",
  ],
  [
    "another prop on the controlled stepper",
    blocks,
    mutate(
      blocks,
      controlledAnnounce,
      `${controlledAnnounce}\n      id={block.id}`,
    ),
    "prop id is not admitted on the controlled stepper",
  ],
  [
    "a move reported with the block hook's id",
    blocks,
    mutate(blocks, "walkId: block.id,", "walkId: block.blockId,"),
    "the controlled stepper takes its own block and slugs, what the page shows for the walk's id, and a handler that reports the move with that id",
  ],
  [
    "a walk frozen under a control",
    blocks,
    mutate(
      blocks,
      "walkControl === undefined ?",
      "walkControl !== undefined ?",
    ),
    [
      "a walk is frozen with no control and controlled with one, by one choice",
      "content/Blocks.tsx must write exactly one walk choice",
    ],
  ],
  [
    "a block hook around the controlled stepper",
    blocks,
    mutate(
      blocks,
      "  return (\n    <WalkStepper",
      "  return (\n    <div data-block-id={block.blockId}>\n    <WalkStepper",
    ).replace(
      "      slugs={slugs}\n    />\n  );",
      "      slugs={slugs}\n    />\n    </div>\n  );",
    ),
    [
      "a controlled walk writes nothing but its stepper",
      "content/Blocks.tsx must write exactly one controlled walk stepper",
    ],
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
    "a block hook from the anchor id",
    blocks,
    mutate(blocks, divId, "<div id={block.id} data-block-id={block.id}>"),
    "data-block-id on <div> is not from",
  ],
  [
    "a literal block hook",
    blocks,
    mutate(blocks, para, '<p data-block-id="intro/b1">\n          <Spans'),
    "data-block-id on <p> is not from",
  ],
  [
    "a block hook built from the block id",
    blocks,
    mutate(
      blocks,
      para,
      "<p data-block-id={String(block.blockId)}>\n          <Spans",
    ),
    "data-block-id on <p> is not from",
  ],
  [
    "an item hook from the list",
    blocks,
    mutate(
      blocks,
      "<li key={item.blockId} data-block-id={item.blockId}>",
      "<li key={item.blockId} data-block-id={block.blockId}>",
    ),
    "data-block-id on <li> is not from",
  ],
  [
    "an item hook from the item content",
    blocks,
    mutate(
      blocks,
      "<li key={item.blockId} data-block-id={item.blockId}>",
      "<li key={item.blockId} data-block-id={item.content}>",
    ),
    "data-block-id on <li> is not from",
  ],
  [
    "a block hook on a label",
    blocks,
    mutate(
      blocks,
      labelSpan,
      "<span id={labelId} data-block-id={block.blockId}>",
    ),
    "attribute data-block-id is not admitted on <span>",
  ],
  [
    "a section hook on a block",
    blocks,
    mutate(
      blocks,
      para,
      "<p data-section-id={block.blockId}>\n          <Spans",
    ),
    "attribute data-section-id is not admitted on <p>",
  ],
  [
    "a section hook from the title",
    view,
    mutate(
      view,
      "<section data-section-id={section.id}>\n      <h2",
      "<section data-section-id={section.title}>\n      <h2",
    ),
    "data-section-id on <section> is not from",
  ],
  [
    "a block hook on a section",
    view,
    mutate(
      view,
      "<section data-section-id={section.id}>\n      <h2",
      "<section data-block-id={section.id}>\n      <h2",
    ),
    "attribute data-block-id is not admitted on <section>",
  ],
  [
    "another data attribute beside the hook",
    blocks,
    mutate(
      blocks,
      para,
      "<p data-block-id={block.blockId} data-kind={block.type}>\n          <Spans",
    ),
    "attribute data-kind is not admitted on <p>",
  ],
  [
    "a cell state on a block",
    blocks,
    mutate(
      blocks,
      para,
      '<p data-block-id={block.blockId} data-cell="empty">\n          <Spans',
    ),
    "attribute data-cell is not admitted on <p>",
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
    mutate(
      blocks,
      "<ol start={block.start} data-block-id={block.blockId}>",
      "<ol start={2}>",
    ),
    "start on <ol> is not from",
  ],
  [
    "a start from another field",
    blocks,
    mutate(
      blocks,
      "<ol start={block.start} data-block-id={block.blockId}>",
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
      "<li key={item.blockId} data-block-id={item.blockId}>",
      "<li key={String(item.blockId)}>",
    ),
    badCall,
  ],
  [
    "section.id = ... in a renderer module",
    view,
    mutate(
      view,
      "  return (\n    <section data-section-id={section.id}>\n      <h2 id={section.id}>",
      '  section.id = "x";\n  return (\n    <section data-section-id={section.id}>\n      <h2 id={section.id}>',
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
      "const { id, kind } = link;",
      "link.content.sort();\n  const { id, kind } = link;",
    ),
    pinChanged(href),
  ],
  [
    "an Object.assign onto the link in internalHref",
    href,
    mutate(
      href,
      "const { id, kind } = link;",
      'Object.assign(link, { id: "intro" });\n  const { id, kind } = link;',
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
      "const { id, kind } = link;",
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
  // The approach picker and the build view.
  [
    "a picker button with no type",
    picker,
    mutate(picker, pickerType, ""),
    "<button> must carry type",
  ],
  [
    "a picker button that submits",
    picker,
    mutate(picker, 'type="button"', 'type="submit"'),
    notSource("type", "button"),
  ],
  [
    "a picker button with a form action",
    picker,
    mutate(picker, 'type="button"', 'type="button"\n          formAction="/x"'),
    "attribute formAction is not admitted on <button>",
  ],
  [
    "a picker button with a ref",
    picker,
    mutate(picker, 'type="button"', 'type="button"\n          ref={null}'),
    "attribute ref is not admitted on <button>",
  ],
  [
    "a picker button with a popover target",
    picker,
    mutate(
      picker,
      'type="button"',
      'type="button"\n          popoverTarget="x"',
    ),
    notSource("popoverTarget", "button"),
  ],
  [
    "a popover definition inside the picker",
    picker,
    mutate(picker, "{choice.label}", '{choice.label}<span popover="auto" />'),
    notSource("popover", "span"),
  ],
  [
    "a picker button with spread attributes",
    picker,
    mutate(picker, 'type="button"', 'type="button"\n          {...choice}'),
    "JSX spread is not admitted",
  ],
  [
    "a picker button with no pressed state",
    picker,
    mutate(picker, `          ${pickerPressed}\n`, ""),
    "<button> must carry aria-pressed",
  ],
  [
    "a pressed state that is a constant",
    picker,
    mutate(picker, pickerPressed, "aria-pressed={true}"),
    notSource("aria-pressed", "button"),
  ],
  [
    "a pressed state read from the label",
    picker,
    mutate(picker, pickerPressed, "aria-pressed={choice.label === pressed}"),
    notSource("aria-pressed", "button"),
  ],
  [
    "a handler that takes the event",
    picker,
    mutate(picker, pickerHandler, "onClick={(event) => {"),
    notSource("onClick", "button"),
  ],
  [
    "an async handler",
    picker,
    mutate(picker, pickerHandler, "onClick={async () => {"),
    notSource("onClick", "button"),
  ],
  [
    "a handler that calls twice",
    picker,
    mutate(picker, pickerCall, `${pickerCall}\n            ${pickerCall}`),
    notSource("onClick", "button"),
  ],
  [
    "a handler that passes the label",
    picker,
    mutate(picker, pickerCall, "onChoose(choice.label);"),
    notSource("onClick", "button"),
  ],
  [
    "a handler that passes a third argument",
    picker,
    mutate(picker, pickerCall, "onChoose(choice.id, choices);"),
    notSource("onClick", "button"),
  ],
  [
    "a handler that calls something else",
    picker,
    mutate(picker, pickerCall, "choices.map((o) => o.id);"),
    notSource("onClick", "button"),
  ],
  [
    "a handler that is the caller's function itself",
    picker,
    mutate(picker, /onClick=\{\(\) => \{[\s\S]*?\}\}/u, "onClick={onChoose}"),
    notSource("onClick", "button"),
  ],
  [
    "the change call outside a handler",
    picker,
    mutate(
      picker,
      "  return (\n    <div",
      '  onApproachChange(sectionId, "x");\n  return (\n    <div',
    ),
    badCall,
  ],
  [
    "a handler on the picker's group",
    picker,
    mutate(picker, pickerGroup, `<div onClick={() => {}} role="group">`),
    "attribute onClick is not admitted on <div>",
  ],
  [
    "a second handler site in the picker",
    picker,
    mutate(
      picker,
      "{choice.label}",
      `{choice.label}
          <button
            type="button"
            aria-pressed={choice.id === pressed}
            onClick={() => {
              onChoose(choice.id);
            }}
          />`,
    ),
    "must write exactly one handler",
  ],
  [
    "a picker group with another label",
    picker,
    mutate(picker, 'aria-label="Build approaches"', "aria-label={sectionId}"),
    notSource("aria-label", "div"),
  ],
  [
    "a picker group with another role",
    picker,
    mutate(picker, 'role="group"', 'role="tablist"'),
    notSource("role", "div"),
  ],
  [
    "state inside the picker",
    picker,
    mutate(
      picker,
      'import type { ReactElement } from "react";',
      'import { useState } from "react";\nimport type { ReactElement } from "react";',
    ),
    "import useState from react is not admitted",
  ],
  [
    "a build group with the hint label",
    picker,
    mutate(
      picker,
      'aria-label="Build approaches"',
      'aria-label="Hint approaches"',
    ),
    notSource("aria-label", "div"),
  ],
  [
    "a hint group with the build label",
    picker,
    mutate(
      picker,
      'aria-label="Hint approaches"',
      'aria-label="Build approaches"',
    ),
    notSource("aria-label", "div"),
  ],
  [
    "a build chooser that passes the section as the choice",
    picker,
    mutate(picker, approachChooser, "onApproachChange(sectionId, sectionId);"),
    "prop onChoose is not admitted",
  ],
  [
    "a build chooser that ignores the choice",
    picker,
    mutate(picker, approachChooser, 'onApproachChange(sectionId, "x");'),
    "prop onChoose is not admitted",
  ],
  [
    "a build chooser with a second parameter",
    picker,
    mutate(picker, "onChoose={(id) => {", "onChoose={(id, other) => {"),
    "prop onChoose is not admitted",
  ],
  [
    "a hint chooser made up in the picker",
    picker,
    mutate(picker, "onChoose={onHintChange}", "onChoose={() => undefined}"),
    "prop onChoose is not admitted",
  ],
  [
    "the build handler handed to the hint list",
    picker,
    mutate(picker, "onChoose={onHintChange}", "onChoose={onApproachChange}"),
    "prop onChoose is not admitted",
  ],
  [
    "a chooser given to another component",
    hintsView,
    mutate(
      hintsView,
      "<CueView block={section} />",
      "<CueView block={section} onChoose={section} />",
    ),
    "prop onChoose is not admitted",
  ],
  [
    "a local component called as a function",
    hintsView,
    mutate(
      hintsView,
      "<CueView block={section} />",
      "{CueView({ block: section })}",
    ),
    componentCall,
  ],
  [
    "a lower-case local component called as a function",
    hintsView,
    mutate(
      hintsView,
      "<CueView block={section} />",
      "{cueView({ block: section })}",
    ).replace("function CueView(", "function cueView("),
    plainHelper,
  ],
  [
    "a called helper that declares no return type",
    view,
    mutate(
      view,
      'function partLabel(kind: StaticPart["kind"]): string {',
      'function partLabel(kind: StaticPart["kind"]) {',
    ),
    plainHelper,
  ],
  [
    "an imported component called as a function",
    view,
    mutate(
      view,
      "<Blocks blocks={chapter.intro} slugs={slugs} walkControl={walkControl} />",
      "{Blocks({ blocks: chapter.intro, slugs })}",
    ),
    componentCall,
  ],
  [
    "a picker called with a handler from the static view",
    view,
    `${mutate(
      view,
      "<Blocks blocks={chapter.intro} slugs={slugs} walkControl={walkControl} />",
      '{ApproachPicker({ sectionId: "s", options: [], selectedApproachId: null, onApproachChange: click })}',
    ).replace(
      'import { Blocks } from "./Blocks.tsx";',
      'import { ApproachPicker } from "./ApproachPicker.tsx";\nimport { Blocks } from "./Blocks.tsx";',
    )}\nfunction click(): void {\n  click();\n}\n`,
    componentCall,
  ],
  [
    "a header cell scoped to its row",
    blocks,
    mutate(blocks, 'scope="col"', 'scope="row"'),
    notSource("scope", "th"),
  ],
  [
    "a scope on a data cell",
    blocks,
    mutate(blocks, "<td key={column}>", '<td key={column} scope="col">'),
    "attribute scope is not admitted on <td>",
  ],
  [
    "a hint handler made up in the hints view",
    hintsView,
    mutate(hintsView, hintHandedDown, "onHintChange={() => undefined}"),
    "prop onHintChange is not admitted",
  ],
  [
    "a hint handler handed down by a static module",
    view,
    mutate(
      view,
      "<StaticView doc={staticDoc(doc)} slugs={slugs} walkControl={walkControl} />",
      "<StaticView doc={staticDoc(doc)} slugs={slugs} walkControl={walkControl} onHintChange={slugs} />",
    ),
    "prop onHintChange is not admitted",
  ],
  [
    "a cue hook from another source",
    hintsView,
    mutate(
      hintsView,
      "<p data-block-id={block.blockId}>",
      "<p data-block-id={block.cue}>",
    ),
    notSource("data-block-id", "p"),
  ],
  [
    "a ladder hook from another source",
    hintsView,
    mutate(
      hintsView,
      "<section data-section-id={section.id}>",
      "<section data-section-id={section.blockId}>",
    ),
    notSource("data-section-id", "section"),
  ],
  ...["HintsPart", "Ladder", "Rung", "ContentDoc", "PartFile"].map((type) => [
    `the whole-record type ${type} in the hints view`,
    hintsView,
    mutate(
      hintsView,
      'import type { ReactElement } from "react";',
      `import type { ReactElement } from "react";\nimport type { ${type} } from "../generated/content.ts";`,
    ),
    `import ${type} from ../generated/content.ts is not admitted`,
  ]),
  [
    "a rung type in a static module",
    view,
    mutate(view, "  ChapterSection,\n", "  ChapterSection,\n  Rung,\n"),
    "import Rung from ../generated/content.ts is not admitted",
  ],
  [
    "an edited hints selector",
    hintsHelper,
    mutate(hintsHelper, "references.indexOf(selected)", "0"),
    pinChanged(hintsHelper),
  ],
  [
    "a button outside the picker",
    blocks,
    `${read(blocks)}\nfunction Press(): ReactElement {\n  return <button type="button" />;\n}\n`,
    "element <button> is not admitted",
  ],
  [
    "a group role outside the picker",
    blocks,
    mutate(blocks, divId, '<div role="group" id={block.id}>'),
    notSource("role", "div"),
  ],
  [
    "a list role on another element",
    blocks,
    mutate(
      blocks,
      `${divId}\n      <p>`,
      '<div role="list" id={block.id} data-block-id={block.blockId}>\n      <p>',
    ),
    notSource("role", "div"),
  ],
  [
    "an approach heading outside the build view",
    blocks,
    `${read(blocks)}\nfunction Head(): ReactElement {\n  return <h4 />;\n}\n`,
    "element <h4> is not admitted",
  ],
  [
    "an approach heading id from another source",
    buildView,
    mutate(buildView, "<h4 id={approach.id}>", "<h4 id={approach.title}>"),
    notSource("id", "h4"),
  ],
  [
    "a handler made up in the build view",
    buildView,
    mutate(buildView, handedDown, "onApproachChange={() => undefined}"),
    "prop onApproachChange is not admitted",
  ],
  [
    "a handler handed down by a static module",
    view,
    mutate(
      view,
      "<StaticView doc={staticDoc(doc)} slugs={slugs} walkControl={walkControl} />",
      "<StaticView doc={staticDoc(doc)} slugs={slugs} walkControl={walkControl} onApproachChange={slugs} />",
    ),
    "prop onApproachChange is not admitted",
  ],
  [
    "another event prop in the build view",
    buildView,
    mutate(buildView, handedDown, "onClick={onApproachChange}"),
    "prop onClick is not admitted",
  ],
  [
    "an edited projection helper",
    approach,
    mutate(
      approach,
      "selection.get(section.id) ?? null",
      "selection.get(section.id) ?? first.id",
    ),
    pinChanged(approach),
  ],
  // Term: its button and its definition, bound to one useId, with no handler of its own.
  [
    "a popover outside Term",
    blocks,
    mutate(blocks, labelSpan, '<span id={labelId} popover="auto">'),
    notSource("popover", "span"),
  ],
  [
    "a manual popover",
    term,
    mutate(term, termMode, 'popover="manual"'),
    notSource("popover", "span"),
  ],
  [
    "a hint popover",
    term,
    mutate(term, termMode, 'popover="hint"'),
    notSource("popover", "span"),
  ],
  [
    "a popover with no value",
    term,
    mutate(term, ` ${termMode}`, " popover"),
    notSource("popover", "span"),
  ],
  [
    "a target action that only shows",
    term,
    mutate(term, termAction, 'popoverTargetAction="show"'),
    notSource("popoverTargetAction", "button"),
  ],
  [
    "a literal popover target",
    term,
    mutate(term, termTarget, 'popoverTarget="x"'),
    notSource("popoverTarget", "button"),
  ],
  [
    "a target from a second useId",
    term,
    mutate(term, termTarget, "popoverTarget={other}").replace(
      termId,
      () => `${termId}\n  const other = useId();`,
    ),
    notSource("popoverTarget", "button"),
  ],
  [
    "a definition whose id is the entry's",
    term,
    mutate(term, "<span id={definition}", "<span id={term.id}"),
    notSource("popoverTarget", "button"),
  ],
  [
    "a definition not beside its button",
    term,
    mutate(
      term,
      /(<span id=\{definition\} popover="auto">[\s\S]*?<\/span>)/u,
      "<em>$1</em>",
    ),
    notSource("popoverTarget", "button"),
  ],
  [
    "a second definition in Term",
    term,
    mutate(
      term,
      "</span>\n",
      '</span>\n      <span id={definition} popover="auto" />\n',
    ),
    "must write exactly one definition",
  ],
  [
    "a second link in Term",
    term,
    mutate(
      term,
      termLink,
      `${termLink}\n        <a href={termHref(term)}>Again</a>`,
    ),
    "must write exactly one href",
  ],
  [
    "a Term link built from the entry id",
    term,
    mutate(term, "href={termHref(term)}", "href={`/glossary#${term.id}`}"),
    notSource("href", "a"),
  ],
  [
    "a lookalike termHref",
    term,
    mutate(
      term,
      'import { termHref } from "./href.ts";',
      "function termHref(t: TermSpan): string {\n  return t.id;\n}",
    ),
    notSource("href", "a"),
  ],
  [
    "a handler on the Term button",
    term,
    mutate(term, termAction, `${termAction}\n        onClick={() => {}}`),
    notSource("onClick", "button"),
  ],
  [
    "a pressed state on the Term button",
    term,
    mutate(term, termAction, `${termAction}\n        aria-pressed={true}`),
    notSource("aria-pressed", "button"),
  ],
  [
    "a ref on the Term button",
    term,
    mutate(term, termAction, `${termAction}\n        ref={null}`),
    "attribute ref is not admitted on <button>",
  ],
  [
    "spread attributes on the Term button",
    term,
    mutate(term, termAction, `${termAction}\n        {...term}`),
    "JSX spread is not admitted",
  ],
  [
    "a Term button with no target",
    term,
    mutate(term, `\n        ${termTarget}`, ""),
    "<button> must carry popoverTarget",
  ],
  [
    "state inside Term",
    term,
    mutate(term, "import { useId,", "import { useId, useState,"),
    "import useState from react is not admitted",
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
import type { CodeBlock, ListBlock, WalkItBlock } from "../generated/body.ts";
import type { ChapterSection } from "../generated/content.ts";
import type { SlugMap } from "./href.ts";
import { Spans } from "./Spans.tsx";
import { WalkStepper } from "./WalkStepper.tsx";

export type WalkShown = boolean;
export type WalkControlChange = boolean;
export interface WalkControl {
  readonly shownOf: (walkId: string) => WalkShown;
}

export function Blocks({
  block,
  list,
  section,
  walk,
  walkControl,
}: {
  block: CodeBlock;
  list: ListBlock;
  section: ChapterSection;
  walk: WalkItBlock;
  walkControl: WalkControl | undefined;
}): ReactElement {
  return (
    <>
      <Labelled key={block.blockId} block={block} />
      <Ordered block={list} />
      <Headings section={section} />
      <Inline />
      {walkControl === undefined ? (
        <FrozenWalk block={walk} />
      ) : (
        <ControlledWalk block={walk} walkControl={walkControl} />
      )}
    </>
  );
}

function ControlledWalk({
  block,
  slugs,
  walkControl,
}: {
  block: WalkItBlock;
  slugs: SlugMap;
  walkControl: WalkControl;
}): ReactElement {
  return (
    <WalkStepper
      block={block}
      position={walkControl.shownOf(block.id).position}
      onPositionChange={(change) => {
        walkControl.onWalkChange({
          walkId: block.id,
          position: change.position,
          cause: change.cause,
        });
      }}
      announce={walkControl.shownOf(block.id).announce}
      slugs={slugs}
    />
  );
}

function FrozenWalk({ block }: { block: WalkItBlock }): ReactElement {
  return (
    <div id={block.id} data-block-id={block.blockId}>
      <ol>
        <li>z</li>
      </ol>
      <p data-block-id={block.sequences[0].introBlockId}>
        <Spans spans={block.sequences[0].intro} />
      </p>
    </div>
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

// Blocks.tsx with every admitted call form: a top-level helper of plain values, a renderer
// import, useId, and map over a prop, a prop member and a map callback's parameter.
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
      {rows.map((row) => row.cells.map((cell) => startOf({ block: cell })))}
      {block.items.map((item) => (
        <li key={item.blockId}>{assertNever(item)}</li>
      ))}
    </span>
  );
}

function startOf({ block }: { block: ListBlock }): number | undefined {
  return block.start;
}
`;

const allowed = [
  ...[...rendererModules.keys()].map((unit) => [
    `the real ${unit}`,
    unit,
    read(unit),
  ]),
  ...pinned.map((unit) => [
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
    mutate(
      blocks,
      "<li key={item.blockId} data-block-id={item.blockId}>",
      '<li key="fixed">',
    ),
  ],
  ["every admitted call form", blocks, callForms],
];

const bomFinding = (unit) =>
  `src/${unit}: a reviewed ${noun(unit)} must not start with a byte order mark`;
const endings = (unit) => [
  ["LF", read(unit)],
  ["CRLF", read(unit).replaceAll("\n", "\r\n")],
];
// One representative byte order mark case, through every entry point that reads the text.
const marked = [
  [
    `${walkStepper} behind a byte order mark`,
    walkStepper,
    "\uFEFF" + read(walkStepper),
  ],
];

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

// ESLint must agree finding for finding with the build check, which holds the whole corpus; it
// takes one refusal, one admission and the byte order mark it strips before a rule runs.
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

  it.each(refused.slice(0, 1))(
    "refuses %s",
    async (_name, unit, code, expected) => {
      expectAll((await agrees(unit, code)).join("\n"), expected);
    },
  );

  it.each(allowed.slice(0, 1))("allows %s", async (_name, unit, code) => {
    expect(await agrees(unit, code)).toEqual([]);
  });

  it.each(marked)("refuses %s", async (_name, unit, code) => {
    expect(await agrees(unit, code)).toEqual([bomFinding(unit)]);
  });
}, 120_000);

// The walk helpers' values reach only listed tests, and a listed test module reaches no module
// that is not a listed test, so no test can hand a helper value on. Each row names every finding.
describe("the walk helper reach", () => {
  const replayHelper = "content/walk-replay.ts";
  const positionHelper = "content/walk-position.ts";
  const value = (name, source) =>
    `walk helper value ${name} from ${source} is admitted only in a listed test`;
  const inline = (name, source) =>
    `inline type ${name} from walk helper ${source} stays a run-time import; use import type`;
  const sideEffect = (source) =>
    `a side-effect import of walk helper ${source} is admitted only in a listed test`;
  const everything = (source) =>
    `export * from walk helper ${source} is admitted only in a listed test`;
  const testModule = (source) =>
    `a run-time import or re-export of test module ${source} is admitted only in a listed test`;
  const unlisted = (unit) => `src/${unit} is not in the renderer module list`;
  const pin = (unit) =>
    `${pinChanged(unit)}; update its pin only after a review of the whole helper`;
  const prepend = (unit, line) => `${line}\n${read(unit)}`;
  const append = (unit, line) => `${read(unit)}${line}\n`;
  const replaySource = "./content/walk-replay.ts";
  const positionSource = "./content/walk-position.ts";
  const viewSource = "./content-tests/hints-view.ts";
  const hintsSource = "./content-tests/hints.test.tsx";
  // Spelling inputs built in parts, so no misspelt word stands in the source.
  const hyphen = "%2D";
  const foldedSource = positionSource.replace(
    "ti",
    `t${String.fromCodePoint(0x131)}`,
  );

  const rows = [
    [
      "a listed helper test taking helper values",
      "content-tests/walk-replay.test.ts",
      read("content-tests/walk-replay.test.ts"),
      [],
    ],
    [
      "another listed test taking a helper value",
      "content-tests/renderer.test.tsx",
      prepend(
        "content-tests/renderer.test.tsx",
        'import { isValidPosition } from "../content/walk-position.ts";',
      ),
      [],
    ],
    [
      "an erased type import outside the tests",
      "Probe.ts",
      `import type { ReplayState } from "${replaySource}";\nexport type S = ReplayState;\n`,
      [],
    ],
    [
      "an erased type import in a renderer module",
      blocks,
      prepend(
        blocks,
        'import type { WalkPosition } from "./walk-position.ts";',
      ),
      [],
    ],
    [
      "an erased type re-export",
      "Probe.ts",
      `export type { WalkCell } from "${replaySource}";\n`,
      [],
    ],
    [
      "an erased type export of everything",
      "Probe.ts",
      `export type * from "${replaySource}";\n`,
      [],
    ],
    [
      "an erased type import from a listed test",
      "Probe.ts",
      `import type { Row } from "${viewSource}";\nexport type R = Row;\n`,
      [],
    ],
    [
      "a listed test handing a helper value to another listed test",
      "content-tests/hints-view.ts",
      append(
        "content-tests/hints-view.ts",
        'export { replay } from "../content/walk-replay.ts";',
      ),
      [],
    ],
    [
      "a listed test taking it on from that test",
      "content-tests/hints.test.tsx",
      append(
        "content-tests/hints.test.tsx",
        'export { replay } from "./hints-view.ts";',
      ),
      [],
    ],
    [
      "a plain relay outside the tests",
      "Probe.ts",
      'export { replay } from "./Relay.ts";\n',
      [],
    ],
    [
      "a renderer type import of a name the helper does not export",
      blocks,
      prepend(blocks, 'import type { WalkMove } from "./walk-position.ts";'),
      ["import WalkMove from ./walk-position.ts is not admitted"],
    ],
    [
      "a renderer module taking a helper value",
      blocks,
      prepend(blocks, 'import { replay } from "./walk-replay.ts";'),
      [value("replay", "./walk-replay.ts")],
    ],
    [
      "a renderer module taking an inline helper type",
      blocks,
      prepend(
        blocks,
        'import { type WalkPosition } from "./walk-position.ts";',
      ),
      [inline("WalkPosition", "./walk-position.ts")],
    ],
    [
      "a renderer module re-exporting a helper value",
      blocks,
      append(blocks, 'export { replay } from "./walk-replay.ts";'),
      [
        "only local named exports are admitted in the renderer",
        value("replay", "./walk-replay.ts"),
      ],
    ],
    [
      "a module outside the tests taking a helper value",
      "Probe.ts",
      `import { move } from "${positionSource}";\nexport const m = move;\n`,
      [value("move", positionSource)],
    ],
    ...[
      "./content/Walk-Replay.ts",
      "./content/WALK-REPLAY.TS",
      "./walk/walk-replay.ts",
      "../src/content/walk-replay.ts",
      "./content/walk-replay",
      "./content/walk-replay.js",
      "./content/walk-replay.ts?raw",
      "./content/walk-replay.ts#x",
      "./content/walk-replay.ts?a=/b",
      `./content/walk${hyphen}replay.ts`,
      "./content/walk-replay.ts/",
    ].map((source) => [
      `a helper value spelled ${source}`,
      "Probe.ts",
      `import { replay } from "${source}";\nexport const r = replay;\n`,
      [value("replay", source)],
    ]),
    [
      "a helper value spelled with an i that folds from U+0131",
      "Probe.ts",
      `import { move } from "${foldedSource}";\nexport const m = move;\n`,
      [value("move", foldedSource)],
    ],
    [
      "a side-effect import of a helper",
      "Probe.ts",
      `import "${replaySource}";\n`,
      [sideEffect(replaySource)],
    ],
    [
      "an empty re-export of a helper",
      "Probe.ts",
      `export {} from "${replaySource}";\n`,
      [sideEffect(replaySource)],
    ],
    [
      "export * from a helper",
      "Probe.ts",
      `export * from "${positionSource}";\n`,
      [everything(positionSource)],
    ],
    [
      "export * as a namespace from a helper",
      "Probe.ts",
      `export * as walk from "${positionSource}";\n`,
      [everything(positionSource)],
    ],
    [
      "an inline type import of a helper type",
      "Probe.ts",
      `import { type ReplayState } from "${replaySource}";\nexport type S = ReplayState;\n`,
      [inline("ReplayState", replaySource)],
    ],
    [
      "a value and an inline type in one import",
      "Probe.ts",
      `import { replay, type WalkCell } from "${replaySource}";\nexport const r = replay;\nexport type C = WalkCell;\n`,
      [value("replay", replaySource), inline("WalkCell", replaySource)],
    ],
    [
      "an inline type re-export",
      "Probe.ts",
      `export { type WalkCell } from "${replaySource}";\n`,
      [inline("WalkCell", replaySource)],
    ],
    [
      "a namespace import of a helper",
      "Probe.ts",
      `import * as walk from "${replaySource}";\nexport const w = walk;\n`,
      [value("*", replaySource)],
    ],
    [
      "a default import of a helper",
      "Probe.ts",
      `import walk from "${replaySource}";\nexport const w = walk;\n`,
      [value("default", replaySource)],
    ],
    [
      "a helper value re-exported",
      "Probe.ts",
      `export { replay } from "${replaySource}";\n`,
      [value("replay", replaySource)],
    ],
    [
      "a helper value re-exported under another name",
      "Probe.ts",
      `export { replay as run } from "${replaySource}";\n`,
      [value("replay", replaySource)],
    ],
    [
      "an unlisted test taking a helper value",
      "content-tests/extra.test.ts",
      'import { replay } from "../content/walk-replay.ts";\nexport const r = replay;\n',
      [
        unlisted("content-tests/extra.test.ts"),
        value("replay", "../content/walk-replay.ts"),
      ],
    ],
    [
      "an unlisted module in src/content taking a helper value",
      "content/Extra.tsx",
      'import { replay } from "./walk-replay.ts";\nexport const r = replay;\n',
      [unlisted("content/Extra.tsx"), value("replay", "./walk-replay.ts")],
    ],
    [
      "a comment added to the replay helper",
      replayHelper,
      append(replayHelper, "// Added."),
      [pin(replayHelper)],
    ],
    [
      "a comment added to the position helper",
      positionHelper,
      append(positionHelper, "// Added."),
      [pin(positionHelper)],
    ],
    [
      "an extra export in the position helper",
      positionHelper,
      append(
        positionHelper,
        "export function extra(): number {\n  return 1;\n}",
      ),
      [pin(positionHelper), "export extra is not in the module's frozen list"],
    ],
    [
      "an index read in the replay helper",
      replayHelper,
      mutate(replayHelper, "? slots.at(index)", "? slots[index]"),
      [
        pin(replayHelper),
        "a computed member with a non-literal key is not admitted in the renderer",
      ],
    ],
    [
      "an assignment in the position helper",
      positionHelper,
      mutate(
        positionHelper,
        "  return walk.at(sequence - 1)",
        "  sequence -= 0;\n  return walk.at(sequence - 1)",
      ),
      [pin(positionHelper), assigned],
    ],
    [
      "a module outside the tests taking a listed test module",
      "Probe.ts",
      `import { validHintsView } from "${viewSource}";\nexport const v = validHintsView;\n`,
      [testModule(viewSource)],
    ],
    [
      "a listed test module re-exported outside the tests",
      "Probe.ts",
      `export { validHintsView } from "${viewSource}";\n`,
      [testModule(viewSource)],
    ],
    [
      "export * from a listed test module",
      "Probe.ts",
      `export * from "${viewSource}";\n`,
      [testModule(viewSource)],
    ],
    [
      "a side-effect import of a listed test module",
      "Probe.ts",
      `import "${hintsSource}";\n`,
      [testModule(hintsSource)],
    ],
    [
      "an inline type import from a listed test module",
      "Probe.ts",
      `import { type Row } from "${viewSource}";\nexport type R = Row;\n`,
      [testModule(viewSource)],
    ],
    ...[
      "./content-tests/Hints-View",
      "./elsewhere/hints-view.js",
      "./content-tests/hints-view.ts?x",
      "./content-tests/HINTS.TEST.TSX",
      "./content-tests/hints.test",
    ].map((source) => [
      `a listed test module spelled ${source}`,
      "Probe.ts",
      `import { validHintsView } from "${source}";\nexport const v = validHintsView;\n`,
      [testModule(source)],
    ]),
    [
      "a renderer module taking a listed test module",
      blocks,
      prepend(
        blocks,
        'import { validHintsView } from "../content-tests/hints-view.ts";',
      ),
      [
        "import validHintsView from ../content-tests/hints-view.ts is not admitted",
        testModule("../content-tests/hints-view.ts"),
      ],
    ],
    [
      "a helper value through a listed helper test",
      "Probe.ts",
      'import { replay } from "./content-tests/walk-replay.test.ts";\nexport const r = replay;\n',
      [
        testModule("./content-tests/walk-replay.test.ts"),
        value("replay", "./content-tests/walk-replay.test.ts"),
      ],
    ],
    [
      "the entry from outside the tests to a chain of listed tests",
      "Probe.ts",
      `import { replay } from "${hintsSource}";\nexport const r = replay;\n`,
      [testModule(hintsSource)],
    ],
    [
      "a relay outside the tests re-exporting from a listed test",
      "Probe.ts",
      `export { replay } from "${hintsSource}";\n`,
      [testModule(hintsSource)],
    ],
  ];

  it.each(rows)(
    "finds exactly what %s holds in the build check",
    (_n, unit, code, expected) => {
      expect([...build(unit, code)].sort()).toEqual([...expected].sort());
    },
  );
});

// Each stepper capability is admitted in the real modules and refused one edit away from them,
// in the shared evaluator, which ESLint calls too. Each row names every finding.
describe("the walk stepper capabilities", () => {
  const stepper = "content/WalkStepper.tsx";
  const stepperTest = "content-tests/walk-stepper.test.tsx";
  const value = (name, source) =>
    `walk helper value ${name} from ${source} is admitted only in a listed test`;
  const testModule = (source) =>
    `a run-time import or re-export of test module ${source} is admitted only in a listed test`;
  const once = (what) => `${stepper} must write exactly one ${what}`;
  const nextGuard = 'if (next.kind === "moved") onPositionChange(next);';
  const switchGuard = 'if (chosen.kind === "moved") onPositionChange(chosen);';
  const nextBound = 'aria-disabled={next.kind !== "moved"}';
  const replayImport = 'import { replay } from "./walk-replay.ts";';
  const root = "<div id={block.id}>";
  const introHook = "data-block-id={sequence.introBlockId}";
  const switchLabel = 'aria-label="Walk sequences"';
  const switchChooser = "onChoose={onSequenceChange}";
  const chosenSequence = /cause: "sequence",\s*sequence,/u;
  const region = '<p aria-live="polite" aria-atomic="true">';
  const pressedChoice = "selectedSequence={valid ? position.sequence : null}";
  const part = (name) =>
    `${name} must show the selected sequence at a valid position, with its own props`;
  const atValid =
    "a walk stepper button must be shown only at a valid position";
  const options =
    "the switch options must be the walk's own sequences, by place from 1 and name";
  const pressed =
    "the switch must press the position's sequence only when it is valid";

  const rows = [
    // Admitted.
    ["the real walk stepper", stepper, read(stepper), []],
    ["the real picker with the sequence switch", picker, read(picker), []],
    ["the real stepper test", stepperTest, read(stepperTest), []],
    [
      "a guard written as a block",
      stepper,
      mutate(
        stepper,
        nextGuard,
        'if (next.kind === "moved") {\n onPositionChange(next);\n }',
      ),
      [],
    ],
    [
      "the chosen sequence written out",
      stepper,
      mutate(
        stepper,
        chosenSequence,
        'cause: "sequence",\n sequence: sequence,',
      ),
      [],
    ],
    [
      "an erased import of the change type in another renderer module",
      blocks,
      `import type { WalkChange } from "./WalkStepper.tsx";\n${read(blocks)}type C = WalkChange;\n`,
      [],
    ],
    // Module, export and test entries.
    [
      "an export the stepper's list lacks",
      stepper,
      `${read(stepper)}export type Extra = number;\n`,
      ["export type Extra is not in the module's frozen list"],
    ],
    [
      "the change type left unexported",
      stepper,
      mutate(stepper, "export interface WalkChange", "interface WalkChange"),
      ["export type WalkChange is missing from the module"],
    ],
    [
      "an unlisted test taking the stepper",
      "content-tests/extra.test.ts",
      `import { WalkStepper } from "../content/WalkStepper.tsx";\nexport const w = WalkStepper;\n`,
      ["src/content-tests/extra.test.ts is not in the renderer module list"],
    ],
    // Helper values: exactly the stepper, by exact source and name.
    [
      "the stepper taking a helper by another spelling",
      stepper,
      mutate(stepper, replayImport, 'import { replay } from "./walk-replay";'),
      [
        value("replay", "./walk-replay"),
        "import replay from ./walk-replay is not admitted",
        badCall,
      ],
    ],
    [
      "a namespace import of a helper in the stepper",
      stepper,
      `import * as walk from "./walk-position.ts";\n${read(stepper)}`,
      [
        "default or namespace import from ./walk-position.ts is not admitted",
        value("*", "./walk-position.ts"),
      ],
    ],
    [
      "an inline type beside a helper value in the stepper",
      stepper,
      mutate(
        stepper,
        replayImport,
        'import { replay, type WalkStepInput } from "./walk-replay.ts";',
      ),
      [
        "inline type WalkStepInput from walk helper ./walk-replay.ts stays a run-time import; use import type",
      ],
    ],
    [
      "the stepper re-exporting a helper value",
      stepper,
      `${read(stepper)}export { move } from "./walk-position.ts";\n`,
      [
        "only local named exports are admitted in the renderer",
        value("move", "./walk-position.ts"),
      ],
    ],
    [
      "the stepper reaching a helper through a listed test",
      stepper,
      mutate(
        stepper,
        replayImport,
        'import { replay } from "../content-tests/walk-replay.test.ts";',
      ),
      [
        testModule("../content-tests/walk-replay.test.ts"),
        value("replay", "../content-tests/walk-replay.test.ts"),
        "import replay from ../content-tests/walk-replay.test.ts is not admitted",
        badCall,
      ],
    ],
    [
      "another renderer module taking a helper value",
      blocks,
      `import { move } from "./walk-position.ts";\n${read(blocks)}`,
      [value("move", "./walk-position.ts")],
    ],
    // The sequence switch and its label.
    [
      "another label on the sequence switch",
      picker,
      mutate(picker, switchLabel, 'aria-label="Walk sequence"'),
      [notSource("aria-label", "div")],
    ],
    [
      "the sequence label on another wrapper",
      picker,
      mutate(picker, 'aria-label="Hint approaches"', switchLabel),
      [notSource("aria-label", "div")],
    ],
    [
      "the sequence chooser wrapped",
      picker,
      mutate(
        picker,
        switchChooser,
        "onChoose={(id) => {\n onSequenceChange(id);\n }}",
      ),
      ["prop onChoose is not admitted", badCall],
    ],
    // Guarded callbacks.
    [
      "Next reporting without the guard",
      stepper,
      mutate(stepper, nextGuard, "onPositionChange(next);"),
      [notSource("onClick", "button"), badCall],
    ],
    [
      "Next reporting the Prev move",
      stepper,
      mutate(
        stepper,
        nextGuard,
        'if (next.kind === "moved") onPositionChange(previous);',
      ),
      [notSource("onClick", "button"), badCall],
    ],
    [
      "Prev labelled Next",
      stepper,
      mutate(stepper, /Prev\n(\s*)<\/button>/u, "Next\n$1</button>"),
      [
        notSource("aria-disabled", "button"),
        notSource("onClick", "button"),
        badCall,
        once("Prev and one Next button"),
      ],
    ],
    [
      "the switch reporting without the guard",
      stepper,
      mutate(stepper, switchGuard, "onPositionChange(chosen);"),
      ["prop onSequenceChange is not admitted", badCall],
    ],
    [
      "the switch moving to a fixed sequence",
      stepper,
      mutate(stepper, chosenSequence, 'cause: "sequence",\n sequence: 1,'),
      ["prop onSequenceChange is not admitted", badCall],
    ],
    [
      "the change handler handed to another component",
      stepper,
      mutate(
        stepper,
        "<Spans spans={block.title} slugs={slugs} />",
        "<Spans spans={block.title} slugs={slugs} onPositionChange={onPositionChange} />",
      ),
      ["prop onPositionChange is not admitted"],
    ],
    // Bounds.
    [
      "a fixed bound",
      stepper,
      mutate(stepper, nextBound, "aria-disabled={false}"),
      [notSource("aria-disabled", "button")],
    ],
    [
      "a bound read from the other button's move",
      stepper,
      mutate(stepper, nextBound, 'aria-disabled={previous.kind !== "moved"}'),
      [notSource("aria-disabled", "button")],
    ],
    [
      "a bound outside the stepper",
      picker,
      mutate(picker, pickerPressed, `${pickerPressed}\n aria-disabled={false}`),
      [notSource("aria-disabled", "button")],
    ],
    [
      "a stepper button without its bound",
      stepper,
      mutate(stepper, nextBound, ""),
      ["<button> must carry aria-disabled"],
    ],
    // The live region.
    [
      "an assertive live region",
      stepper,
      mutate(stepper, 'aria-live="polite"', 'aria-live="assertive"'),
      [notSource("aria-live", "p")],
    ],
    [
      "a second live region",
      stepper,
      mutate(
        stepper,
        "<p data-block-id={block.blockId}>",
        '<p data-block-id={block.blockId} aria-live="polite">',
      ),
      [
        once("live region"),
        "the live region must carry aria-atomic",
        "the live region must hold the walk announcement alone",
      ],
    ],
    [
      "the live region with its literals in the other order",
      stepper,
      mutate(stepper, region, '<p aria-atomic="true" aria-live="polite">'),
      [],
    ],
    [
      "the live region without aria-atomic",
      stepper,
      mutate(stepper, region, '<p aria-live="polite">'),
      ["the live region must carry aria-atomic"],
    ],
    [
      "a live region read in parts",
      stepper,
      mutate(stepper, region, '<p aria-live="polite" aria-atomic="false">'),
      [notSource("aria-atomic", "p")],
    ],
    [
      "aria-atomic on another element",
      stepper,
      mutate(
        stepper,
        "<p data-block-id={block.blockId}>",
        '<p data-block-id={block.blockId} aria-atomic="true">',
      ),
      [notSource("aria-atomic", "p")],
    ],
    [
      "aria-atomic outside the stepper",
      blocks,
      mutate(
        blocks,
        para,
        '<p data-block-id={block.blockId} aria-atomic="true">\n          <Spans',
      ),
      [notSource("aria-atomic", "p")],
    ],
    [
      "the live region inside the valid part",
      stepper,
      mutate(
        stepper,
        /(\s*<\/>\s*\) : null\}\s*)(<p aria-live="polite" aria-atomic="true">[^]*?<\/p>)/u,
        "$2$1",
      ),
      ["the live region must stand at the walk stepper's root"],
    ],
    [
      "the live region inside another element",
      stepper,
      mutate(
        stepper,
        /(<p aria-live="polite" aria-atomic="true">[^]*?<\/p>)/u,
        "<p>$1</p>",
      ),
      ["the live region must stand at the walk stepper's root"],
    ],
    [
      "a link or Term in the live region",
      stepper,
      mutate(
        stepper,
        region,
        `${region}\n<Spans spans={block.title} slugs={slugs} />`,
      ),
      ["the live region must hold the walk announcement alone"],
    ],
    [
      "an element in the announcement",
      stepper,
      mutate(
        stepper,
        "<>Start: {spanText(sequence.intro)}</>",
        "<>Start: <Spans spans={sequence.intro} slugs={sequence.intro} /></>",
      ),
      ["the walk announcement writes no element"],
    ],
    [
      "an announcement at an invalid position",
      stepper,
      mutate(stepper, "{valid && announce", "{announce"),
      [part("Announcement")],
    ],
    [
      "an announcement of a fixed step",
      stepper,
      mutate(stepper, /step=\{position\.step\}(\s*\/>)/u, "step={0}$1"),
      [part("Announcement")],
    ],
    [
      "an announcement of every sequence",
      stepper,
      mutate(
        stepper,
        /index \+ 1 === position\.sequence \? \((\s*<Announcement[^]*?\/>)\s*\) : null,/u,
        "$1,",
      ),
      [
        part("Announcement"),
        "the live region must hold the walk announcement alone",
      ],
    ],
    [
      "an announcement chosen by its step",
      stepper,
      mutate(
        stepper,
        /index \+ 1 === position\.sequence( \? \(\s*<Announcement)/u,
        "index + 1 === position.step$1",
      ),
      [part("Announcement")],
    ],
    [
      "an announcement the caller did not ask for",
      stepper,
      mutate(stepper, "{valid && announce", "{valid && valid"),
      [part("Announcement")],
    ],
    [
      "an announcement not bound to a valid position",
      stepper,
      mutate(stepper, "{valid && announce", "{announce && announce"),
      [part("Announcement")],
    ],
    // The active sequence's call site and selection.
    [
      "the active sequence props in another order",
      stepper,
      mutate(
        stepper,
        /block=\{block\}(\s*)sequence=\{sequence\}/u,
        "sequence={sequence}$1block={block}",
      ),
      [],
    ],
    [
      "the active sequence at a fixed step",
      stepper,
      mutate(stepper, "step={position.step}", "step={0}"),
      [part("ActiveSequence")],
    ],
    [
      "every sequence part mounted",
      stepper,
      mutate(
        stepper,
        /index \+ 1 === position\.sequence \? \((\s*<ActiveSequence[^]*?\/>)\s*\) : null,/u,
        "$1,",
      ),
      [part("ActiveSequence")],
    ],
    [
      "the active sequence chosen by its step",
      stepper,
      mutate(
        stepper,
        /index \+ 1 === position\.sequence( \? \(\s*<ActiveSequence)/u,
        "index + 1 === position.step$1",
      ),
      [part("ActiveSequence")],
    ],
    [
      "the active sequence from another source",
      stepper,
      mutate(
        stepper,
        /sequence=\{sequence\}(\s*step=\{position\.step\}\s*slugs)/u,
        "sequence={block.sequences[0]}$1",
      ),
      [part("ActiveSequence")],
    ],
    [
      "the active sequence handed on as a value",
      stepper,
      mutate(
        stepper,
        "<Spans spans={block.title} slugs={slugs} />",
        "<Spans spans={block.title} slugs={slugs} part={ActiveSequence} />",
      ),
      [part("ActiveSequence")],
    ],
    [
      "active content at an invalid position",
      stepper,
      mutate(stepper, "{valid ? (", "{block.sequences.length > 0 ? ("),
      [part("ActiveSequence"), atValid, atValid],
    ],
    [
      "an intro hook in a part the call site does not bind",
      stepper,
      `${mutate(
        stepper,
        /\{step === 0 \? \(\s*<p data-block-id=\{sequence\.introBlockId\}>[^]*?<\/p>\s*\) : null\}/u,
        "<Intro sequence={sequence} step={0} slugs={slugs} />",
      )}
function Intro({
  sequence,
  step,
  slugs,
}: {
  sequence: WalkSequence;
  step: number;
  slugs: SlugMap;
}): ReactElement {
  return (
    <>
      {step === 0 ? (
        <p data-block-id={sequence.introBlockId}>
          <Spans spans={sequence.intro} slugs={slugs} />
        </p>
      ) : null}
    </>
  );
}
`,
      [notSource("data-block-id", "p")],
    ],
    // The sequence switch's options and pressed choice.
    [
      "a switch option written label first",
      stepper,
      mutate(
        stepper,
        /id: index \+ 1,(\s*)label: sequence\.name,/u,
        "label: sequence.name,$1id: index + 1,",
      ),
      [],
    ],
    [
      "zero-based switch ids",
      stepper,
      mutate(stepper, "id: index + 1,", "id: index,"),
      [options],
    ],
    [
      "a forged switch id",
      stepper,
      mutate(stepper, "id: index + 1,", "id: 1,"),
      [options],
    ],
    [
      "switch options from another source",
      stepper,
      mutate(
        stepper,
        "options={block.sequences.map(",
        "options={block.title.map(",
      ),
      [options],
    ],
    [
      "switch labels from another field",
      stepper,
      mutate(stepper, "label: sequence.name,", "label: sequence.introBlockId,"),
      [options],
    ],
    [
      "the switch without its options",
      stepper,
      mutate(stepper, /options=\{block\.sequences\.map\([^]*?\}\)\)\}/u, ""),
      ["the sequence switch must carry options"],
    ],
    [
      "an extra prop on the switch",
      stepper,
      mutate(stepper, "<SequencePicker", "<SequencePicker extra={1}"),
      ["prop extra is not admitted on the sequence switch"],
    ],
    [
      "an unconditional pressed choice",
      stepper,
      mutate(stepper, pressedChoice, "selectedSequence={position.sequence}"),
      [pressed],
    ],
    [
      "a pressed choice from another field",
      stepper,
      mutate(
        stepper,
        pressedChoice,
        "selectedSequence={valid ? position.step : null}",
      ),
      [pressed],
    ],
    [
      "a second sequence switch",
      stepper,
      mutate(stepper, /(<SequencePicker[^]*?\n {8}\/>)/u, "<>$1$1</>"),
      [once("sequence switch")],
    ],
    [
      "a live region outside the stepper",
      blocks,
      mutate(
        blocks,
        para,
        '<p data-block-id={block.blockId} aria-live="polite">\n          <Spans',
      ),
      [notSource("aria-live", "p")],
    ],
    [
      "a live region on a div",
      stepper,
      mutate(stepper, root, '<div id={block.id} aria-live="polite">'),
      ["attribute aria-live is not admitted on <div>"],
    ],
    // The strike.
    [
      "a strike outside the stepper",
      blocks,
      mutate(
        blocks,
        para,
        "<p data-block-id={block.blockId}>\n          <s>gone</s>\n          <Spans",
      ),
      ["element <s> is not admitted in the renderer"],
    ],
    [
      "a strike without its word",
      stepper,
      mutate(stepper, /\n(\s*)lost\{" "\}/u, '\n$1gone{" "}'),
      ["<s> must stand beside the text lost"],
    ],
    [
      "a strike with an attribute",
      stepper,
      mutate(stepper, "<s>", "<s id={block.id}>"),
      ["attribute id is not admitted on <s>"],
    ],
    // The cell list.
    [
      "a table in the stepper",
      stepper,
      mutate(stepper, '<ol role="list">', "<table>").replace(
        "</ol>",
        "</table>",
      ),
      ["element <table> is not admitted in the walk stepper"],
    ],
    [
      "a numbered start on the cell list",
      stepper,
      mutate(stepper, '<ol role="list">', '<ol role="list" start={0}>'),
      [notSource("start", "ol")],
    ],
    [
      "a hook on a cell",
      stepper,
      mutate(stepper, "key={index}", "key={index} data-block-id={slot.value}"),
      [notSource("data-block-id", "li")],
    ],
    // The active hooks.
    [
      "a hand-written intro hook",
      stepper,
      mutate(stepper, introHook, 'data-block-id="walk-test/b1.1.s0"'),
      [notSource("data-block-id", "p"), once("intro hook")],
    ],
    [
      "an intro hook from another field",
      stepper,
      mutate(stepper, introHook, "data-block-id={sequence.name}"),
      [notSource("data-block-id", "p"), once("intro hook")],
    ],
    [
      "an intro hook shown at every step",
      stepper,
      mutate(
        stepper,
        /step === 0 \? \(\s*<p data-block-id=\{sequence\.introBlockId\}>/u,
        "step >= 0 ? (<p data-block-id={sequence.introBlockId}>",
      ),
      [notSource("data-block-id", "p")],
    ],
    [
      "a note hook shown for every step",
      stepper,
      mutate(
        stepper,
        /index \+ 1 === step \? \(\s*<p key=\{item\.blockId\}/u,
        "index + 1 >= step ? (<p key={item.blockId}",
      ),
      [notSource("data-block-id", "p")],
    ],
    [
      "the title hook on the root",
      stepper,
      mutate(
        stepper,
        root,
        "<div id={block.id} data-block-id={block.blockId}>",
      ),
      [notSource("data-block-id", "div")],
    ],
    // The root anchor.
    [
      "the walk id on an inner element",
      stepper,
      mutate(stepper, root, `${root}\n<div id={block.id} />`),
      [notSource("id", "div"), once("root anchor")],
    ],
    [
      "the root without the walk id",
      stepper,
      mutate(stepper, root, "<div>"),
      [once("root anchor")],
    ],
    [
      "a root anchor from another field",
      stepper,
      mutate(stepper, root, "<div id={block.blockId}>"),
      [notSource("id", "div")],
    ],
  ].map(([name, unit, code, expected]) => [
    name,
    unit,
    code,
    // An edit of the pinned stepper also meets its pin, so no row is exempt from it.
    unit === stepper && code !== read(stepper)
      ? [...expected, pinReview(stepper)]
      : expected,
  ]);

  it.each(rows)(
    "finds exactly what %s holds in the build check",
    (_n, unit, code, expected) => {
      expect([...build(unit, code)].sort()).toEqual([...expected].sort());
    },
  );
});

// With its pin unchanged, the stepper admits no edit but a line-ending change through either
// entry point, whatever its local rules make of the edit.
describe("the walk stepper module pin", () => {
  const changed = pinReview(walkStepper);
  const original = read(walkStepper);
  const change = (code, from, to) => {
    if (!code.includes(from))
      throw new Error(`no anchor ${from} in ${walkStepper}`);
    return code.replace(from, () => to);
  };
  // One edit a reader hears and one that keeps the behaviour: the pin binds the whole text.
  const edits = [
    [
      "the wrong intro announced",
      change(original, "spanText(sequence.intro)", "sequence.name"),
    ],
    ["a comment added", `${original}// Added.\n`],
  ];
  const missing = `src/${walkStepper} has no source text to check against its pin`;

  it.each(endings(walkStepper))(
    "admits the unchanged stepper with %s in the build check",
    (_ending, text) => {
      expect(build(walkStepper, text)).toEqual([]);
    },
  );

  it.each(edits)("refuses %s in the build check", (_name, code) => {
    expect(build(walkStepper, code)).toContain(changed);
  });

  // The shared checker and the ESLint adapter, each handed no full source.
  it("refuses the stepper checked without its source text", () => {
    const { ast, scopeManager } = parseSource(original, `src/${walkStepper}`);
    expect(
      checkProgram(ast, scopeManager, walkStepper).map(describeFinding),
    ).toContain(missing);
  });

  it.each([["no text", undefined]])(
    "refuses the stepper in the ESLint rule given %s",
    (_name, text) => {
      const { ast, scopeManager } = parseSource(original, `src/${walkStepper}`);
      const reported = [];
      rule
        .create({
          filename: join(web, "src", walkStepper),
          sourceCode: { scopeManager, text, hasBOM: false },
          report: ({ data }) => reported.push(data.name),
        })
        .Program(ast);
      expect(reported).toContain(missing);
    },
  );

  // The absolute name the lint command gives and another letter case reach the one pin in both
  // adapters through the shared location mapper; a case lookalike is refused.
  const blind = existsSync(join(web, "src", "CONTENT", "href.ts"));
  // Spelled in parts, so no misspelt word stands in the source.
  const shouted = `${"WalkStepper".toUpperCase()}.tsx`;
  const file = join(web, "src", "content", "WalkStepper.tsx");
  const names = [
    ["its absolute name", file],
    ...(blind
      ? [["another letter case", join(web, "src", "CONTENT", shouted)]]
      : []),
  ];
  const lintAs = async (name, code) => {
    const [result] = await lint.lintText(code, { filePath: name });
    expect(result.messages.filter((m) => m.fatal)).toEqual([]);
    return result.messages
      .filter((m) => m.ruleId === app)
      .map((m) => m.message.slice(0, -1));
  };

  it.each(names)(
    "reaches the one pin as %s in both adapters",
    async (_how, name) => {
      const absolute = resolve(web, name);
      const unit = sourceUnit(guardContext(web), absolute);
      expect(unit).toBe(walkStepper);
      expect(scriptViolations(original, absolute, unit)).toEqual([]);
      expect(
        scriptViolations(`${original}// Added.\n`, absolute, unit),
      ).toEqual([changed]);
      expect(await lintAs(name, original)).toEqual([]);
      expect(await lintAs(name, `${original}// Added.\n`)).toEqual([changed]);
    },
  );

  const lookalikes = [walkStepper.toLowerCase()];

  it.each(lookalikes)(
    "never lints the edited stepper clean as src/%s",
    async (unit) => {
      const [result] = await lint.lintText(`${original}// Added.\n`, {
        filePath: `src/${unit}`,
      });
      expect(result.messages.length).toBeGreaterThan(0);
    },
  );
}, 120_000);

// The build owns completeness: a pinned module the scan never checked fails it, so neither a
// missing file nor a list that leaves out or misspells the module drops its pin.
describe("the pinned modules in the build scan", () => {
  const owed = (unit) =>
    `src/${unit} is pinned but the build scan did not check it`;
  const main = { "src/main.tsx": "console.log(1);\n" };
  const failure = (files) =>
    buildFixture({ ...main, ...files }).then(
      () => null,
      (e) => e,
    );
  let ctx = null;

  beforeAll(() => {
    ctx = guardContext(fixture(main).root);
  });

  it("checks every pinned module on the real list and owes none", () => {
    expect(rendererScan(ctx)).toEqual([]);
  });

  it.each([walkStepper])(
    "owes %s when the scanned list leaves it out",
    (unit) => {
      const units = [...rendererModules.keys()].filter((u) => u !== unit);
      expect(rendererScan(ctx, units)).toEqual([owed(unit)]);
    },
  );

  it.each([["another letter case", "content/walkStepper.tsx"]])(
    "owes the canonical stepper when the list spells it with %s",
    (_how, spelled) => {
      const units = [...rendererModules.keys()].map((u) =>
        u === walkStepper ? spelled : u,
      );
      const found = rendererScan(ctx, units);
      expect(found).toContain(owed(walkStepper));
      expect(found.some((f) => f.startsWith(`src/${spelled} `))).toBe(true);
    },
  );

  it("fails a real build without the stepper and owes its check", async () => {
    const error = await failure({ [`src/${walkStepper}`]: null });
    expect(error?.message).toMatch(/build guard: /u);
    expect(error?.message).toContain(`src/${walkStepper} cannot be read`);
    expect(error?.message).toContain(owed(walkStepper));
  });

  it("fails a real build on an edited stepper", async () => {
    const error = await failure({
      [`src/${walkStepper}`]: `${read(walkStepper)}// Added.\n`,
    });
    expect(error?.message).toMatch(/build guard: /u);
    expect(error?.message).toContain(pinReview(walkStepper));
  });
}, 240_000);

describe("the reviewed helper pins", () => {
  const helpers = [...rendererModules.keys()].filter((u) => u.endsWith(".ts"));
  const raw = (unit) => readFileSync(join(web, "src", unit));

  it("pin exactly the renderer modules that are not JSX", () => {
    expect([...helperPins.keys()].sort()).toEqual(helpers.sort());
  });

  it("pins the walk stepper whole and owes a check to every pinned module", () => {
    expect([...modulePins.keys()]).toEqual([walkStepper]);
    expect([...pinnedUnits].sort()).toEqual([...helpers, walkStepper].sort());
  });

  it.each(pinned)("binds the pin of %s to the file on disk", (unit) => {
    expect(helperDigest(raw(unit).toString("utf8"))).toBe(
      helperPins.get(unit) ?? modulePins.get(unit),
    );
  });

  it.each([walkStepper])(
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
// The names one file can be linted under: its own and another letter case.
const spellings = [
  ["", (unit) => `src/${unit}`],
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
      files: ["src/**/*.{ts,tsx}"],
      languageOptions: { parser },
      linterOptions: { noInlineConfig: true },
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
    [`allows ${walkStepper}`, walkStepper, read(walkStepper), []],
    ...marked.map(([name, unit, code]) => [
      `refuses ${name}`,
      unit,
      code,
      [`${bomFinding(unit)}.`],
    ]),
    [
      `refuses a comment added to ${walkStepper}`,
      walkStepper,
      `${read(walkStepper)}// Added.\n`,
      [`${pinReview(walkStepper)}.`],
    ],
  ];
  // The lower case of this capital is two characters; folding it must not move the file out of
  // the renderer folder.
  const unlisted = ["content/İ.ts"].map((unit) => [
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
    const aliases = [[upper(href), href]];

    it.each(aliases)(
      "allows the unchanged helper as %s",
      async (path, unit) => {
        expect(await named(path, read(unit))).toEqual([]);
      },
    );

    it.each(aliases)("refuses a comment added as %s", async (path, unit) => {
      expect(await named(path, `${read(unit)}// Added.\n`)).toEqual([
        `${pinReview(unit)}.`,
      ]);
    });

    // The type-aware block selects by extension as written, so a capital extension is parsed
    // without type information; the policy still runs on it and the extension is refused.
    it("refuses a capital extension and still checks the pin", async () => {
      const [result] = await lint.lintText(`${read(href)}// Added.\n`, {
        filePath: "src/content/href.TS",
      });
      const found = result.messages.map((m) => [
        m.severity,
        m.ruleId,
        m.message,
      ]);
      expect(found).toHaveLength(2);
      expect(found).toEqual(
        expect.arrayContaining([
          [
            2,
            "sharpladder/source-extension",
            "application source must be .ts or .tsx.",
          ],
          [2, app, `${pinReview(href)}.`],
        ]),
      );
    });

    it.each([blocks])(
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
  it.each([["a trailing dot", `src/${href}.`]])(
    "is never linted clean as %s",
    async (_name, path) => {
      const [result] = await lint.lintText(read(href), { filePath: path });
      expect(result.messages.length).toBeGreaterThan(0);
    },
  );
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

  it.each(marked)("fails on %s", async (_name, unit, code) => {
    await rejects(unit, code, /must not start with a byte order mark/u);
  });

  it.each([blocks])(
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

  // The source policy refuses the import before the graph check sees the module.
  it("fails when production reaches a renderer test", async () => {
    await rejects(
      "./content-tests/href.test.ts",
      /run-time import or re-export of test module \.\/content-tests\/href\.test\.ts is admitted only in a listed test/u,
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
