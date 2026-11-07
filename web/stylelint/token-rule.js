import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import stylelint from "stylelint";
import {
  colourFunctions,
  deprecatedColours,
  matchesColourGrammar,
  namedColours,
  systemColours,
} from "./colours.js";
import { classify, mediaParams } from "./context.js";
import { isOpaqueAlpha, isOutlineOffset, isThickness } from "./decimal.js";
import { fixtureRegistry, productionRegistry } from "./registry.js";

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

export const ruleName = "sharpladder/tokens";
const messages = ruleMessages(ruleName, { rejected: (why) => why });

const sides = ["top", "right", "bottom", "left"];
const logical = [
  "block",
  "block-start",
  "block-end",
  "inline",
  "inline-start",
  "inline-end",
];
const spacingParts = new Map([
  ["margin", 4],
  ["padding", 4],
  ["gap", 2],
  ["row-gap", 1],
  ["column-gap", 1],
]);
for (const box of ["margin", "padding"]) {
  for (const s of sides) spacingParts.set(`${box}-${s}`, 1);
  for (const l of logical)
    spacingParts.set(`${box}-${l}`, l.includes("-") ? 1 : 2);
}
const borderShorthands = new Set([
  "border",
  ...[...sides, ...logical].map((s) => `border-${s}`),
]);
const lineShorthands = new Set([...borderShorthands, "outline"]);
// Edge names per width or style longhand, in the order a 1 to 4 value list fills them.
const edgeLists = new Map([
  ["border", sides],
  ["outline", ["outline"]],
  ...[...sides, "block-start", "block-end", "inline-start", "inline-end"].map(
    (s) => [`border-${s}`, [s]],
  ),
  ...["block", "inline"].map((s) => [`border-${s}`, ["start", "end"]]),
]);
const widthLonghands = new Map(
  [...edgeLists].map(([base, edges]) => [`${base}-width`, edges]),
);
const styleLonghands = new Map(
  [...edgeLists].map(([base]) => [`${base}-style`, base]),
);
const thicknessKeywords = new Set(["thin", "medium", "thick"]);
const borderStyles = new Set(
  "none hidden dotted dashed solid double groove ridge inset outset".split(" "),
);
const outlineStyles = new Set(
  "auto none dotted dashed solid double groove ridge inset outset".split(" "),
);
const invisibleStyles = new Set(["none", "hidden"]);
// Explicit so a newer grammar cannot widen or narrow the ban without a reviewed change.
const bannedProperties = new Map([
  ...[
    "column-rule",
    "column-rule-break",
    "column-rule-color",
    "column-rule-inset",
    "column-rule-inset-cap",
    "column-rule-inset-cap-end",
    "column-rule-inset-cap-start",
    "column-rule-inset-end",
    "column-rule-inset-junction",
    "column-rule-inset-junction-end",
    "column-rule-inset-junction-start",
    "column-rule-inset-start",
    "column-rule-style",
    "column-rule-visibility-items",
    "column-rule-width",
  ].map((p) => [p, `${p} is not allowed; the column-rule family is banned`]),
  ["stroke-width", "stroke-width is not allowed"],
  ["composes", "composes is not allowed; compose classes in the component"],
]);
const colourProperties = new Set([
  "color",
  "background-color",
  "border-color",
  ...[...sides, ...logical].map((s) => `border-${s}-color`),
  "outline-color",
  "text-decoration-color",
  "caret-color",
  "accent-color",
  "scrollbar-color",
  "fill",
  "stroke",
]);
const colourComponents = new Set([
  "background",
  ...borderShorthands,
  "outline",
  "box-shadow",
  "text-decoration",
]);
const radiusParts = new Map([["border-radius", 4]]);
for (const corner of [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
  "start-start",
  "start-end",
  "end-start",
  "end-end",
]) {
  radiusParts.set(`border-${corner}-radius`, 2);
}
const stringProperties = new Set([
  "content",
  "font-family",
  "grid-template-areas",
  "quotes",
]);
const cssWide = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);
const literalColourFunctions = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "device-cmyk",
  "ictcp",
  "jzazbz",
  "jzczhz",
]);
// Whole queries compared token by token; any other threshold, operator or form fails.
const mediaQueries = new Set([
  "print",
  "( width <= 47.5rem )",
  "( width <= 65rem )",
  "( width > 65rem )",
  "( 65rem < width <= 74.9375rem )",
  "( prefers-color-scheme : dark )",
  "( prefers-reduced-motion : reduce )",
  "( prefers-reduced-motion : no-preference )",
]);
const layerOrder = ["tokens", "base", "components", "overrides"];
// Functions that make the browser fetch or decode a resource; src() and image() take a URL string.
const resourceFunctions = new Set(["url", "src", "image", "image-set"]);

function isResourceFunction(name) {
  const lower = name.toLowerCase();
  return resourceFunctions.has(lower) || lower.endsWith("-image-set");
}

function resourceFunction(nodes) {
  let found;
  valueParser.walk(nodes, (n) => {
    if (
      found === undefined &&
      n.type === "function" &&
      isResourceFunction(n.value)
    )
      found = n.value;
  });
  return found;
}

function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

const registries = new Map();
function registryFor(kind) {
  if (!registries.has(kind)) {
    registries.set(
      kind,
      kind === "fixture" ? fixtureRegistry() : productionRegistry(),
    );
  }
  return registries.get(kind);
}

function rawValue(decl) {
  return decl.raws.value?.raw ?? decl.value;
}

const blank = (text) => [...(text ?? "")].every((c) => " \t\n\r\f".includes(c));

/** PostCSS moves comments beside the colon or the at-rule name out of the value. */
function hiddenRaws(node) {
  if (node.type === "decl") {
    const between = node.raws.between ?? ":";
    const colon = between.indexOf(":");
    return (
      colon === -1 ||
      !blank(between.slice(0, colon)) ||
      !blank(between.slice(colon + 1))
    );
  }
  return !blank(node.raws.afterName) || !blank(node.raws.between);
}

function significant(nodes) {
  return nodes.filter((n) => n.type !== "space");
}

/** Nodes the value parser may tokenise differently from CSS Syntax 3. */
function malformed(nodes) {
  for (const n of nodes) {
    if (n.type === "comment") return "comment in a value";
    if (n.unclosed) return "malformed value (unclosed)";
    if (n.type === "word" && (n.value === ")" || n.value === "("))
      return "malformed value";
    if (n.type === "unicode-range") return "unicode-range value";
    if (n.type === "function") {
      const inner = malformed(n.nodes);
      if (inner) return inner;
    }
  }
  return undefined;
}

const hexDigits = new Set("0123456789abcdef");

function hexOpaque(word) {
  const digits = word.slice(1).toLowerCase();
  if (
    ![...digits].every((c) => hexDigits.has(c)) ||
    ![3, 4, 6, 8].includes(digits.length)
  ) {
    return undefined;
  }
  if (digits.length === 4) return digits[3] === "f";
  if (digits.length === 8) return digits.slice(6) === "ff";
  return true;
}

function literalShape(nodes) {
  const parts = significant(nodes);
  if (parts.length !== 1)
    return { problem: "colour token is not one colour value" };
  const [part] = parts;
  if (part.type === "word") {
    const lower = part.value.toLowerCase();
    if (part.value.startsWith("#")) {
      const opaque = hexOpaque(part.value);
      return opaque === undefined
        ? { problem: "invalid hex colour" }
        : { opaque };
    }
    if (deprecatedColours.has(lower))
      return { problem: `deprecated colour ${part.value}` };
    if (
      lower === "currentcolor" ||
      systemColours.has(lower) ||
      namedColours.has(lower)
    ) {
      return { opaque: true };
    }
    return { problem: "colour token is not a colour literal" };
  }
  if (
    part.type !== "function" ||
    !literalColourFunctions.has(part.value.toLowerCase())
  ) {
    return { problem: "colour token is not a literal colour" };
  }
  const args = significant(part.nodes);
  for (const a of args) {
    if (a.type === "function")
      return { problem: "colour function arguments must be literals" };
    if (a.type === "string") return { problem: "string in a colour token" };
    if (
      a.type === "word" &&
      (a.value.toLowerCase() === "from" || a.value.includes("#"))
    ) {
      return { problem: "relative or nested colour in a token" };
    }
  }
  const slash = args.findIndex((a) => a.type === "div" && a.value === "/");
  const commas = args.filter((a) => a.type === "div" && a.value === ",").length;
  let alpha;
  if (slash !== -1) alpha = args[slash + 1];
  else if (commas === 3) alpha = args.at(-1);
  return { opaque: alpha === undefined || isOpaqueAlpha(alpha.value) };
}

/** Structural checks run first so their specific message wins over the grammar mismatch. */
function colourShape(nodes, text) {
  const shape = literalShape(nodes);
  if (shape.problem === undefined && !matchesColourGrammar(text))
    return { problem: "colour value does not match the <color> grammar" };
  return shape;
}

function isPx(word) {
  const u = valueParser.unit(word);
  return u !== false && u.unit.toLowerCase() === "px";
}

/** A parse that is not a single query of known tokens gives undefined and fails. */
function mediaQuery(nodes) {
  const parts = significant(nodes);
  if (parts.length !== 1) return undefined;
  const [part] = parts;
  if (part.type === "word") return part.value.toLowerCase();
  if (part.type !== "function" || part.value !== "") return undefined;
  const inner = [];
  for (const n of significant(part.nodes)) {
    if (n.type === "word") inner.push(n.value.toLowerCase());
    else if (n.type === "div" && n.value === ":") inner.push(":");
    else return undefined;
  }
  return ["(", ...inner, ")"].join(" ");
}

function expandEdges(values, edges) {
  const [a, b = a, c = a, d = b] = values;
  return [a, b, c, d].slice(0, edges.length);
}

const stringOption = [(v) => typeof v === "string"];

function rule(primary, options = {}) {
  return (root, result) => {
    const valid = validateOptions(
      result,
      ruleName,
      { actual: primary, possible: [true] },
      {
        actual: options,
        possible: {
          registry: ["production", "fixture"],
          tokensFile: stringOption,
          entryFile: stringOption,
          headerModule: stringOption,
        },
      },
    );
    if (!valid) return;
    const fail = (node, why) => {
      report({ ruleName, result, node, message: messages.rejected(why) });
    };

    const registry = registryFor(options.registry ?? "production");
    if (registry.missing.length > 0) {
      fail(root, `token registry incomplete: ${registry.missing.join(", ")}`);
      return;
    }
    const file = root.source?.input.file;
    const here = file === undefined ? undefined : canonical(file);
    const tokensPath = canonical(options.tokensFile ?? "");
    const same = (path) => here !== undefined && here === canonical(path ?? "");
    const isTokens = here !== undefined && here === tokensPath;
    const isEntry = same(options.entryFile);
    const isHeader = same(options.headerModule);
    const isModule =
      file !== undefined &&
      basename(file).toLowerCase().endsWith(".module.css");

    let tokensRoot = root;
    if (!isTokens) {
      try {
        tokensRoot = postcss.parse(readFileSync(tokensPath ?? "", "utf8"), {
          from: tokensPath,
        });
      } catch {
        fail(root, "tokens.css is missing or unreadable");
        return;
      }
    }
    const declared = new Set();
    tokensRoot.walkDecls((d) => {
      if (d.prop.startsWith("--")) declared.add(d.prop);
    });

    function checkVar(fn, pos, decl, fallbackCheck) {
      const inner = fn.nodes;
      const nameNode = inner.find((n) => n.type !== "space");
      if (nameNode?.type !== "word" || !nameNode.value.startsWith("--")) {
        fail(decl, "var() must name one custom property");
        return;
      }
      const rest = inner.slice(inner.indexOf(nameNode) + 1);
      const comma = rest.find((n) => n.type !== "space");
      if (
        comma !== undefined &&
        (comma.type !== "div" || comma.value !== ",")
      ) {
        fail(decl, "malformed var()");
        return;
      }
      const name = nameNode.value;
      const token = registry.tokens.get(name);
      if (!token) return fail(decl, `${name} is not in the token registry`);
      if (!declared.has(name))
        return fail(decl, `${name} is not declared in tokens.css`);
      if (!pos.allows(token)) {
        return fail(
          decl,
          `${name} (${token.category}) is not allowed in ${pos.prop}`,
        );
      }
      if (token.headerOnly && !isHeader) {
        return fail(decl, `${name} is allowed only in the header module`);
      }
      const fallback =
        comma === undefined ? [] : rest.slice(rest.indexOf(comma) + 1);
      if (significant(fallback).length > 0) fallbackCheck(fallback);
      return undefined;
    }

    function positionFor(prop, extra = {}) {
      return {
        prop,
        ...extra,
        allows(token) {
          if (token.boxShadowOnly) return prop === "box-shadow";
          if (token.category === "colour") {
            return (
              colourProperties.has(prop) ||
              colourComponents.has(prop) ||
              this.stop === true
            );
          }
          if (token.category === "font-stack") return prop === "font-family";
          if (token.category === "layout")
            return token.properties.includes(prop);
          return false;
        },
      };
    }

    function checkWord(word, pos, decl) {
      const lower = word.toLowerCase();
      if (word.includes("#")) return fail(decl, `hex colour ${word}`);
      if (deprecatedColours.has(lower))
        return fail(decl, `deprecated colour ${word}`);
      if (namedColours.has(lower) && lower !== "transparent") {
        return fail(decl, `named colour ${word}`);
      }
      if (cssWide.has(lower))
        return fail(decl, `CSS-wide keyword ${word} in ${pos.prop}`);
      if (!isPx(word)) return undefined;
      return fail(decl, `px value ${word} in ${pos.prop}`);
    }

    // The source spelling alone decides, so no unit, keyword or function is converted or guessed.
    function thicknessPart(part, prop, decl) {
      if (part.type !== "word") {
        return fail(
          decl,
          `${valueParser.stringify(part)} in ${prop}; thickness takes px only`,
        );
      }
      if (thicknessKeywords.has(part.value.toLowerCase()))
        return fail(decl, `keyword ${part.value} in ${prop}; use px`);
      if (!isThickness(part.value)) {
        return fail(
          decl,
          `${part.value} in ${prop}; thickness takes bare 0 or above 0px up to 4px`,
        );
      }
      return undefined;
    }

    function componentKind(part, styles) {
      if (part.type === "function") {
        const name = part.value.toLowerCase();
        return name === "var" || colourFunctions.has(name) ? "colour" : "width";
      }
      if (part.type !== "word") return undefined;
      const lower = part.value.toLowerCase();
      if (styles.has(lower)) return "style";
      if (thicknessKeywords.has(lower) || valueParser.unit(part.value))
        return "width";
      if (
        part.value.startsWith("#") ||
        lower === "transparent" ||
        lower === "currentcolor" ||
        namedColours.has(lower) ||
        systemColours.has(lower) ||
        deprecatedColours.has(lower)
      ) {
        return "colour";
      }
      return undefined;
    }

    function lineShorthand(decl, prop, nodes) {
      const styles = prop === "outline" ? outlineStyles : borderStyles;
      const seen = new Map();
      for (const part of significant(nodes)) {
        const kind = componentKind(part, styles);
        if (kind === undefined)
          return fail(decl, `unknown component in ${prop}`);
        if (seen.has(kind))
          return fail(decl, `more than one ${kind} in ${prop}`);
        seen.set(kind, part);
      }
      if (!seen.has("width")) return fail(decl, `${prop} must state a width`);
      thicknessPart(seen.get("width"), prop, decl);
      if (seen.has("colour"))
        scan([seen.get("colour")], positionFor(prop), decl);
      return undefined;
    }

    function listOf(decl, prop, nodes, max) {
      const parts = significant(nodes);
      if (parts.length === 0 || parts.length > max) {
        fail(decl, `${prop} takes 1 to ${String(max)} values`);
        return undefined;
      }
      return parts;
    }

    function widthLonghand(decl, prop, nodes) {
      const parts = listOf(decl, prop, nodes, widthLonghands.get(prop).length);
      for (const part of parts ?? []) thicknessPart(part, prop, decl);
    }

    function coveredEdges(rule, widthProp, edges) {
      const width = rule?.nodes
        ?.filter((n) => n.type === "decl" && n.prop.toLowerCase() === widthProp)
        .at(-1);
      if (!width) return [];
      const parts = significant(valueParser(rawValue(width)).nodes);
      if (parts.length === 0 || parts.length > edges.length) return [];
      // Any allowed width, zero included, states the edge explicitly and so covers it.
      const allowed = parts.map(
        (p) => p.type === "word" && isThickness(p.value),
      );
      return expandEdges(allowed, edges);
    }

    /** Coverage is the exact width longhand in the same rule, never an equivalent or the cascade. */
    function styleLonghand(decl, prop, nodes) {
      const base = styleLonghands.get(prop);
      const edges = edgeLists.get(base);
      const styles = base === "outline" ? outlineStyles : borderStyles;
      const parts = listOf(decl, prop, nodes, edges.length);
      if (!parts) return undefined;
      for (const part of parts) {
        if (part.type !== "word" || !styles.has(part.value.toLowerCase()))
          return fail(decl, `unknown component in ${prop}`);
      }
      const visible = expandEdges(
        parts.map((p) => !invisibleStyles.has(p.value.toLowerCase())),
        edges,
      );
      const widthProp = `${base}-width`;
      const covered = coveredEdges(decl.parent, widthProp, edges);
      const uncovered = edges.filter((_, i) => visible[i] && !covered[i]);
      if (uncovered.length > 0) {
        return fail(
          decl,
          `${prop} needs ${widthProp} in the same rule for ${uncovered.join(", ")}`,
        );
      }
      return undefined;
    }

    function outlineOffset(decl, nodes) {
      const parts = significant(nodes);
      if (
        parts.length !== 1 ||
        parts[0].type !== "word" ||
        !isOutlineOffset(parts[0].value)
      ) {
        return fail(decl, "outline-offset takes bare 0 or -4px to 4px");
      }
      return undefined;
    }

    function scan(nodes, pos, decl) {
      for (const n of nodes) {
        if (n.type === "string") {
          if (!stringProperties.has(pos.prop) && !pos.strings)
            fail(decl, `string in ${pos.prop}`);
        } else if (n.type === "word") {
          checkWord(n.value, pos, decl);
        } else if (n.type === "function") {
          scanFunction(n, pos, decl);
        }
      }
    }

    function scanFunction(n, pos, decl) {
      const name = n.value.toLowerCase();
      if (name === "var") {
        checkVar(n, pos, decl, (fallback) => {
          scan(fallback, pos, decl);
        });
      } else if (colourFunctions.has(name)) {
        fail(decl, `colour function ${n.value}()`);
      } else if (name.startsWith("-") || name === "attr" || name === "env") {
        fail(decl, `function ${n.value}() is not allowed`);
      } else if (name.endsWith("gradient")) {
        scan(n.nodes, positionFor(pos.prop, { stop: true }), decl);
      } else {
        scan(n.nodes, positionFor(pos.prop, { strings: pos.strings }), decl);
      }
    }

    function tokenPosition(prop) {
      let category = prop;
      if (spacingParts.has(prop)) category = "spacing";
      if (radiusParts.has(prop)) category = "radius";
      return {
        prop,
        allows(token) {
          if (token.category !== category) return false;
          return (
            category !== "spacing" ||
            prop.startsWith("margin") ||
            !token.value.startsWith("-")
          );
        },
      };
    }

    function tokenOnly(nodes, decl, prop, maxParts, accept) {
      const parts = significant(nodes);
      if (parts.length === 0 || parts.length > maxParts) {
        fail(decl, `${prop} takes 1 to ${String(maxParts)} parts`);
        return;
      }
      for (const part of parts) {
        if (part.type === "word" && accept(part.value.toLowerCase())) continue;
        if (part.type === "function" && part.value.toLowerCase() === "var") {
          checkVar(part, tokenPosition(prop), decl, (fallback) => {
            tokenOnly(fallback, decl, prop, 1, accept);
          });
          continue;
        }
        fail(decl, `${prop} takes registry tokens only`);
      }
    }

    function standardDeclaration(decl, prop, nodes) {
      const parts = significant(nodes);
      const single =
        parts.length === 1 && parts[0].type === "word" ? parts[0].value : "";
      if (prop === "forced-color-adjust")
        return fail(decl, "forced-color-adjust is not allowed");
      if (lineShorthands.has(prop)) return lineShorthand(decl, prop, nodes);
      if (widthLonghands.has(prop)) return widthLonghand(decl, prop, nodes);
      if (styleLonghands.has(prop)) return styleLonghand(decl, prop, nodes);
      if (prop === "outline-offset") return outlineOffset(decl, nodes);
      if (prop === "font") {
        if (single.toLowerCase() === "inherit") return undefined;
        return fail(decl, "only font: inherit is allowed");
      }
      if (spacingParts.has(prop)) {
        const zeroOrAuto = (w) =>
          w === "0" || (w === "auto" && prop.startsWith("margin"));
        return tokenOnly(nodes, decl, prop, spacingParts.get(prop), zeroOrAuto);
      }
      if (prop === "font-size" || prop === "line-height") {
        return tokenOnly(nodes, decl, prop, 1, () => false);
      }
      if (radiusParts.has(prop)) {
        const slash = parts.findIndex(
          (p) => p.type === "div" && p.value === "/",
        );
        const split = slash !== -1 && prop === "border-radius";
        const groups = split
          ? [parts.slice(0, slash), parts.slice(slash + 1)]
          : [nodes];
        for (const group of groups) {
          tokenOnly(group, decl, prop, radiusParts.get(prop), (w) => w === "0");
        }
        return undefined;
      }
      scan(nodes, positionFor(prop), decl);
      return undefined;
    }

    function tokenDeclaration(decl, nodes) {
      const name = decl.prop;
      const token = registry.tokens.get(name);
      if (!token) return fail(decl, `${name} is not in the token registry`);
      let alias = false;
      valueParser.walk(nodes, (n) => {
        if (n.type === "function" && n.value.toLowerCase() === "var")
          alias = true;
      });
      if (alias) return fail(decl, `${name} must not use var()`);
      const value = rawValue(decl).trim();
      if (token.category === "colour") {
        const shape = colourShape(nodes, value);
        if (shape.problem) return fail(decl, `${name}: ${shape.problem}`);
        if (token.light !== undefined) {
          const context = classify(decl);
          if (!context)
            return fail(decl, `${name} is in an unrecognised context`);
          const expected = context.dark ? token.dark : token.light;
          if (value !== expected) {
            return fail(
              decl,
              `${name} must be exactly ${expected} in the ${context.name} context`,
            );
          }
        }
        if (!shape.opaque && !token.translucent)
          return fail(decl, `${name} must be opaque`);
        return undefined;
      }
      if (token.value !== undefined && value !== token.value) {
        return fail(decl, `${name} must be exactly ${token.value}`);
      }
      scan(
        nodes,
        positionFor(name, { strings: token.category === "font-stack" }),
        decl,
      );
      return undefined;
    }

    const want = isTokens
      ? ["tokens"]
      : isModule
        ? ["components"]
        : ["base", "overrides"];
    const top = root.nodes.filter((n) => n.type !== "comment");

    // The one order statement fixes layer precedence; any other could reorder it from elsewhere.
    function layerRule(at) {
      const name = at.params.trim();
      if (at.nodes === undefined) {
        if (isEntry && at === top[0]) return undefined;
        return fail(
          at,
          "a @layer statement is allowed only as the first rule of the entry stylesheet",
        );
      }
      for (let p = at.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type === "atrule" && p.name.toLowerCase() === "layer")
          return fail(at, `@layer ${name} is nested in another @layer`);
      }
      if (!want.includes(name))
        return fail(at, `@layer ${name}; expected ${want.join(" or ")}`);
      return undefined;
    }

    root.walkAtRules((at) => {
      const params = mediaParams(at);
      if (at.name.includes("\\") || params.includes("\\"))
        return fail(at, "escape in an at-rule");
      const name = at.name.toLowerCase();
      if (name === "import") return fail(at, "@import is not allowed");
      if (hiddenRaws(at)) return fail(at, "comment in at-rule parameters");
      const nodes = valueParser(params).nodes;
      const resource = resourceFunction(nodes);
      if (resource !== undefined)
        return fail(at, `${resource}() is not allowed in a stylesheet`);
      if (name === "layer") return layerRule(at);
      if (name !== "media") return undefined;
      const problem = malformed(nodes);
      if (problem) return fail(at, `${problem} in @media parameters`);
      if (!mediaQueries.has(mediaQuery(nodes) ?? ""))
        return fail(at, `@media ${params.trim()} is not an allowed query`);
      return undefined;
    });

    root.walkDecls((decl) => {
      const raw = rawValue(decl);
      if (decl.prop.includes("\\") || raw.includes("\\")) {
        return fail(decl, "escape in a declaration");
      }
      const banned = bannedProperties.get(decl.prop.toLowerCase());
      if (banned) return fail(decl, banned);
      if (hiddenRaws(decl)) return fail(decl, "comment in a declaration");
      const nodes = valueParser(raw).nodes;
      const problem = malformed(nodes);
      if (problem) return fail(decl, problem);
      const resource = resourceFunction(nodes);
      if (resource !== undefined)
        return fail(decl, `${resource}() is not allowed in a stylesheet`);
      if (decl.prop.startsWith("--")) {
        if (!isTokens)
          return fail(decl, "custom property declared outside tokens.css");
        return tokenDeclaration(decl, nodes);
      }
      return standardDeclaration(decl, decl.prop.toLowerCase(), nodes);
    });

    root.walk((node) => {
      if (node.type !== "rule" && node.type !== "decl") return;
      let layer;
      for (let p = node.parent; p && p.type !== "root"; p = p.parent) {
        if (p.type === "atrule" && p.name.toLowerCase() === "layer" && p.nodes)
          layer ??= p;
      }
      if (!layer) {
        if (node.type === "rule" || node.parent.type !== "rule")
          fail(node, "unlayered rule");
        return;
      }
      if (node.type === "rule" && !want.includes(layer.params.trim())) {
        fail(
          node,
          `rule in @layer ${layer.params.trim()}; expected ${want.join(" or ")}`,
        );
      }
    });

    if (isModule) {
      const [only] = top;
      const wrapped =
        top.length === 1 &&
        only.type === "atrule" &&
        only.name.toLowerCase() === "layer" &&
        only.params.trim() === "components" &&
        only.nodes !== undefined;
      if (!wrapped)
        fail(root, "a module must be exactly one @layer components block");
    }
    if (isEntry) {
      const [first] = top;
      const statement = first?.type === "atrule" && first.nodes === undefined;
      const names = statement
        ? first.params.split(",").map((n) => n.trim())
        : [];
      if (
        first?.name?.toLowerCase() !== "layer" ||
        names.join() !== layerOrder.join()
      ) {
        fail(
          root,
          `the entry stylesheet must start with @layer ${layerOrder.join(", ")};`,
        );
      }
    }

    const tokenName = (d) => {
      const parts = significant(valueParser(rawValue(d)).nodes);
      const fn =
        parts.length === 1 && parts[0].type === "function"
          ? parts[0]
          : undefined;
      return fn?.value.toLowerCase() === "var"
        ? significant(fn.nodes)[0]?.value
        : undefined;
    };
    root.walkRules((container) => {
      const own = (prop) =>
        container.nodes.find(
          (n) => n.type === "decl" && n.prop.toLowerCase() === prop,
        );
      const size = own("font-size");
      const height = own("line-height");
      if (!size && !height) return;
      if (!size || !height) {
        fail(
          container,
          "font-size and line-height must be set together as a registry pair",
        );
        return;
      }
      const sizeName = tokenName(size);
      if (
        sizeName === undefined ||
        registry.pairs.get(sizeName) !== tokenName(height)
      ) {
        fail(container, "font-size and line-height are not a registry pair");
      }
    });

    if (isTokens) {
      for (const [name] of registry.tokens) {
        if (!declared.has(name))
          fail(root, `${name} is missing from tokens.css`);
      }
    }
  };
}

rule.ruleName = ruleName;
rule.messages = messages;

export default createPlugin(ruleName, rule);
