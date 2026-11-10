// @vitest-environment node
import { fork } from "css-tree";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  colourFunctions,
  deprecatedColours,
  namedColours,
  systemColours,
} from "./colours.js";
import {
  fixtureTokens,
  inModule,
  lintAs,
  lintComposed,
  makeRoot,
  write,
} from "./harness.js";

const webref = createRequire(import.meta.url)("@webref/css/css.json");
const webrefLexer = fork({
  types: Object.fromEntries(
    [...webref.types, ...webref.functions]
      .filter((entry) => entry.syntax)
      .map((entry) => [entry.name, entry.syntax]),
  ),
}).lexer;

let paths;
beforeAll(() => {
  ({ paths } = makeRoot());
  write(paths.headerModule, inModule("background: var(--header-bg);"));
});

// A case names its sheet by role, so the same case can be placed in any fixture root.
const at = (place, code) => ({ place, code });
const componentAt = (p) => join(p.src, "components", "Panel.module.css");
const entryAt = (p) => p.entryFile;
const inComponent = (declarations) => at(componentAt, inModule(declarations));
const asTokens = (code) => at((p) => p.tokensFile, code);
const lint = (c) => lintAs(paths, c.place(paths), c.code);

async function fails(c) {
  const r = await lint(c);
  expect(r.invalid).toEqual([]);
  expect(r.contract.length).toBeGreaterThan(0);
}
async function passes(c) {
  const r = await lint(c);
  expect(r.invalid).toEqual([]);
  expect(r.all.map((w) => w.text)).toEqual([]);
  expect(await lintComposed(c.place, c.code)).toEqual({
    state: "pass",
    lines: [],
  });
}

const pair = "font-size: var(--fs-body); line-height: var(--lh-body);";

// Suites timed at 30_000 run the real Stylelint, which loads cold the first time.

describe("colour literals", () => {
  it.each([
    ["A1", "color: #fff"],
    ["A1", "color: #FFF"],
    ["A1", "color: #ffffff"],
    ["A1", "color: #ffff"],
    ["A1", "color: #FFFFFF80"],
    ["A2", "color: red"],
    ["A2", "color: RED"],
    ["A2", "color: Red"],
    ["A2", "color: rebeccapurple"],
    ...[
      "rgb(0 0 0)",
      "RGB(0 0 0)",
      "rgba(0,0,0,1)",
      "hsl(0 0% 0%)",
      "hwb(0 0% 0%)",
    ].map((v) => ["A3", `color: ${v}`]),
    ...["lab(0 0 0)", "lch(0 0 0)", "oklab(0 0 0)", "oklch(0 0 0)"].map((v) => [
      "A3",
      `color: ${v}`,
    ]),
    ["A4", "color: color(display-p3 1 0 0)"],
    ["A4", "color: color-mix(in oklch, var(--accent), white)"],
    ["A4", "color: color-mix(in srgb, var(--accent), var(--text))"],
    ["A5", "color: rgb(from var(--accent) r g b / 50%)"],
    ["A6", "color: light-dark(var(--accent), var(--text))"],
    ["A7", "border: 1px solid red"],
    ["A7", "background: url(x.png) #fff"],
    ["A7", "box-shadow: 0 0 0 2px #000"],
    ["A8", "background: linear-gradient(#fff, var(--bg))"],
    ["A9", "color: var(--accent, #fff)"],
    ["A9", "color: var(--accent, var(--text, red))"],
    ["A11", "color: var(--nope)"],
    ["A11", "color: var(--accent, var(--nope))"],
    ["A12", "color: \\72 ed"],
    ["A12", "color: r\\65 d"],
    ["A12", "color: \\23 fff"],
    ["A12", "color: var(\\2d-accent)"],
    ["A13", "color: #f/**/ff"],
    ["A13", "color: /* #fff */ var(--text)"],
    ["A15", "mask: url(#m)"],
    ["A16", 'background-image: url("data:image/svg+xml,x")'],
    ["A17", "color: rgb("],
    ["A17", "color: var(--accent))"],
    ["A20", "color: inherit"],
    ["A20", "color: revert-layer"],
    ["A25", "color: -webkit-linear-gradient(red, blue)"],
    ["A25", "color: attr(data-c type(<color>))"],
    ["A25", "color: env(x)"],
    ["A28", "animation-name: red"],
    ["A29", "background: #0000"],
    ["A29", "background-color: rgb(0 0 0 / 0)"],
    ["A29", "border-color: #00000000"],
    ["A30", "\\63 olor: #fff"],
    ...[...deprecatedColours].flatMap((c) => {
      const mixed = c.slice(0, 1).toUpperCase() + c.slice(1);
      return [
        ["A19", `color: ${mixed}`],
        ["A19", `border: 1px solid ${mixed}`],
      ];
    }),
  ])("%s fails: %s", (_id, declaration) =>
    fails(inComponent(`${declaration};`)),
  );

  it.each([
    ["A10", "color: var(--accent)"],
    ["A10", "color: var(--accent,)"],
    ["A10", "color: var(--accent, var(--text))"],
    ["A14", 'content: "#fff"'],
    ["A14", 'font-family: "Red Hat", sans-serif'],
    ["A18", "color: transparent"],
    ["A18", "color: currentColor"],
    ["A18", "color: CanvasText"],
    ["A18", "color: canvas"],
    ["A18", "color: AccentColor"],
    ["A20", "color: currentColor"],
  ])("%s passes: %s", (_id, declaration) =>
    passes(inComponent(`${declaration};`)),
  );

  it("A17 fails on an unclosed string", () =>
    fails(inComponent('content: "x;')));
}, 30_000);

describe("spacing, type and px", () => {
  it.each([
    ["A21", "margin: var(--space-a) auto"],
    ["A21", "margin: 0 var(--space-neg-a)"],
    ["A21", "gap: var(--space-a) var(--space-b)"],
    ["A23", pair],
    ["A24", "border-width: 2px"],
    ["A24", "border-bottom: 1.5px dotted var(--accent)"],
    ["A24", "outline-offset: 2px"],
    ["A31", "border-inline-start-width: 2px"],
    ["A32", "border-width: 2PX"],
    ["A33", "border: 0"],
    ["A33", "border-width: 1.5px"],
    ["A33", "border-width: 1px 2px"],
    ["A33", "border-width: 1px"],
    ["A33", "border-bottom: 1.5px solid var(--accent)"],
    ["A33", "border-left: 2px solid var(--accent)"],
    ["A33", "outline: 3px solid var(--accent)"],
    ["A33", "border-top: 4px solid var(--accent)"],
    ["A33", "border-width: 0 0 4px"],
    ["A48", "font-size: var(--fs-hero); line-height: var(--lh-hero)"],
    ["A48", "font-size: var(--fs-wordmark); line-height: var(--lh-wordmark)"],
    ["A50", "width: 1.625rem"],
    ["A50", "filter: blur(0.625rem)"],
    ["A50", "max-width: 80rem"],
    ["A50", "top: calc(100% + 0.5rem)"],
    ["A50", "box-shadow: 0 0.125rem 0.5rem var(--shadow-lift)"],
    ["A50", "width: 0.0625rem; height: 0.0625rem"],
    ["A50", "left: -0.875rem"],
    ["A51", "border-radius: var(--radius-a)"],
    ["A51", "border-top-left-radius: 0"],
    ["A53", "box-shadow: inset 0 0.125rem 0.1875rem var(--shadow-press)"],
    ["A57", "outline: 4px solid var(--accent-soft)"],
    ["A57", "outline: 3px solid var(--accent-soft)"],
    ["A57", "outline-width: 3px"],
    ["A57", "outline-offset: 0"],
    ["A58", "font: inherit"],
    ["A60", "top: 50%"],
    ["A60", "top: 0"],
    ["A60", "top: calc(100% + 0.5rem)"],
    ["A60", "height: calc(1.3em + 1.625rem)"],
  ])("%s passes: %s", (_id, declaration) =>
    passes(inComponent(`${declaration};`)),
  );

  it.each([
    ["A22", "margin: 3px"],
    ["A22", "padding: 1rem"],
    ["A22", "padding: var(--space-neg-a)"],
    ["A22", "gap: var(--space-neg-a)"],
    ["A22", "margin: calc(-1 * var(--space-a))"],
    ["A22", "margin-inline: var(--fs-body)"],
    ["A23", "font-size: 15px; line-height: var(--lh-body)"],
    ["A23", "font-size: 1rem; line-height: var(--lh-body)"],
    ["A23", "font: 1rem/1.5 x"],
    ["A24", "border-width: 5px"],
    ["A24", "width: 3px"],
    ["A24", "height: 2px"],
    ["A24", "top: 1px"],
    ["A31", "border-spacing: 2px"],
    ["A31", "border-image-width: 2px"],
    ["A31", "border-image-outset: 2px"],
    ["A31", "margin-trim: var(--space-a)"],
    ["A32", "margin: 3PX"],
    ["A32", "padding: 1REM"],
    ["A32", "font-size: 1Rem; line-height: var(--lh-body)"],
    ["A32", "border-width: 5Px"],
    ["A33", "border-width: calc(3px + 1px)"],
    ["A33", "border: calc(1px + 1px) solid var(--accent)"],
    ["A33", "outline: calc(3px + 1px) solid var(--accent)"],
    ["A33", "border-inline-start: calc(2px - 1px) solid var(--accent)"],
    ["A33", "outline-offset: 0.5rem"],
    ["A33", "border-width: calc(4px + 4px)"],
    ["A33", "border-width: calc(1px * var(--space-a))"],
    ["A33", "border: calc(4px + 4px) solid var(--accent)"],
    ["A33", "outline: calc(4px + 1px) solid var(--accent)"],
    ["A33", "border-top: calc(1px * 2) solid var(--accent)"],
    ["A33", "border-width: max(calc(1px + 1px), 1px)"],
    ["A33", "border: 2rem solid var(--accent)"],
    ["A33", "border-width: 1em"],
    ["A33", "border-width: thin"],
    ["A33", "border: 0.1in solid var(--accent)"],
    ["A33", "outline: medium solid var(--accent)"],
    ["A33", "border-width: 1px 2rem"],
    ["A33", "outline: thick solid var(--accent)"],
    ["A33", "outline-width: 1pt"],
    ["A33", "border-top-width: 1mm"],
    ["A33", "border-width: 1"],
    ["A33", "border-width: min(1px, 2px)"],
    ["A35", "margin: var(--fs-body)"],
    ["A35", "font-size: var(--space-a); line-height: var(--lh-body)"],
    ["A35", "font-size: var(--fs-body); line-height: var(--fs-body)"],
    ["A35", "color: var(--space-a)"],
    ["A35", "width: var(--accent)"],
    ["A35", "font-family: var(--prose)"],
    ["A37", "--accent: #286773"],
    ["A37", "--local: 1rem"],
    ["A43", "color: var(--text) !important"],
    ["A48", "font-size: var(--fs-code); line-height: var(--lh-body)"],
    ["A48", "font-size: var(--fs-body); line-height: var(--lh-subtitle)"],
    ["A48", "font-size: var(--fs-body)"],
    ["A48", "line-height: 1.6"],
    ["A49", "border-radius: 10px"],
    ["A49", "width: 26px"],
    ["A49", "width: 8px"],
    ["A49", "filter: blur(10px)"],
    ["A49", "max-width: 1280px"],
    ["A49", "grid-template-columns: 240px 1fr"],
    ["A49", "top: calc(100% + 8px)"],
    ["A49", "box-shadow: 0 2px 8px var(--shadow-lift)"],
    ["A49", "border-width: 4.5px"],
    ["A51", "border-radius: 0.625rem"],
    ["A51", "border-radius: var(--space-a)"],
    ["A52", "background-color: var(--shadow-pop)"],
    ["A52", "border-color: var(--shadow-lift)"],
    ["A56", "forced-color-adjust: none"],
    ["A56", "forced-color-adjust: auto"],
    ["A56", "forced-color-adjust: preserve-parent-color"],
    ["A59", "font: 14px/1.4 sans-serif"],
    ["A59", "font: initial"],
    ["A59", "font: inherit; font-size: 0.8rem"],
    ["A59", "font-size: unset; line-height: var(--lh-body)"],
    ["A59", "font-size: var(--fs-body); line-height: initial"],
    ["A59", "margin: revert"],
    ["A59", "color: inherit"],
    ["A61", "height: calc(1.3em + 26px)"],
    ["A61", "top: calc(50% - 2px)"],
  ])("%s fails: %s", (_id, declaration) =>
    fails(inComponent(`${declaration};`)),
  );

  it("A37 fails on a root override in a component", () =>
    fails(
      at(
        componentAt,
        "@layer components {\n  :root {\n    --space-a: 2rem;\n  }\n}\n",
      ),
    ));
}, 30_000);

describe("at-rules and media", () => {
  const sheet = (body) => at(componentAt, `@layer components {\n${body}\n}\n`);
  it.each([
    [
      "A26",
      '@property --x { syntax: "<color>"; initial-value: #f00; inherits: false; }',
    ],
    ["A26", '@import "x.css";'],
    ["A26", "@supports (color: red) { .x { color: var(--text); } }"],
    ["A30", "@\\6d edia print { .x { color: var(--text); } }"],
    ["A30", "@la\\79 er x { .x { color: var(--text); } }"],
    ["A30", "@media (width <= 65\\72 em) { .x { color: var(--text); } }"],
    ["A45", "@media /* x */ (width <= 65rem) { .x { color: var(--text); } }"],
    ["A45", "@media (width <= 65rem)/**/ { .x { color: var(--text); } }"],
    ["A45", "@media (width <= 40vw) { .x { color: var(--text); } }"],
    ["A24", "@media (width <= 1040px) { .x { color: var(--text); } }"],
  ])("%s fails: %s", (_id, body) => fails(sheet(body)));

  it.each([["A45", "@media (width <= 65REM) { .x { color: var(--text); } }"]])(
    "%s passes: %s",
    (_id, body) => passes(sheet(body)),
  );
}, 30_000);

describe("@import ban", () => {
  // A leading escape leaves PostCSS without an at-rule name, so it is a syntax error.
  const reason =
    /^(@import is not allowed|escape in an at-rule|At-rule without name) \(/;
  const sheets = {
    module: componentAt,
    global: (p) => join(p.src, "styles", "base.css"),
    entry: entryAt,
  };
  const spellings = [
    '@import "x.css";',
    '@IMPORT "x.css";',
    '@\\69mport "x.css";',
    '@\\000069mport "x.css" layer(base);',
    "@im\\70 ort url(x.css);",
  ];
  it.each(
    Object.keys(sheets).flatMap((sheet) =>
      spellings.flatMap((spelling) => [
        [sheet, "top level", spelling, `${spelling}\n@layer base;\n`],
        [sheet, "in @layer", spelling, `@layer base {\n  ${spelling}\n}\n`],
      ]),
    ),
  )("A26 fails in %s CSS, %s: %s", async (sheet, _at, _spelling, code) => {
    const r = await lint(at(sheets[sheet], code));
    expect(r.invalid).toEqual([]);
    expect(r.contract.some((w) => reason.test(w.text))).toBe(true);
  });
}, 30_000);

describe("tokens.css", () => {
  const replaced = (name, value) =>
    asTokens(fixtureTokens({ light: { [name]: value } }));
  const extra = (block) => asTokens(fixtureTokens({ extra: block }));

  it("passes the complete fixture tokens", () =>
    passes(asTokens(fixtureTokens())));

  it.each([
    ["A27", "#286773"],
    ["A27", "rgb(40 103 115)"],
    ["A27", "oklch(50% 0.1 200deg)"],
    ["A27", "teal"],
    ["A27", "transparent"],
  ])("%s passes --accent: %s", (_id, value) =>
    passes(replaced("--accent", value)),
  );

  it.each([
    "rgb(foo bar baz)",
    "color(banana 1 2 3)",
    "rgb(0 0 0 /)",
    "rgb(0 0 0 0)",
    "hsl(1 2 3 4 5)",
    "rgb(0, 0 0)",
  ])("A27 fails --accent outside the <color> grammar: %s", async (value) => {
    const r = await lint(replaced("--accent", value));
    expect(r.contract.map((w) => w.text).join()).toContain("<color> grammar");
  });

  it.each([
    "rgb(0 0 0 / 100%)",
    "color(display-p3 1 0 0)",
    "hwb(200deg 10% 10%)",
    "lab(50% 20 30)",
  ])("A27 passes --accent inside the <color> grammar: %s", (value) =>
    passes(replaced("--accent", value)),
  );

  it.each([
    ["A19", "--accent", "ButtonHighlight"],
    ["A34", "--space-a", "0.55rem"],
    ["A34", "--fs-body", "1.05rem"],
    ["A34", "--lh-body", "1.5"],
    ["A34", "--lh-wordmark", "1.4"],
    ["A34", "--lh-hero", "1.16"],
    ["A36", "--space-a", "var(--space-b)"],
    ["A36", "--accent", "var(--warm)"],
    ["A36", "--bg", "var(--surface, #fff)"],
    ["A36", "--bg", "var(--nope)"],
    ["A38", "--accent", "color-mix(in srgb, #fff, #000)"],
    ["A38", "--accent", "color-mix(in srgb, var(--accent), #fff)"],
    ["A39", "--accent", "rgb(from #286773 r g b)"],
    ["A39", "--accent", "#fff #000"],
    ["A39", "--accent", "linear-gradient(#fff, #000)"],
    ["A39", "--accent", "1px solid #fff"],
    ["A40", "--accent", "\\72 gb(1 2 3)"],
    ["A40", "--accent", "RGB\\28 1 2 3)"],
    ["A41", "--accent-soft", "rgb(231 239 241 / 50%)"],
    ["A41", "--bad-soft", "#f8e7e980"],
    ["A41", "--header-bg", "rgb(243 245 248 / 87%)"],
    ["A41", "--header-bg", "rgb(243 245 248 / 89%)"],
    ["A41", "--header-bg", "#F3F5F8E0"],
    ["A42", "--prose", "68ch red"],
    ["A43", "--bg", "#f3f5f8 !important"],
    ["A51", "--radius-pill", "1rem"],
    ["A52", "--shadow-press", "rgb(0 0 0 / 19%)"],
    ["A52", "--shadow-lift", "#10182814"],
    ["A53", "--ok", "var(--second)"],
    ["A54", "--fs-fixture-a", "0.844rem"],
    ["A54", "--fs-fixture-a", "0.84375rem"],
    ["A54", "--fs-fixture-a", "13.5px"],
  ])("%s fails %s: %s", (_id, name, value) => fails(replaced(name, value)));

  it.each([
    ["A34", "  :root {\n    --space-z: 1.75rem;\n  }"],
    ["A34", "  :root {\n    --sp-4: 1rem;\n  }"],
    ["A30", "  :root {\n    --\\61 ccent: #fff;\n  }"],
    ["A52", "  :root {\n    --shadow-x: rgb(0 0 0 / 10%);\n  }"],
    [
      "A52",
      '  [data-theme="dark"] .work {\n    --shadow-pop: rgb(16 24 40 / 13%);\n  }',
    ],
    [
      "A55",
      "  @media print {\n    :root[data-theme],\n    :root:not([data-theme]) {\n      --bg: #F3F5F8;\n      --bg: #FFFFFF;\n    }\n  }",
    ],
    ["A36", "  :root {\n    --a: var(--b);\n    --b: var(--a);\n  }"],
  ])("%s fails with an extra block", (_id, block) => fails(extra(block)));

  it("A34 fails when a registry name is missing", () =>
    fails(asTokens(fixtureTokens({ omit: ["--space-b"] }))));
  it("A42 passes the layout tokens", () =>
    passes(replaced("--font-ui", '"Inter", system-ui, sans-serif')));
  it("A53 passes the exact shadow and ok literals in every context", () =>
    passes(
      extra(
        '  [data-theme="dark"] .work {\n    --shadow-pop: rgb(16 24 40 / 12%);\n    --ok: #86D9A6;\n  }',
      ),
    ));
  it("A54 passes the source spelling", () =>
    passes(replaced("--fs-fixture-a", "0.8438rem")));
}, 30_000);

describe("runtime-only --split", () => {
  const grid = (value) =>
    inComponent(`display: grid; grid-template-columns: ${value};`);
  const declared = "--split is set at run time and never declared";
  const inBase = "@layer base {\n  body {\n    --split: 22.5rem;\n  }\n}\n";
  const inRoot = "  :root {\n    --split: 22.5rem;\n  }";

  it.each([
    ["tokens.css", (p) => p.tokensFile, fixtureTokens({ extra: inRoot })],
    ["a module", componentAt, inModule("--split: 22.5rem;")],
    ["a global sheet", (p) => join(p.src, "theme", "base.css"), inBase],
  ])(
    "A42 a declaration of --split fails in %s",
    async (_label, place, code) => {
      const r = await lint(at(place, code));
      expect(r.invalid).toEqual([]);
      expect(r.contract.map((w) => w.text).join()).toContain(declared);
    },
  );

  it.each(["minmax(0, 1fr) 22.5rem", "1fr 2fr", "repeat(2, 1fr)"])(
    "A42 var(--split, %s) in grid-template-columns passes",
    (fallback) => passes(grid(`var(--split, ${fallback})`)),
  );

  const invalid = "fallback is not a grid-template-columns value";
  const only = "allowed only in grid-template-columns";
  it.each([
    ["missing fallback", grid("var(--split)"), "needs a fallback"],
    ["empty fallback", grid("var(--split,)"), "needs a fallback"],
    ["blank fallback", grid("var(--split, )"), "needs a fallback"],
    ["invalid fallback", grid("var(--split, red)"), invalid],
    ["invalid fallback", grid("var(--split, 1px solid)"), invalid],
    [
      "part of a value",
      grid("var(--split, 1fr) 2fr"),
      "must be the whole value",
    ],
    ["in width", inComponent("width: var(--split, 1fr);"), only],
    ["in margin", inComponent("margin: var(--split, 1rem);"), only],
    [
      "in grid-template-rows",
      inComponent("grid-template-rows: var(--split, 1fr);"),
      only,
    ],
  ])("A42 --split fails: %s", async (_label, c, message) => {
    const r = await lint(c);
    expect(r.invalid).toEqual([]);
    expect(r.contract.map((w) => w.text).join()).toContain(message);
  });
}, 30_000);

describe("inline disable comments", () => {
  const wrap = (body, head = "") =>
    `${head}@layer components {\n  .x {\n${body}\n  }\n}\n`;
  const bad = "color: red !important; padding: 999px;";
  const rules = "sharpladder/tokens, color-named, declaration-no-important";
  it.each([
    ["block", wrap(`    ${bad}`, "/* stylelint-disable */\n")],
    [
      "rule-specific block",
      wrap(`    ${bad}`, `/* stylelint-disable ${rules} */\n`),
    ],
    ["next-line", wrap(`    /* stylelint-disable-next-line */\n    ${bad}`)],
    [
      "rule-specific next-line",
      wrap(`    /* stylelint-disable-next-line ${rules} */\n    ${bad}`),
    ],
    ["line", wrap(`    ${bad} /* stylelint-disable-line */`)],
    [
      "rule-specific line",
      wrap(`    ${bad} /* stylelint-disable-line ${rules} */`),
    ],
  ])("a %s disable comment leaves the rules on", async (_form, code) => {
    const r = await lint(at(componentAt, code));
    const texts = r.contract.map((w) => w.text).join("\n");
    expect(texts).toContain("named colour red");
    expect(texts).toContain("Disallowed !important");
    expect(texts).toContain("padding takes registry tokens only");
  });
}, 30_000);

describe("tokens.css context (G3)", () => {
  const block = (css) => asTokens(fixtureTokens({ extra: css }));
  const ok = "--ok: #1B6B3A;";
  it("A63 :root inside @media print is not light", () =>
    fails(block(`  @media print {\n    :root {\n      ${ok}\n    }\n  }`)));
  it.each(["print, screen", "print and (width > 1px)"])(
    "A64 @media %s is not print",
    (m) =>
      fails(
        block(
          `  @media ${m} {\n    :root[data-theme],\n    :root:not([data-theme]) {\n      ${ok}\n    }\n  }`,
        ),
      ),
  );
  it("A65 a reordered print list is print", () =>
    passes(
      block(
        `  @media print {\n    :root:not([data-theme]),\n    :root[data-theme] {\n      ${ok}\n    }\n  }`,
      ),
    ));
  it.each([
    '[*|data-theme="dark"]',
    '[ns|data-theme="dark"]',
    '[|data-theme="dark"]',
    '[data-theme="dark" i]',
    '[data-theme="dark" s]',
    '[data-theme~="dark"]',
    '[data-theme|="dark"]',
    '[data-theme="d\\61rk"]',
    '[data-the\\6d e="dark"]',
  ])("A66 explicit dark spelled %s is not recognised", (selector) =>
    fails(block(`  ${selector} {\n    --ok: #86D9A6;\n  }`)),
  );
  it.each(["[data-theme='dark']"])(
    "A66 explicit dark with quoting %s is recognised",
    (selector) => passes(block(`  ${selector} {\n    --ok: #86D9A6;\n  }`)),
  );
  it.each([":root:not([*|data-theme])", ":root:not([ns|data-theme])"])(
    "A66 system dark spelled %s is not recognised",
    (selector) =>
      fails(
        block(
          `  @media (prefers-color-scheme: dark) {\n    ${selector} {\n      --ok: #86D9A6;\n    }\n  }`,
        ),
      ),
  );
  it("A66 a namespaced print selector is not recognised", () =>
    fails(
      block(
        `  @media print {\n    :root[*|data-theme],\n    :root:not([data-theme]) {\n      ${ok}\n    }\n  }`,
      ),
    ));
  it("A66 a case-changed attribute value is not recognised", () =>
    fails(block(`  [data-theme="Dark"] {\n    --ok: #86D9A6;\n  }`)));
  it("A67 both nesting orders are recognised", async () => {
    const dark = "--ok: #86D9A6;";
    await passes(
      asTokens(
        `${fixtureTokens()}
@media (prefers-color-scheme: dark) {\n  @layer tokens {\n    :root:not([data-theme]) {\n      ${dark}\n    }\n  }\n}\n`,
      ),
    );
    await passes(
      block(
        `  @media (prefers-color-scheme: dark) {\n    :root:not([data-theme]) .work {\n      ${dark}\n    }\n  }`,
      ),
    );
  });
}, 30_000);

describe("layers and structure", () => {
  it.each([
    ["A44 unlayered rule", ".x {\n  color: var(--text);\n}\n"],
    [
      "A44 two top-level nodes",
      "@layer components {\n  .x {\n    color: var(--text);\n  }\n}\n@layer components {\n  .y {\n    color: var(--text);\n  }\n}\n",
    ],
    [
      "A44 module in overrides",
      "@layer overrides {\n  .x {\n    color: var(--text);\n  }\n}\n",
    ],
  ])("%s fails", (_id, code) => fails(at(componentAt, code)));

  it("A44 a tokens.css rule outside @layer tokens fails", () =>
    fails(asTokens(`${fixtureTokens()}:root {\n  --ok: #1B6B3A;\n}\n`)));
  it("A44 an entry stylesheet without the layer order first fails", () =>
    fails(
      at(entryAt, "@layer base {\n  body {\n    color: var(--text);\n  }\n}\n"),
    ));
  it("A44 the entry stylesheet with the order statement passes", () =>
    passes(at(entryAt, fixtureTokens())));
  it("A58 a base reset with font: inherit passes", () =>
    passes(
      at(
        (p) => join(p.src, "base.css"),
        "@layer base {\n  button {\n    font: inherit;\n    color: currentColor;\n  }\n}\n",
      ),
    ));
}, 30_000);

describe("adversarial cases through the production lint", () => {
  async function rejected(c, ...messages) {
    const { state, lines } = await lintComposed(c.place, c.code);
    expect(state).toBe("fail");
    for (const m of messages) expect(lines.join("\n")).toContain(m);
  }
  const globalAt = (p) => join(p.src, "styles", "base.css");
  const accent = (value) =>
    asTokens(fixtureTokens({ light: { "--accent": value } }));
  const resource = "() is not allowed in a stylesheet";
  const statement =
    "a @layer statement is allowed only as the first rule of the entry stylesheet";
  const order = "@layer tokens, base, components, overrides;\n";
  const based = "@layer base {\n  body {\n    color: var(--text);\n  }\n}\n";
  const media = (params) =>
    at(
      componentAt,
      `@layer components {\n  @${params} {\n    .x {\n      color: var(--text);\n    }\n  }\n}\n`,
    );

  it.each([
    ["relative path", inComponent('background: url("../outside/hidden.css");')],
    ["image-set", inComponent("background-image: image-set(url(a.png) 1x);")],
    [
      "-webkit-image-set",
      inComponent('background-image: -webkit-image-set("a.png" 1x);'),
    ],
    [
      "nested in a gradient",
      inComponent("background: linear-gradient(url(a))"),
    ],
    ["fragment", inComponent("mask: url(#m);")],
    ["quoted data:", inComponent('background: url("data:image/png,x");')],
    ["unquoted data:", inComponent("background: url(data:image/png,x);")],
    ["unquoted", inComponent("background: url(x);")],
    ["upper case", inComponent('background: URL("x");')],
    ["src()", inComponent('background: src("x");')],
    ["in a line shorthand", inComponent("border: 1px solid url(x);")],
    ["in a spacing property", inComponent("margin: url(x);")],
    ["custom property in a module", inComponent("--x: url(x);")],
    [
      "custom property in tokens.css",
      asTokens(fixtureTokens({ light: { "--prose": "url(x)" } })),
    ],
    ["@supports parameters", media('supports (background: url("x"))')],
    ["@media parameters", media('media url("x")')],
  ])("url() family fails: %s", (_label, c) => rejected(c, resource));

  it.each([
    ['background: u\\72l("x");', "escape in a declaration"],
    ["background: u\\72l(x);", "escape in a declaration"],
  ])("url() family fails with an escaped function name: %s", (d, message) =>
    rejected(inComponent(d), message),
  );

  it.each([
    [
      "@media print { @layer a, b; }",
      globalAt,
      "@media print {\n  @layer a, b;\n}\n",
    ],
    [
      "@layer base { @layer x, y; }",
      globalAt,
      "@layer base {\n  @layer x, y;\n}\n",
    ],
    ["top level in a global sheet", globalAt, `@layer a, b;\n${based}`],
    [
      "top level in tokens.css",
      (p) => p.tokensFile,
      `${order}\n${fixtureTokens()}`,
    ],
    [
      "in a module layer",
      componentAt,
      "@layer components {\n  @layer x, y;\n\n  .a {\n    color: var(--text);\n  }\n}\n",
    ],
    [
      "in @media in a module layer",
      componentAt,
      "@layer components {\n  @media print {\n    @layer a;\n  }\n}\n",
    ],
    ["a second entry statement", entryAt, `${order}${order}`],
    ["the entry statement not first", entryAt, `${based}${order}`],
  ])("a @layer statement fails: %s", (_label, place, code) =>
    rejected(at(place, code), statement),
  );

  it.each([
    [
      "nested",
      "@layer components {\n  @layer x {\n    .a {\n      color: var(--text);\n    }\n  }\n}\n",
      "@layer x is nested in another @layer",
    ],
    [
      "dotted",
      "@layer components.x {\n  .a {\n    color: var(--text);\n  }\n}\n",
      "@layer components.x; expected components",
    ],
  ])("a %s block layer name fails", (_label, code, message) =>
    rejected(at(componentAt, code), message),
  );

  it("the canonical entry statement first passes", () =>
    passes(at(entryAt, fixtureTokens())));
  it("a reordered entry statement fails", () =>
    rejected(
      at(entryAt, "@layer base, tokens, components, overrides;\n"),
      "the entry stylesheet must start with @layer tokens, base, components, overrides;",
    ));
  it("an entry statement that is not first also fails the order check", () =>
    rejected(
      at(entryAt, `${based}${order}`),
      "the entry stylesheet must start with",
    ));

  it.each([
    [
      inComponent("border-width: 0px;"),
      "thickness takes bare 0",
      "length-zero-no-unit",
    ],
    [
      inComponent("border: 0px solid var(--accent);"),
      "thickness takes bare 0",
      "length-zero-no-unit",
    ],
    [
      inComponent("outline-offset: 0px;"),
      "outline-offset takes bare 0",
      "length-zero-no-unit",
    ],
    [
      accent("rgb(0 0 0 / 1)"),
      "--accent must be opaque",
      "alpha-value-notation",
    ],
    [
      accent("rgba(0, 0, 0, 1)"),
      "--accent must be opaque",
      "alpha-value-notation",
    ],
  ])("literal %# fails under both rules", (c, token, inherited) =>
    rejected(c, `${token}`, `(${inherited})`),
  );

  it.each([
    inComponent("border-width: 0;"),
    inComponent("outline-offset: 0;"),
    accent("rgb(0 0 0 / 100%)"),
  ])("literal %# passes with no warning from any rule", (c) => passes(c));
}, 30_000);

describe("composed configuration and webref data", () => {
  // The token rule accepts these; only the inherited spelling rule rejects them.
  it.each([
    ["value-keyword-case", inComponent("color: currentcolor;")],
    [
      "color-function-notation",
      asTokens(fixtureTokens({ light: { "--accent": "rgb(0, 0, 0)" } })),
    ],
    [
      "function-name-case",
      asTokens(fixtureTokens({ light: { "--accent": "RGB(0 0 0)" } })),
    ],
    [
      "selector-attribute-quotes",
      asTokens(
        fixtureTokens({
          extra: "  [data-theme=dark] {\n    --ok: #86D9A6;\n  }",
        }),
      ),
    ],
  ])("%s alone rejects %#", async (rule, c) => {
    const r = await lint(c);
    expect(r.all.filter((w) => w.rule === "sharpladder/tokens")).toEqual([]);
    expect(r.all.map((w) => w.rule)).toContain(rule);
    const composed = await lintComposed(c.place, c.code);
    expect(composed.lines.join("\n")).toContain(`(${rule})`);
  });

  it.each(["transparent", "currentColor", "Canvas", "CanvasText"])(
    "A46 passes color: %s with no warning from any rule",
    (value) => passes(inComponent(`color: ${value};`)),
  );

  it("A47 webref counts and the collected function set", () => {
    expect([
      namedColours.size,
      systemColours.size,
      deprecatedColours.size,
    ]).toEqual([149, 19, 23]);
    expect([...colourFunctions].sort()).toEqual(
      [
        "alpha",
        "color",
        "color-hdr",
        "color-mix",
        "contrast-color",
        "device-cmyk",
        "hdr-color",
        "hsl",
        "hsla",
        "hwb",
        "ictcp",
        "jzazbz",
        "jzczhz",
        "lab",
        "lch",
        "light-dark",
        "oklab",
        "oklch",
        "rgb",
        "rgba",
        "wcag2",
      ].sort(),
    );
  });

  // Function, value and the webref production the value is checked against.
  const functionCases = [
    ["alpha", "alpha(from #fff / 0.5)", "color"],
    ["color", "color(srgb 0 0 0)", "color"],
    // Webref lists this production as hdr-color() while its syntax spells color-hdr(.
    ["color-hdr", "color-hdr(#fff, #000 2)", "hdr-color()"],
    ["color-mix", "color-mix(in srgb, #fff, #000)", "color"],
    ["contrast-color", "contrast-color(#fff tbd-bg)", "color"],
    ["device-cmyk", "device-cmyk(0 0 0 1)", "color"],
    ["hsl", "hsl(0 0% 0%)", "color"],
    ["hsla", "hsla(0, 0%, 0%, 1)", "color"],
    ["hwb", "hwb(0 0% 0%)", "color"],
    ["ictcp", "ictcp(0 0 0)", "color"],
    ["jzazbz", "jzazbz(0 0 0)", "color"],
    ["jzczhz", "jzczhz(0 0 0)", "color"],
    ["lab", "lab(0 0 0)", "color"],
    ["lch", "lch(0 0 0)", "color"],
    ["light-dark", "light-dark(#fff, #000)", "color"],
    ["oklab", "oklab(0 0 0)", "color"],
    ["oklch", "oklch(0 0 0)", "color"],
    ["rgb", "rgb(0 0 0)", "color"],
    ["rgba", "rgba(0, 0, 0, 1)", "color"],
    // The grammar admits wcag2() only inside contrast-color(), which the rule rejects whole.
    ["wcag2", "contrast-color(#fff tbd-bg wcag2(aa))", "color"],
  ];

  // Registered names whose spelling the installed grammar does not accept.
  const registeredOnly = [["hdr-color", "hdr-color(#fff, #000 2)"]];

  it("A47 covers every collected function once", () => {
    expect(
      [...functionCases, ...registeredOnly].map(([name]) => name).sort(),
    ).toEqual([...colourFunctions].sort());
  });

  it.each(functionCases)(
    "A47 %s: %s is valid under the installed webref grammar",
    (_, value, production) => {
      expect(webrefLexer.matchType(production, value).error).toBeNull();
    },
  );

  it.each(functionCases)(
    "A47 %s: %s fails in a component",
    async (name, value) => {
      const r = await lint(inComponent(`color: ${value};`));
      expect(r.invalid).toEqual([]);
      const outer = name === "wcag2" ? "contrast-color" : name;
      expect(r.contract.map((w) => w.text)).toContainEqual(
        expect.stringContaining(`colour function ${outer}()`),
      );
    },
  );

  it.each(registeredOnly)(
    "A47 %s: %s is not valid under the installed webref grammar",
    (_, value) => {
      expect(webrefLexer.matchType("hdr-color()", value).error).not.toBeNull();
    },
  );

  it.each(registeredOnly)(
    "A47 %s: %s fails in a component by its registered name",
    async (name, value) => {
      const r = await lint(inComponent(`color: ${value};`));
      expect(r.contract.map((w) => w.text)).toContainEqual(
        expect.stringContaining(`colour function ${name}()`),
      );
    },
  );
}, 30_000);

describe("header module identity", () => {
  it("A62 passes in the configured header module", () =>
    passes(
      at((p) => p.headerModule, inModule("background: var(--header-bg);")),
    ));
  it("A62 fails in an identically named module elsewhere", () => {
    const other = join(
      paths.src,
      "..",
      "fixtures",
      "other",
      "Header.module.css",
    );
    write(other, inModule("background: var(--header-bg);"));
    return fails(at(() => other, inModule("background: var(--header-bg);")));
  });
}, 30_000);
