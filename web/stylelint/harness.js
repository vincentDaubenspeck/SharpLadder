import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    if (omit.includes(name)) continue;
    let value = token.value ?? token.light ?? "#286773";
    if (token.category === "font-stack")
      value = '"Inter", system-ui, sans-serif';
    if (name === "--split") value = "22.5rem";
    lightLines.push(`    ${name}: ${light[name] ?? value};`);
    if (token.dark !== undefined) darkLines.push(`    ${name}: ${token.dark};`);
  }
  const printLines = lightLines.filter((l) => {
    const name = l.trim().split(":")[0];
    return registry.tokens.get(name)?.light !== undefined;
  });
  return [
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

export function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "sl-tokens-"));
  const paths = {
    src: join(root, "src"),
    tokensFile: join(root, "src", "theme", "tokens.css"),
    entryFile: join(root, "src", "index.css"),
    headerModule: join(root, "fixtures", "header", "Header.module.css"),
  };
  write(paths.tokensFile, fixtureTokens());
  write(paths.entryFile, "@layer tokens, base, components, overrides;\n");
  return { root, paths };
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

/** Accepted only with no warning from any rule, in a fresh root so earlier cases cannot leak in. */
export async function lintComposed(place, code) {
  const { root, paths } = makeRoot();
  write(place(paths), code);
  return lintProduction(
    { ...paths, src: root },
    fixtureRegistry,
    fixtureComposed,
  );
}

export async function lintAs(paths, file, code) {
  const { results } = await stylelint.lint({
    code,
    codeFilename: file,
    config: fixtureConfig(paths),
    configBasedir: web,
  });
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
