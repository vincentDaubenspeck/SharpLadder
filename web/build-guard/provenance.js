// Tool B: colour provenance over Lightning CSS's own parse, independent of Tool A's parser.
import { readFileSync } from "node:fs";
import { transform } from "lightningcss";
import {
  colourFunctions,
  deprecatedColours,
  namedColours,
  systemColours,
} from "../stylelint/colours.js";
import { GuardError } from "./classify.js";
import { lightningTargets } from "./contract.js";

/** The one stylesheet allowed to carry colour literals, relative to the project root. */
export const tokensPath = "src/theme/tokens.css";

const colourNames = new Set(
  JSON.parse(
    readFileSync(
      new URL("../stylelint/registry/core.json", import.meta.url),
      "utf8",
    ),
  ).colour.names,
);

// Lightning CSS's typed colour variants; a typed standard value holds colour only as one of these.
const typedColours = new Set([
  "currentcolor",
  "rgb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz-d50",
  "xyz-d65",
  "hsl",
  "hwb",
  "light-dark",
  "system",
]);

const exceptionIdents = new Set([
  "transparent",
  "currentcolor",
  ...systemColours,
]);

const fail = (message) => {
  throw new GuardError(`build guard: ${message}`);
};

/** Locations and the source list are never part of an identity (T:184, F8). */
export const canonical = (node) =>
  JSON.stringify(node, (key, value) => (key === "loc" ? undefined : value));

/** The AST Lightning CSS builds before it transforms anything, as the C1 visitor sees it. */
export function parseSheet(code, { filename = "input.css", cssModules } = {}) {
  let sheet = null;
  transform({
    filename,
    code: Buffer.from(code),
    errorRecovery: false,
    targets: lightningTargets,
    ...(cssModules === undefined ? {} : { cssModules }),
    visitor: {
      StyleSheet(found) {
        sheet = found;
      },
    },
  });
  return sheet;
}

// The bundler leaves a contentless "ignored" rule where it hoists a layer statement.
const placed = (rules) => rules.filter((rule) => rule.type !== "ignored");

/** The parts of a sheet a module identity is matched on. */
export const sheetKey = (sheet) =>
  canonical({
    rules: placed(sheet.rules),
    licenseComments: sheet.licenseComments,
  });

const isTransparentBlack = (colour) =>
  colour.type === "rgb" &&
  colour.r === 0 &&
  colour.g === 0 &&
  colour.b === 0 &&
  colour.alpha === 0;

// Every colour a value carries, var() fallbacks and function arguments included.
function coloursIn(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) coloursIn(item, found);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  const { type } = value;
  if (type === "token" && value.value?.type === "ident") {
    const ident = value.value.value.toLowerCase();
    if (deprecatedColours.has(ident)) found.push({ deprecated: ident });
    else if (namedColours.has(ident) || exceptionIdents.has(ident))
      found.push({ ident });
    return found;
  }
  if (type === "function" && typeof value.value?.name === "string") {
    if (colourFunctions.has(value.value.name.toLowerCase()))
      found.push({ fn: value.value.name });
  } else if (type !== "color" && typedColours.has(type)) {
    found.push({ typed: value });
    return found;
  }
  for (const [key, child] of Object.entries(value))
    if (key !== "loc") coloursIn(child, found);
  return found;
}

const standardException = (colour) =>
  (colour.ident !== undefined && exceptionIdents.has(colour.ident)) ||
  (colour.typed !== undefined &&
    (colour.typed.type === "currentcolor" ||
      colour.typed.type === "system" ||
      isTransparentBlack(colour.typed)));

const describe = (decl) => {
  if (decl.property === "custom") return decl.value.name;
  return decl.property === "unparsed"
    ? decl.value.propertyId.property
    : decl.property;
};

/** Walks the AST once: colour occurrences in order, plus everything Tool B must refuse. */
export function collect(sheet) {
  const result = {
    entries: [],
    standard: [],
    deprecated: [],
    names: [],
    atRules: [],
    exceptions: 0,
  };
  const declaration = (decl, context, selector) => {
    // Lightning CSS keeps a standard property's system colour as a bare keyword string.
    const keyword =
      typeof decl.value === "string" ? decl.value.toLowerCase() : null;
    const found = deprecatedColours.has(keyword)
      ? [{ deprecated: keyword }]
      : coloursIn(decl.value);
    for (const colour of found)
      if (colour.deprecated) result.deprecated.push(colour.deprecated);
    if (decl.property === "custom") {
      const { name, value } = decl.value;
      result.names.push(name);
      const entry = { context, selector, name, value: canonical(value) };
      // In a custom property #0000 is a literal; only these idents alone are exceptions (F10).
      const exception =
        value.length === 1 &&
        found.length === 1 &&
        exceptionIdents.has(found[0].ident);
      const literal = found.some(
        (colour) =>
          colour.fn !== undefined ||
          (colour.typed !== undefined &&
            !["currentcolor", "system"].includes(colour.typed.type)) ||
          (colour.ident !== undefined && namedColours.has(colour.ident)),
      );
      if (colourNames.has(name)) result.entries.push(entry);
      else if (exception) result.exceptions += 1;
      else if (literal) result.entries.push(entry);
      return;
    }
    const kept = found.filter((colour) => !standardException(colour));
    if (kept.length > 0)
      result.standard.push(`${describe(decl)} in ${selector}`);
    else if (found.length > 0) result.exceptions += 1;
  };
  const walk = (rules, context) => {
    for (const rule of rules) {
      const { type, value } = rule;
      if (type === "layer-statement" || type === "ignored") continue;
      if (type === "layer-block") {
        walk(value.rules, [...context, `layer ${value.name.join(".")}`]);
      } else if (type === "media") {
        walk(value.rules, [...context, `media ${canonical(value.query)}`]);
      } else if (type === "style") {
        const selector = canonical(value.selectors);
        const { declarations = [], importantDeclarations = [] } =
          value.declarations ?? {};
        for (const decl of [...declarations, ...importantDeclarations])
          declaration(decl, context, selector);
        walk(value.rules ?? [], [...context, `rule ${selector}`]);
      } else if (type !== "font-face") {
        // F1 places @font-face; Tool A and the asset validator bind where it may stand.
        result.atRules.push(type);
      }
    }
  };
  walk(sheet.rules, []);
  return result;
}

const occurrence = ({ context, selector, name }) =>
  canonical({ context, selector, name });

/** Fails unless two ordered occurrence lists are equal entry by entry. */
export function sameEntries(expected, actual, where) {
  const want = expected.map(canonical);
  const got = actual.map(canonical);
  if (want.length !== got.length)
    fail(
      `${where} holds ${got.length} colour occurrences, expected ${want.length}`,
    );
  for (let i = 0; i < want.length; i += 1) {
    if (want[i] !== got[i])
      fail(
        `${where} colour occurrence ${i} (${actual[i].name}) differs from the manifest`,
      );
  }
}

// Lightning CSS prints one rule rebuilt from the entry's ASTs, so the text is its own serialiser's.
function readable({ selector, name, value }) {
  const rule = {
    type: "style",
    value: {
      selectors: JSON.parse(selector),
      declarations: {
        declarations: [
          { property: "custom", value: { name, value: JSON.parse(value) } },
        ],
        importantDeclarations: [],
      },
      rules: [],
      loc: { source_index: 0, line: 0, column: 0 },
    },
  };
  const text = transform({
    filename: "entry.css",
    code: Buffer.from("a{}"),
    errorRecovery: false,
    visitor: { StyleSheet: (sheet) => ({ ...sheet, rules: [rule] }) },
  }).code.toString("utf8");
  const open = text.indexOf(" {\n");
  const body = text.slice(open + 3, text.lastIndexOf(";\n}")).trim();
  return {
    selector: text.slice(0, open),
    value: body.slice(body.indexOf(": ") + 2),
  };
}

/** The occurrence manifest of T 4.3 and the expected sequences after each stage (T 4.5). */
export function tokenManifest(expected, sha256) {
  const sheet = parseSheet(expected, { filename: tokensPath });
  const source = collect(sheet);
  if (source.standard.length > 0)
    fail(
      `${tokensPath} sets a colour on a standard property: ${source.standard.join(", ")}`,
    );
  const seen = new Map();
  for (const entry of source.entries) {
    const key = occurrence(entry);
    if (seen.has(key))
      fail(
        `${tokensPath} declares ${entry.name} twice in one rule and context`,
      );
    seen.set(key, 1);
  }
  const nameCount = {};
  for (const { name } of source.entries)
    nameCount[name] = (nameCount[name] ?? 0) + 1;
  const first = transform({
    filename: tokensPath,
    code: Buffer.from(expected),
    errorRecovery: false,
    targets: lightningTargets,
    minify: false,
  }).code;
  for (const { context, name, value } of source.entries) {
    if (context.some((part) => part.startsWith("rule ")))
      fail(`${tokensPath} nests ${name} inside a rule`);
    // Other colour spaces and light-dark() lower or split under other targets (Q9, B-I4).
    const spaces = coloursIn(JSON.parse(value))
      .filter(({ typed }) => typed !== undefined && typed.type !== "rgb")
      .map(({ typed }) => typed.type);
    if (spaces.length > 0)
      fail(
        `${tokensPath} gives ${name} ${spaces.join(", ")}, which the model does not cover`,
      );
  }
  const once = collect(parseSheet(first));
  const twice = collect(parseSheet(minifySheet(first)));
  // B-I4: only 4.5 (a) and (b) may happen, and neither moves, adds or drops an occurrence.
  const want = source.entries.map(occurrence);
  const known = new Set(source.names);
  for (const [stage, found] of [
    ["stage 1", once],
    ["stage 2", twice],
  ]) {
    const got = found.entries.map(occurrence);
    if (got.length !== want.length || got.some((key, i) => key !== want[i]))
      fail(`${tokensPath} is transformed outside the model at ${stage}`);
    const added = found.names.filter((name) => !known.has(name));
    if (added.length > 0)
      fail(`${tokensPath} gains ${added.join(", ")} at ${stage}`);
  }
  const stage1 = once.entries;
  const stage2 = twice.entries;
  for (const { context, name } of stage2) {
    if (context[0] !== "layer tokens")
      fail(`${tokensPath} places ${name} outside layer tokens`);
  }
  return {
    source: { path: tokensPath, sha256 },
    names: [...new Set(source.names)],
    // The text is for reading only; every comparison uses the canonical ASTs.
    entries: source.entries.map((entry, ordinal) => ({
      ...entry,
      ordinal,
      text: readable(entry),
    })),
    nameCount,
    stage1,
    stage2,
  };
}

/** C2's pinned second stage: targets from build.cssTarget, minified, no visitor. */
export function minifySheet(code) {
  return transform({
    filename: "bundle.css",
    code: Buffer.from(code),
    errorRecovery: false,
    targets: lightningTargets,
    minify: true,
  }).code.toString("utf8");
}

/** T 4.4 for one module: tokens.css carries the manifest, every other module no colour. */
export function moduleViolations(found, { tokens, where }) {
  const problems = [];
  if (found.atRules.length > 0)
    problems.push(`${where} uses the at-rule ${found.atRules.join(", ")}`);
  if (found.deprecated.length > 0)
    problems.push(
      `${where} uses the deprecated colour ${found.deprecated.join(", ")}`,
    );
  if (found.standard.length > 0)
    problems.push(`${where} sets a colour on ${found.standard.join(", ")}`);
  if (!tokens && found.entries.length > 0)
    problems.push(
      `${where} declares a colour outside ${tokensPath}: ${found.entries.map((e) => e.name).join(", ")}`,
    );
  return problems;
}
