import { definitionSyntax, fork } from "css-tree";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Reads css.json only; no other file of the package is trusted. */
function loadWebref() {
  const data = JSON.parse(
    readFileSync(require.resolve("@webref/css/css.json"), "utf8"),
  );
  return {
    data,
    types: new Map(data.types.map((t) => [t.name, t])),
    functions: new Map(data.functions.map((f) => [f.name, f])),
  };
}

function keywordsOf(types, name) {
  const type = types.get(name);
  if (!type?.syntax) throw new Error(`webref type <${name}> has no syntax`);
  const words = [];
  definitionSyntax.walk(definitionSyntax.parse(type.syntax), (node) => {
    if (node.type === "Keyword") words.push(node.name.toLowerCase());
  });
  return words;
}

// Both the registered name and the syntax's function token count, since the two can differ
// (hdr-color() is spelled color-hdr( in its syntax).
function colourFunctionsOf(types, functions) {
  const seen = new Set();
  const found = new Set();
  const queue = ["color"];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = name.endsWith("()") ? functions.get(name) : types.get(name);
    if (!entry?.syntax) continue;
    if (name.endsWith("()")) found.add(name.slice(0, -2).toLowerCase());
    definitionSyntax.walk(definitionSyntax.parse(entry.syntax), (node) => {
      if (node.type === "Function") found.add(node.name.toLowerCase());
      if (node.type === "Type") queue.push(node.name);
    });
  }
  return found;
}

const { data, types, functions } = loadWebref();

// css-tree's bundled grammar is a different snapshot; only the pinned webref syntax decides.
const lexer = fork({
  types: Object.fromEntries(
    [...data.types, ...data.functions]
      .filter((entry) => entry.syntax)
      .map((entry) => [entry.name, entry.syntax]),
  ),
}).lexer;

/** A parse error counts as a mismatch, so a value css-tree cannot read fails closed. */
export function matchesColourGrammar(text) {
  try {
    return lexer.matchType("color", text).error === null;
  } catch {
    return false;
  }
}

export const namedColours = new Set(keywordsOf(types, "named-color"));
export const systemColours = new Set(keywordsOf(types, "system-color"));
export const deprecatedColours = new Set(keywordsOf(types, "deprecated-color"));
export const colourFunctions = colourFunctionsOf(types, functions);
