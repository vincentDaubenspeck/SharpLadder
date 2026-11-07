// @vitest-environment node
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { composedConfig } from "./config.js";
import { fixtureTokens, inModule, lintAs, makeRoot, write } from "./harness.js";
import { lintProduction } from "./lint-production.js";
import { fixtureRegistry } from "./registry.js";

const webref = createRequire(import.meta.url)("@webref/css/css.json");
const fixture = (options) =>
  composedConfig({ ...options, registry: "fixture" });

let paths;
let batch;
let unattributed;
const registered = new Set();
const tokenRule = " (sharpladder/tokens)";
const open = "@layer components {\n";
const close = "}\n";

/** Cases are registered while tests are collected so one production lint covers them all. */
function reg(
  rows,
  build = (row) => inModule(Array.isArray(row) ? row[0] : row),
) {
  for (const row of rows) {
    const code = build(row);
    if (!code.startsWith(open) || !code.endsWith(close))
      throw new Error(`case is not one @layer components block: ${code}`);
    registered.add(code);
  }
  return rows;
}

const panel = () => join(paths.src, "components", "Panel.module.css");

const located = /^(.*?\.css):[0-9]+:[0-9]+ (.*)$/i;
const bare = (message) =>
  message.endsWith(tokenRule) ? message.slice(0, -tokenRule.length) : message;

// Each case is its own module, so one production lint covers them all and every warning,
// from any rule, maps back to its case by file.
beforeAll(async () => {
  ({ paths } = makeRoot());
  const files = new Map();
  for (const code of registered) {
    const file = join(paths.src, "cases", `C${String(files.size)}.module.css`);
    write(file, code);
    files.set(file, code);
  }
  const production = await lintProduction(paths, fixtureRegistry, fixture);
  batch = new Map([...registered].map((code) => [code, []]));
  unattributed = [];
  for (const line of production.lines) {
    const at = located.exec(line);
    const code = at ? files.get(at[1]) : undefined;
    if (code === undefined) unattributed.push(line);
    else batch.get(code).push(bare(at[2]));
  }
}, 120_000);

it("every production warning belongs to a case", () => {
  expect(unattributed).toEqual([]);
});

async function tokenMessages(code, file, root = paths) {
  const target = file ?? panel();
  const direct = await lintAs(root, target, code);
  expect(direct.invalid).toEqual([]);
  let production;
  if (file === undefined) {
    production = batch.get(code);
  } else {
    write(file, code);
    const result = await lintProduction(root, fixtureRegistry, fixture);
    production = result.lines.flatMap((l) => {
      const at = located.exec(l);
      return at?.[1] === file ? [bare(at[2])] : [];
    });
  }
  return {
    direct: direct.all
      .filter((w) => w.rule === "sharpladder/tokens")
      .map((w) => bare(w.text)),
    all: direct.all.map((w) => w.text),
    production,
  };
}

async function rejects(code, pattern, file, root) {
  const { direct, production } = await tokenMessages(code, file, root);
  expect(direct.some((t) => pattern.test(t))).toBe(true);
  expect(production.some((t) => pattern.test(t))).toBe(true);
}

// Acceptance is composed: no warning from any rule, inherited or custom.
async function accepts(code, file, root) {
  const { all, production } = await tokenMessages(code, file, root);
  expect(all).toEqual([]);
  expect(production).toEqual([]);
}

const widthProps = [
  (v) => `border-width: ${v};`,
  (v) => `border-top-width: ${v};`,
  (v) => `border-block-width: ${v};`,
  (v) => `border-inline-start-width: ${v};`,
  (v) => `outline-width: ${v};`,
  (v) => `border: ${v} solid var(--accent);`,
  (v) => `border-inline: ${v} dashed var(--accent);`,
  (v) => `outline: ${v} solid var(--accent);`,
];
const thicknessCases = (values) =>
  reg(values.flatMap((v) => widthProps.map((p) => p(v))));
const thicknessMessage = /thickness takes|use px/;

describe("thickness is a literal from 0 to 4px", () => {
  it.each(
    thicknessCases([
      "calc(1e309px - 1e309px + 999px)",
      "calc(1e300px + 999px - 1e300px)",
      "calc(-1e400px + 1e400px)",
      "calc(1e-400px + 4px)",
      "calc(4px + 1e-16px)",
      "calc(1px + 1px)",
    ]),
  )("calc fails: %s", (d) => rejects(inModule(d), thicknessMessage));

  it.each(
    thicknessCases([
      "1e-400px",
      "1e-7px",
      "40000000000000000001e-19px",
      "4e0px",
      "+2px",
      "00.5px",
      ".5px",
      "004px",
      "0e5",
      "-0",
      "-0px",
      "0px",
      "0PX",
      "0.0000px",
      "4.0000px",
      "4.0001px",
      "1.50px",
      "4.00001px",
    ]),
  )("spelling fails: %s", (d) => rejects(inModule(d), thicknessMessage));

  it.each(
    thicknessCases([
      "thin",
      "medium",
      "thick",
      "1em",
      "0.1rem",
      "0.1in",
      "1%",
      "1",
      "min(1px, 2px)",
      "max(1px, 2px)",
      "clamp(1px, 2px, 3px)",
    ]),
  )("keyword, unit or function fails: %s", (d) =>
    rejects(inModule(d), thicknessMessage),
  );

  it.each(
    reg([
      "border-width: var(--space-a);",
      "outline-width: var(--accent);",
      "border-width: 1px var(--space-a);",
    ]),
  )("var() fails in a width longhand: %s", (d) =>
    rejects(inModule(d), thicknessMessage),
  );

  it.each(
    thicknessCases([
      "0",
      "1px",
      "1.5px",
      "2px",
      "3px",
      "4px",
      "3.9999px",
      "0.0001px",
    ]),
  )("passes: %s", (d) => accepts(inModule(d)));

  it.each(
    reg([
      ["border-width: 0 1px 2px 4px;", null],
      ["border-block-width: 1px 2px;", null],
      ["border-width: 1px 5px;", thicknessMessage],
      ["border-width: 1px 2px 3px 4px 1px;", /takes 1 to 4 values/],
      ["border-block-width: 1px 2px 3px;", /takes 1 to 2 values/],
      ["border-top-width: 1px 2px;", /takes 1 to 1 values/],
      ["border: 1px 2px solid var(--accent);", /more than one width/],
      ["border: 1px solid solid;", /more than one style/],
      ["border: 1px solid sideways;", /unknown component/],
      ["outline: 1px hidden var(--accent);", /unknown component/],
    ]),
  )("multi-value list %s", (d, pattern) =>
    pattern === null ? accepts(inModule(d)) : rejects(inModule(d), pattern),
  );
});

describe("every visible style states its width", () => {
  it.each(
    reg([
      ["border: solid;", /border must state a width/],
      ["outline: solid;", /outline must state a width/],
      ["border-top: solid var(--accent);", /border-top must state a width/],
      ["border: var(--accent);", /must state a width/],
      ["border: none;", /must state a width/],
      ["border-style: solid;", /border-style needs border-width/],
      ["border-top-style: solid;", /needs border-top-width/],
      ["outline-style: solid;", /needs outline-width/],
      ["border-block-style: solid;", /needs border-block-width/],
      [
        "border-style: none solid; border-width: 1px var(--accent);",
        /border-style needs border-width in the same rule for right, left$/,
      ],
      ["border-top-style: solid; border-width: 1px;", /needs border-top-width/],
      [
        "border-block-start-style: solid; border-top-width: 1px;",
        /needs border-block-start-width/,
      ],
      [
        "border-style: solid; border: 1px solid var(--accent);",
        /needs border-width/,
      ],
      ["border-style: solid; border-width: 5px;", /needs border-width/],
      ["border-style: solid; border-width: 0px;", /thickness takes/],
      [
        "border-inline-style: solid dotted; border-inline-width: 1px 5px;",
        /for end$/,
      ],
      ["border-style: var(--accent);", /unknown component/],
      ["outline-style: hidden;", /unknown component/],
    ]),
  )("fails: %s", (d, pattern) => rejects(inModule(d), pattern));

  it.each(
    reg([
      "border-style: none solid; border-width: 0 2px;",
      "border-style: solid; border-width: 0;",
      "border-style: none solid; border-width: 0;",
      "border-inline-style: solid dotted; border-inline-width: 1px 0;",
      "outline-style: solid; outline-width: 0;",
      "border-style: solid; border-width: 1px;",
      "border-width: 1px; border-style: solid;",
      "border-top-style: solid; border-top-width: 1px;",
      "border-block-style: solid; border-block-width: 1px;",
      "border-inline-end-style: dashed; border-inline-end-width: 2px;",
      "outline-style: solid; outline-width: 2px;",
      "outline-style: auto; outline-width: 3px;",
      "border-style: none;",
      "border-style: hidden none;",
      "outline-style: none;",
      "border: 0;",
      "outline: 0 none;",
    ]),
  )("passes: %s", (d) => accepts(inModule(d)));

  const [split] = reg(
    [
      "@layer components {\n  .x {\n    border-width: 1px;\n  }\n  .y {\n    border-style: solid;\n  }\n}\n",
    ],
    (row) => row,
  );
  it("fails when the width is only in another rule", () =>
    rejects(split, /needs border-width/));
});

describe("outline-offset is a literal from -4px to 4px", () => {
  it.each(
    reg(
      [
        "2em",
        "1e3px",
        "5px",
        "-5px",
        "-0",
        "-0px",
        "0px",
        "0.5rem",
        "4.0001px",
        "calc(1px + 1px)",
        "var(--space-a)",
        "1px 1px",
      ],
      (v) => inModule(`outline-offset: ${v};`),
    ),
  )("fails: %s", (v) =>
    rejects(inModule(`outline-offset: ${v};`), /outline-offset takes/),
  );

  it.each(
    reg(["0", "2px", "-3px", "4px", "-4px"], (v) =>
      inModule(`outline-offset: ${v};`),
    ),
  )("passes: %s", (v) => accepts(inModule(`outline-offset: ${v};`)));
});

describe("opaque alpha is spelled 100%", () => {
  const tokens = (value) =>
    fixtureTokens({ light: { "--accent": `rgb(0 0 0 / ${value})` } });
  // Its own root, so the production lint here does not also lint every case file.
  let alpha;
  beforeAll(() => {
    ({ paths: alpha } = makeRoot());
  });

  it.each(["9999999999999999999e-17%", "100.0%", "1.0", "1"])(
    "fails: %s",
    (value) =>
      rejects(
        tokens(value),
        /--accent must be opaque/,
        alpha.tokensFile,
        alpha,
      ),
  );

  it.each(["100%"])("passes: %s", (value) =>
    accepts(tokens(value), alpha.tokensFile, alpha),
  );
});

describe("media queries are an exact allowlist", () => {
  const sheet = (query) =>
    `@layer components {\n  @media ${query} {\n    .x {\n      color: var(--text);\n    }\n  }\n}\n`;

  it.each(
    reg(
      [
        "(width <= 47.5rem)",
        "(width <= 65rem)",
        "(width > 65rem)",
        "(65rem < width <= 74.9375rem)",
        "(WIDTH <= 65REM)",
        "print",
        "(prefers-color-scheme: dark)",
        "(prefers-reduced-motion: reduce)",
        "(prefers-reduced-motion: no-preference)",
      ],
      sheet,
    ),
  )("passes: %s", (query) => accepts(sheet(query)));

  it.each(
    reg(
      [
        "(width >= 1041px)",
        "(width > 1041px)",
        "(width <= 1040px)",
        "(max-width: 1040px)",
        "(min-width: 65rem)",
        "(width <= 65.0rem)",
        "(width <= 6.5e1rem)",
        "(width < 65rem)",
        "(width <= 64rem)",
        "(65rem < width <= 75rem)",
        "(width<=65rem)",
        "(aspect-ratio > 16/9)",
        "(min-aspect-ratio: 16/9)",
        "(width <= calc(65rem))",
        "(width <= min(65rem, 100vw))",
        "screen",
        "print, screen",
        "not print",
        "print and (width <= 65rem)",
        "(width <= 65rem) and (width > 47.5rem)",
        "(prefers-color-scheme: light)",
        "(prefers-color-scheme:light)",
        "(prefers-color-scheme: blue)",
      ],
      sheet,
    ),
  )("fails: %s", (query) => rejects(sheet(query), /is not an allowed query/));
});

describe("banned properties", () => {
  const columnRule = webref.properties
    .map((p) => p.name)
    .filter((name) => name.startsWith("column-rule"));

  it("the pinned grammar still lists the column-rule family", () => {
    expect(columnRule).toContain("column-rule-width");
    expect(columnRule.length).toBeGreaterThan(4);
  });

  it.each(reg(columnRule, (prop) => inModule(`${prop}: solid;`)))(
    "%s fails",
    (prop) =>
      rejects(inModule(`${prop}: solid;`), /column-rule family is banned/),
  );

  it.each(
    reg([
      "column-rule: solid var(--accent);",
      "column-rule: 1px solid var(--accent);",
      "column-rule-width: 1px;",
      "column-rule-color: var(--accent);",
      "Column-Rule: 1px solid var(--accent);",
    ]),
  )("fails: %s", (d) => rejects(inModule(d), /column-rule family is banned/));

  it.each(reg(["stroke-width: 1;", "stroke-width: 1px;", "STROKE-WIDTH: 0;"]))(
    "fails: %s",
    (d) => rejects(inModule(d), /stroke-width is not allowed/),
  );
});

describe("composes is banned", () => {
  const layer = (body) => `@layer components {\n${body}\n}\n`;
  it.each(
    reg(
      [
        ["local", inModule("composes: base;")],
        ["several", inModule("composes: a b;")],
        ["from a string", inModule('composes: base from "./base.module.css";')],
        ["from global", inModule("composes: base from global;")],
        ["upper case", inModule("COMPOSES: base;")],
        ["mixed case", inModule("Composes: base;")],
        [
          "nested",
          layer(
            "  .x {\n    color: var(--text);\n    .y {\n      composes: base;\n    }\n  }",
          ),
        ],
        [
          "in @media",
          layer(
            "  @media print {\n    .x {\n      composes: base;\n    }\n  }",
          ),
        ],
      ],
      (row) => row[1],
    ),
  )("%s fails", (_form, code) => rejects(code, /composes is not allowed/));
});
