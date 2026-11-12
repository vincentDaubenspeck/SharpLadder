import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";
import { composedConfig } from "./config.js";
import { lintProduction } from "./lint-production.js";
import { ruleOptions } from "./paths.js";
import { fixtureRegistry } from "./registry.js";

const web = fileURLToPath(new URL("..", import.meta.url));

// Style-only rules are left out so a failing fixture asserts the token contract alone.
const contractRules = new Set([
  "sharpladder/tokens",
  "color-no-hex",
  "color-named",
  "declaration-no-important",
  "at-rule-allowed-list",
  "declaration-block-no-duplicate-custom-properties",
  "no-duplicate-selectors",
  "CssSyntaxError",
]);

export function fixtureTokens({ light = {}, omit = [], extra = "" } = {}) {
  const registry = fixtureRegistry();
  const lightLines = [];
  const darkLines = [];
  for (const [name, token] of registry.tokens) {
    if (omit.includes(name) || token.runtime) continue;
    let value = token.value ?? token.light ?? "#286773";
    if (token.category === "font-stack")
      value = '"Inter", system-ui, sans-serif';
    lightLines.push(`    ${name}: ${light[name] ?? value};`);
    if (token.dark !== undefined) darkLines.push(`    ${name}: ${token.dark};`);
  }
  const printLines = lightLines.filter((l) => {
    const name = l.trim().split(":")[0];
    return registry.tokens.get(name)?.light !== undefined;
  });
  return [
    "@layer tokens, base, components, overrides;",
    "",
    "@layer tokens {",
    "  :root {",
    ...lightLines,
    "  }",
    "",
    '  [data-theme="dark"] {',
    ...darkLines,
    "  }",
    "",
    "  @media (prefers-color-scheme: dark) {",
    "    :root:not([data-theme]) {",
    ...darkLines.map((l) => `  ${l}`),
    "    }",
    "  }",
    "",
    "  @media print {",
    "    :root[data-theme],",
    "    :root:not([data-theme]) {",
    ...printLines.map((l) => `  ${l}`),
    "    }",
    "  }",
    ...(extra === "" ? [] : ["", extra]),
    "}",
    "",
  ].join("\n");
}

export const shippedFonts = [
  "noto-sans.woff2",
  "noto-sans-display.woff2",
  "cascadia-code-regular.woff2",
];

/** The production faces, one per shipped file, as fonts.css declares them. */
const fontFaces = {
  "noto-sans.woff2": ["Noto Sans", "100 900", "62.5% 100%"],
  "noto-sans-display.woff2": ["Noto Sans Display", "100 900", "62.5% 100%"],
  "cascadia-code-regular.woff2": ["SL Code", "400", "100%"],
};

/** One face; an override replaces a descriptor value, and null leaves the descriptor out. */
export function fontFace(file, overrides = {}) {
  const [family, weight, stretch] = fontFaces[file];
  const descriptors = {
    "font-family": `"${family}"`,
    src: `url("./fonts/${file}") format("woff2")`,
    "font-weight": weight,
    "font-style": "normal",
    "font-stretch": stretch,
    "font-display": "swap",
    ...overrides,
  };
  const lines = Object.entries(descriptors)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `    ${name}: ${value};`);
  return ["  @font-face {", ...lines, "  }"].join("\n");
}

export function fontsSheet(faces = shippedFonts.map((f) => fontFace(f))) {
  return ["@layer base {", faces.join("\n\n"), "}", ""].join("\n");
}

// Removal touches only the roots this module made, and only once no lint still reads them.
const roots = new Set();
const lints = new Set();

function track(lint) {
  lints.add(lint);
  return lint.finally(() => lints.delete(lint));
}

function remove(repo) {
  // A scanner can hold a new file open for a moment on Windows, so removal retries.
  rmSync(repo, { recursive: true, force: true, maxRetries: 10 });
  roots.delete(repo);
}

/** For afterAll, so the roots go even when setup or an assertion throws. */
export async function removeRoots() {
  await Promise.allSettled(lints);
  for (const repo of roots) remove(repo);
}

/** The repository copy sits one level up, so inventory source paths resolve as in production. */
export function makeRoot({ inventory } = {}) {
  // Stylelint globs its file list by long names, so a short-name temp root would match nothing.
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), "sl-tokens-")));
  roots.add(repo);
  const root = join(repo, "web");
  const paths = {
    src: join(root, "src"),
    tokensFile: join(root, "src", "theme", "tokens.css"),
    entryFile: join(root, "src", "theme", "tokens.css"),
    headerModule: join(root, "fixtures", "header", "Header.module.css"),
    fontsFile: join(root, "src", "theme", "fonts.css"),
    inventoryFile: join(root, "assets", "licences", "asset-inventory.json"),
    repoRoot: repo,
  };
  write(paths.tokensFile, fixtureTokens());
  const fonts = join(paths.src, "theme", "fonts");
  mkdirSync(fonts, { recursive: true });
  for (const file of shippedFonts)
    copyFileSync(join(web, "src", "theme", "fonts", file), join(fonts, file));
  write(
    paths.inventoryFile,
    JSON.stringify(inventory ?? productionInventory(), null, 2),
  );
  write(paths.fontsFile, fontsSheet());
  return { root, paths };
}

export function productionInventory() {
  return JSON.parse(
    readFileSync(
      join(web, "assets", "licences", "asset-inventory.json"),
      "utf8",
    ),
  );
}

export function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function fixtureConfig(paths) {
  return composedConfig({ ...ruleOptions(paths), registry: "fixture" });
}

const fixtureComposed = (options) =>
  composedConfig({ ...options, registry: "fixture" });

/** The production lint over a fixture root, tracked so removal waits for it. */
export function lintRoot(
  paths,
  registry = fixtureRegistry,
  config = fixtureComposed,
) {
  return track(lintProduction(paths, registry, config));
}

/** Accepted only with no warning from any rule, in a fresh root so earlier cases cannot leak in. */
export async function lintComposed(place, code) {
  const { root, paths } = makeRoot();
  try {
    write(place(paths), code);
    // Awaited here, so the root outlives the lint that reads it.
    return await lintRoot({ ...paths, src: root });
  } finally {
    remove(paths.repoRoot);
  }
}

export async function lintAs(paths, file, code) {
  const { results } = await track(
    stylelint.lint({
      code,
      codeFilename: file,
      config: fixtureConfig(paths),
      configBasedir: web,
    }),
  );
  const [r] = results;
  return {
    all: r.warnings,
    contract: r.warnings.filter((w) => contractRules.has(w.rule)),
    invalid: r.invalidOptionWarnings,
  };
}

export function inModule(declarations) {
  return `@layer components {\n  .x {\n    ${declarations}\n  }\n}\n`;
}
