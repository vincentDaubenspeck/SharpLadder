import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";

// Namespace true is the empty prefix of [|name]; undefined means no prefix at all.
function namespaced(node, name) {
  if (node.namespace === undefined) return name;
  return `${node.namespace === true ? "" : node.namespace}|${name}`;
}

function canonicalNode(node) {
  switch (node.type) {
    case "combinator":
      return node.value.trim() === "" ? " " : node.value.trim();
    case "attribute": {
      const name = namespaced(node, node.attribute);
      if (node.operator === undefined) return `[${name}]`;
      const flag = (
        node.raws.insensitiveFlag ?? (node.insensitive ? "i" : "")
      ).toLowerCase();
      return `[${name}${node.operator}${JSON.stringify(node.value)}${flag && ` ${flag}`}]`;
    }
    case "pseudo":
      return node.nodes.length === 0
        ? node.value
        : `${node.value}(${node.nodes.map(canonicalSelector).sort().join(",")})`;
    case "class":
      return `.${node.value}`;
    case "id":
      return `#${node.value}`;
    case "tag":
      return namespaced(node, node.value);
    default:
      return `{${node.type}}`;
  }
}

function canonicalSelector(selector) {
  return selector.nodes.map(canonicalNode).join("");
}

// Sorted so list order is insignificant; identifiers and attribute values keep their case.
function selectorList(selector) {
  // The parser decodes escapes itself; an escaped selector is never a recognised context.
  if (selector.includes("\\")) throw new Error("escape in a selector");
  const out = [];
  selectorParser((root) => {
    root.each((s) => out.push(canonicalSelector(s)));
  }).processSync(selector);
  return out.sort();
}

function canonicalMedia(nodes) {
  return nodes
    .map((n) => {
      if (n.type === "function")
        return `${n.value.toLowerCase()}(${canonicalMedia(n.nodes)})`;
      if (n.type === "div") return n.value;
      if (n.type === "space") return " ";
      if (n.type === "word") return n.value.toLowerCase();
      return `{${n.type}}`;
    })
    .join("");
}

export function mediaParams(atRule) {
  return atRule.raws.params?.raw ?? atRule.params;
}

const contexts = [
  { name: "light", media: null, selectors: [[":root"]] },
  {
    name: "system dark",
    dark: true,
    media: "(prefers-color-scheme:dark)",
    selectors: [[":root:not([data-theme])"], [":root:not([data-theme]) .work"]],
  },
  {
    name: "explicit dark",
    dark: true,
    media: null,
    selectors: [['[data-theme="dark"]'], ['[data-theme="dark"] .work']],
  },
  {
    name: "print",
    media: "print",
    selectors: [
      [":root:not([data-theme])", ":root[data-theme]"],
      [":root:not([data-theme]) .work", ":root[data-theme] .work"],
    ],
  },
];

/** An unlisted context gives undefined, so an exact-valued token there fails closed. */
export function classify(decl) {
  const rule = decl.parent;
  if (rule?.type !== "rule") return undefined;
  const chain = [];
  for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
    if (p.type !== "atrule") return undefined;
    chain.push(p);
  }
  const layers = chain.filter((a) => a.name.toLowerCase() === "layer");
  const media = chain.filter((a) => a.name.toLowerCase() === "media");
  if (layers.length !== 1 || layers[0].params.trim() !== "tokens")
    return undefined;
  if (layers.length + media.length !== chain.length || media.length > 1)
    return undefined;
  const mediaKey =
    media.length === 0
      ? null
      : canonicalMedia(valueParser(mediaParams(media[0])).nodes);
  let selectors;
  try {
    selectors = selectorList(rule.selector).join(", ");
  } catch {
    return undefined;
  }
  return contexts.find(
    (c) =>
      c.media === mediaKey &&
      c.selectors.some((s) => s.join(", ") === selectors),
  );
}
