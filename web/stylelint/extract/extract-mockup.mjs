// Registries come from the approved mockup rather than by hand, so a rerun can reproduce them.
// Run as: node web/stylelint/extract/extract-mockup.mjs <mockup.html> <chrome.exe>.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";
import prettier from "prettier";
import { normalise, roleFailures } from "./acceptance.js";

const GENERATOR = "web/stylelint/extract/extract-mockup.mjs";
const REGISTRY = new URL("../registry/", import.meta.url);
const VIEWPORTS = [1920, 1041, 1040, 761, 760, 390];
const THEMES = ["light", "dark"];
const VIEWS = ["home", "chapter", "practice"];
const PSEUDO = ["hover", "focus", "focus-visible", "active"];

let sheetHeaders = new Map();
let catalogue;
const measuredRoles = new Set();

// Each state is a reload followed by the mockup's own controls, so the script's logic decides the DOM.
const STATES = [
  { name: "returning", learner: "returning", actions: [] },
  { name: "new", learner: "new", actions: [] },
  { name: "listening", learner: "returning", actions: ["#listenBtn"] },
  { name: "term-open", learner: "returning", actions: ["button.term"] },
  {
    name: "checks-open",
    learner: "returning",
    actions: ['.cbtn[aria-expanded="false"]'],
  },
  { name: "walk-safe-step-1", learner: "returning", actions: ["#wNext"] },
  {
    name: "walk-wrong-step-4",
    learner: "returning",
    actions: ['.wm[data-mode="wrong"]', "#wNext", "#wNext", "#wNext", "#wNext"],
  },
  { name: "output-collapsed", learner: "returning", actions: ["#outTog"] },
];

const SIDES = ["", "-top", "-right", "-bottom", "-left"];
const LOGICAL = ["-block", "-block-start", "-block-end", "-inline"];
const LOGICAL_INLINE = ["-inline-start", "-inline-end"];
const SPACING_PROPS = new Set([
  ...["margin", "padding"].flatMap((base) =>
    [...SIDES, ...LOGICAL, ...LOGICAL_INLINE].map((suffix) => base + suffix),
  ),
  "gap",
  "row-gap",
  "column-gap",
]);

// Each named pair is bound to the source declarations of its role, [font-size selector, line,
// line-height selector, line]; a role whose values merely coincide gets its own catalogue name.
const NAMED_PAIRS = [
  ["wordmark", "1.1875rem", "1.55", [[".word", 118, "body", 91]]],
  [
    "hero",
    "clamp(2.25rem, 4vw, 3.25rem)",
    "1.06",
    [["h1.display", 147, "h1.display", 147]],
  ],
  ["body", "1rem", "1.55", [["body", 91, "body", 91]]],
  ["title", "2.375rem", "1.12", [[".prose h1", 228, ".prose h1", 228]]],
  ["title-narrow", "1.875rem", "1.12", [[".prose h1", 408, ".prose h1", 228]]],
  ["prose", "1.125rem", "1.7", [[".prose", 224, ".prose", 224]]],
  ["prose-narrow", "1.0313rem", "1.7", [[".prose", 407, ".prose", 224]]],
  ["secno", "2.125rem", "1", [[".secno .n", 226, ".secno .n", 226]]],
  ["secno-narrow", "1.75rem", "1", [[".secno .n", 409, ".secno .n", 226]]],
  [
    "home-h1",
    "clamp(1.6rem, 2.4vw, 2.1rem)",
    "1.06",
    [["h1.display", 487, "h1.display", 147]],
  ],
  ["subtitle", "1rem", "1.5", [["p.sub", 488, ".hero p.sub", 148]]],
  // The code canvas is the editor and the prose code blocks.
  [
    "code",
    "0.875rem",
    "1.6",
    [
      ["pre.code", 245, "pre.code", 245],
      [".editor", 296, ".editor", 296],
    ],
  ],
];

// Roles no DOM state lets win; their authored declarations stand as labelled evidence.
const AUTHORED_ONLY = new Set(["hero"]);

const LISTED_PAIRS = [
  ["0.875rem", "1.3"],
  ["0.875rem", "1.5"],
  ["0.75rem", "1.3"],
  ["0.75rem", "1.55"],
  ["1.125rem", "1.5"],
  ["0.9688rem", "1.55"],
  ["0.9375rem", "1.55"],
  ["0.9375rem", "1.6"],
  ["0.9375rem", "1.7"],
];

const report = {
  unconvertedSpacing: [],
  unexpectedSources: [],
  normalLineHeights: [],
  pseudoElementFonts: [],
  nestedPseudo: [],
  namedPairs: [],
  listedPairs: [],
  toolbarOnlySpacing: [],
  nameAnomalies: [],
  coincidentRoles: [],
};

const [mockupPath, chromePath] = process.argv.slice(2);
if (!mockupPath || !chromePath) {
  console.error("Usage: node extract-mockup.mjs <mockup.html> <chrome.exe>");
  process.exit(2);
}
const html = readFileSync(mockupPath);
const sha256 = createHash("sha256").update(html).digest("hex");
const source = { description: "theme mockup", sha256 };
const htmlText = html.toString("utf8");

const documentTree = parseHtml(htmlText, { sourceCodeLocationInfo: true });
const elements = [];
(function walk(node, ancestors) {
  for (const child of node.childNodes ?? []) {
    if (!child.tagName) continue;
    elements.push({ node: child, ancestors });
    walk(child.content ?? child, [...ancestors, child]);
  }
})(documentTree, []);

const attr = (node, name) => node.attrs.find((a) => a.name === name)?.value;
const classes = (node) =>
  (attr(node, "class") ?? "").split(/\s+/).filter(Boolean);
const describe = (node) =>
  node.tagName +
  (attr(node, "id") ? `#${attr(node, "id")}` : "") +
  classes(node)
    .map((c) => `.${c}`)
    .join("");

const styleElement = elements.find((e) => e.node.tagName === "style").node;
const styleText = styleElement.childNodes[0];
const styleStart = styleText.sourceCodeLocation;
const sheet = postcss.parse(styleText.value);

// Provenance cites lines of the whole mockup, while PostCSS counts from the style element.
const absolute = (pos) => ({
  line: styleStart.startLine + pos.line - 1,
  column: pos.line === 1 ? styleStart.startCol + pos.column - 1 : pos.column,
});

const atRulesOf = (node) => {
  const chain = [];
  for (let p = node.parent; p && p.type !== "root"; p = p.parent) {
    if (p.type === "atrule") chain.unshift(`@${p.name} ${p.params}`);
  }
  return chain;
};

const isToolbarSelector = (selector) => {
  let all = true;
  selectorParser((root) => {
    root.each((sel) => {
      let hit = false;
      sel.walkClasses((c) => {
        if (c.value === "mock") hit = true;
      });
      if (!hit) all = false;
    });
  }).processSync(selector);
  return all;
};

const declByPosition = new Map();
sheet.walkDecls((decl) => {
  const { line, column } = absolute(decl.source.start);
  declByPosition.set(`${line}:${column}`, {
    decl,
    line,
    selector: decl.parent.type === "rule" ? decl.parent.selector : null,
    atRules: atRulesOf(decl),
  });
});

const inlineElements = new Map();
const inlineCount = new Map();
for (const { node, ancestors } of elements) {
  const style = attr(node, "style");
  if (style === undefined) continue;
  const ordinal = inlineCount.get(style) ?? 0;
  inlineCount.set(style, ordinal + 1);
  inlineElements.set(`${style}\u0000${ordinal}`, {
    node,
    line: node.sourceCodeLocation.attrs.style.startLine,
    selector: describe(node),
    text: style,
    toolbar: [...ancestors, node].some((a) => classes(a).includes("mock")),
    decls: postcss.parse(style).nodes.filter((n) => n.type === "decl"),
  });
}

const remFromPx = (number) => {
  const negative = number.startsWith("-");
  const digits = number.replace(/^[-+]/, "");
  const [whole, fraction = ""] = digits.split(".");
  const scaled = BigInt((whole || "0") + fraction) * 625n;
  const scale = fraction.length + 4;
  const text = scaled.toString().padStart(scale + 1, "0");
  let result = `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(
    /\.?0+$/,
    "",
  );
  if (result === "") result = "0";
  return `${negative && result !== "0" ? "-" : ""}${result}rem`;
};

const tokens = new Map();
const addSpacing = (value, sourceValue, occurrence) => {
  for (const node of valueParser(value).nodes) {
    if (node.type === "space" || node.type === "comment") continue;
    if (node.type !== "word") {
      report.unconvertedSpacing.push({
        ...occurrence,
        sourceValue,
        part: valueParser.stringify(node),
      });
      continue;
    }
    const unit = valueParser.unit(node.value);
    if (node.value === "auto" || (unit && Number(unit.number) === 0)) continue;
    let rem = null;
    if (unit && unit.unit === "px") rem = remFromPx(unit.number);
    else if (unit && unit.unit === "rem") rem = node.value;
    if (rem === null) {
      report.unconvertedSpacing.push({
        ...occurrence,
        sourceValue,
        part: node.value,
      });
      continue;
    }
    const entry = tokens.get(rem) ?? { value: rem, occurrences: [] };
    entry.occurrences.push({ ...occurrence, sourceValue });
    tokens.set(rem, entry);
  }
};

sheet.walkDecls((decl) => {
  if (!SPACING_PROPS.has(decl.prop.toLowerCase())) return;
  const selector = decl.parent.type === "rule" ? decl.parent.selector : null;
  addSpacing(decl.value, decl.value, {
    line: absolute(decl.source.start).line,
    column: absolute(decl.source.start).column,
    selector,
    atRules: atRulesOf(decl),
    property: decl.prop,
    origin: "stylesheet",
    toolbar: selector !== null && isToolbarSelector(selector),
  });
});
for (const inline of inlineElements.values()) {
  for (const decl of inline.decls) {
    if (!SPACING_PROPS.has(decl.prop.toLowerCase())) continue;
    addSpacing(decl.value, decl.value, {
      line: inline.line,
      column: 0,
      selector: inline.selector,
      atRules: [],
      property: decl.prop,
      origin: "inline",
      toolbar: inline.toolbar,
    });
  }
}

const tokenName = (value, prefix) => {
  const negative = value.startsWith("-");
  const body = value.replace(/^-/, "").replace(/rem$/, "").replaceAll(".", "-");
  const name = `${prefix}${negative ? "neg-" : ""}${body}`;
  if (!/^--[a-z0-9-]+$/.test(name) || name.includes("--", 2)) {
    report.nameAnomalies.push({ value, name });
  }
  return name;
};

const byOccurrence = (a, b) =>
  a.line - b.line ||
  a.column - b.column ||
  a.property.localeCompare(b.property) ||
  a.selector.localeCompare(b.selector);

const spacingTokens = [...tokens.values()]
  .sort(
    (a, b) =>
      parseFloat(a.value) - parseFloat(b.value) ||
      a.value.localeCompare(b.value),
  )
  .filter((t) => {
    // The mockup's toolbar is excluded, so a value it alone uses is diagnostic data, not a token.
    if (t.occurrences.some((o) => !o.toolbar)) return true;
    report.toolbarOnlySpacing.push({
      value: t.value,
      occurrences: t.occurrences.length,
      lines: [...new Set(t.occurrences.map((o) => o.line))].sort(
        (a, b) => a - b,
      ),
    });
    return false;
  })
  .map((t) => {
    return {
      name: tokenName(t.value, "--space-"),
      value: t.value,
      occurrences: t.occurrences
        .sort(byOccurrence)
        .map((o) =>
          Object.fromEntries(Object.entries(o).filter(([k]) => k !== "column")),
        ),
    };
  });

const pseudoTargets = new Map();
sheet.walkRules((rule) => {
  if (isToolbarSelector(rule.selector)) return;
  selectorParser((root) => {
    root.each((sel) => {
      const forced = new Set();
      sel.walkPseudos((p) => {
        const name = p.value.replace(/^:/, "");
        if (!PSEUDO.includes(name)) return;
        if (p.parent !== sel) {
          report.nestedPseudo.push({ selector: rule.selector, pseudo: name });
          return;
        }
        forced.add(name);
      });
      if (forced.size === 0) return;
      const nodes = sel.nodes;
      const lastIndex = Math.max(
        ...nodes.map((n, i) =>
          n.type === "pseudo" && forced.has(n.value.slice(1)) ? i : -1,
        ),
      );
      let end = lastIndex;
      while (end + 1 < nodes.length && nodes[end + 1].type !== "combinator")
        end++;
      const keep = (n) =>
        !(n.type === "pseudo" && forced.has(n.value.slice(1)));
      const text = (list) => list.filter(keep).map(String).join("").trim();
      const target = text(nodes.slice(0, end + 1)) || "*";
      const affected = text(nodes) || "*";
      const key = `${[...forced].sort().join(",")}\u0000${target}\u0000${affected}`;
      pseudoTargets.set(key, { classes: [...forced].sort(), target, affected });
    });
  }).processSync(rule.selector);
});

sheet.walkDecls((decl) => {
  if (!["font", "font-size", "line-height"].includes(decl.prop)) return;
  if (decl.parent.type !== "rule") return;
  let hasPseudoElement = false;
  selectorParser((root) => {
    root.walkPseudos((p) => {
      if (p.value.startsWith("::") || [":before", ":after"].includes(p.value))
        hasPseudoElement = true;
    });
  }).processSync(decl.parent.selector);
  if (hasPseudoElement) {
    report.pseudoElementFonts.push({
      line: absolute(decl.source.start).line,
      selector: decl.parent.selector,
      property: decl.prop,
      value: decl.value,
    });
  }
});

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error)
          reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
  }
  once(method) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== method) return;
        this.listeners.splice(this.listeners.indexOf(listener), 1);
        resolve(message.params);
      };
      this.listeners.push(listener);
    });
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = mkdtempSync(join(tmpdir(), "mockup-extract-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function devtoolsPort() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return readFileSync(join(profile, "DevToolsActivePort"), "utf8")
        .split("\n")[0]
        .trim();
    } catch {
      await delay(100);
    }
  }
  throw new Error("Chrome did not open a DevTools port.");
}

let cdp;
try {
  const port = await devtoolsPort();
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  cdp = new Cdp(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await cdp.open();
  await measureAll();
} finally {
  try {
    await cdp?.send("Browser.close");
  } catch {
    // The browser may already be gone; the kill below still runs.
  }
  chrome.kill();
  await delay(500);
  rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

async function measureAll() {
  const sheets = new Map();
  sheetHeaders = sheets;
  cdp.listeners.push((message) => {
    if (message.method === "CSS.styleSheetAdded") {
      sheets.set(message.params.header.styleSheetId, message.params.header);
    }
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const url = pathToFileURL(mockupPath).href;
  const measurements = [];

  for (const width of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (const theme of THEMES) {
      for (const view of VIEWS) {
        for (const state of STATES) {
          sheets.clear();
          await cdp.send("CSS.disable").catch(() => {});
          await cdp.send("DOM.disable").catch(() => {});
          const loaded = cdp.once("Page.loadEventFired");
          await cdp.send("Page.navigate", { url });
          await loaded;
          const clicks = [
            `#viewSeg button[data-view="${view}"]`,
            `#themeSeg button[data-choice="${theme}"]`,
            `#learnerSeg button[data-learner="${state.learner}"]`,
            ...state.actions,
          ];
          await evaluate(
            `(${JSON.stringify(clicks)}).forEach((s) => {` +
              `const list = [...document.querySelectorAll(s)];` +
              `if (list.length === 0) throw new Error("No element for " + s);` +
              `list.forEach((el) => el.click()); })`,
          );
          await cdp.send("DOM.enable");
          await cdp.send("CSS.enable");
          const context = { width, theme, view, state: state.name };
          const page = await snapshot();
          for (const index of page.visible) {
            measurements.push(...(await measure(page, index, context, null)));
          }
          for (const pseudo of pseudoTargets.values()) {
            const found = await evaluate(
              selectIndices(pseudo.target, pseudo.affected),
            );
            const targets = found.targets.filter((i) => page.visibleSet.has(i));
            const affected = found.affected.filter((i) =>
              page.visibleSet.has(i),
            );
            if (targets.length === 0 || affected.length === 0) continue;
            for (const i of targets) {
              await cdp.send("CSS.forcePseudoState", {
                nodeId: page.nodeIds[i],
                forcedPseudoClasses: pseudo.classes,
              });
            }
            for (const index of affected) {
              measurements.push(
                ...(await measure(page, index, context, pseudo.classes)),
              );
            }
            for (const i of targets) {
              await cdp.send("CSS.forcePseudoState", {
                nodeId: page.nodeIds[i],
                forcedPseudoClasses: [],
              });
            }
          }
        }
      }
    }
  }
  buildCatalogue(measurements);
}

async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  }
  return result.result.value;
}

function selectIndices(target, affected) {
  return `(() => {
    const all = [...document.querySelectorAll("*")];
    const position = new Map(all.map((el, i) => [el, i]));
    const targets = [...document.querySelectorAll(${JSON.stringify(target)})].map((el) => position.get(el));
    const hit = new Set();
    for (const el of document.querySelectorAll(${JSON.stringify(affected)})) {
      hit.add(position.get(el));
      for (const d of el.querySelectorAll("*")) hit.add(position.get(d));
    }
    return { targets, affected: [...hit].sort((a, b) => a - b) };
  })()`;
}

async function snapshot() {
  const page = await evaluate(`(() => {
    const all = [...document.querySelectorAll("*")];
    const position = new Map(all.map((el, i) => [el, i]));
    const mock = document.querySelector(".mock");
    const ordinals = new Map();
    const describe = (el) => el.localName + (el.id ? "#" + el.id : "") +
      [...el.classList].map((c) => "." + c).join("");
    return all.map((el) => {
      let inline = null;
      if (el.hasAttribute("style")) {
        const value = el.getAttribute("style");
        const n = ordinals.get(value) ?? 0;
        ordinals.set(value, n + 1);
        inline = value + "\\u0000" + n;
      }
      const ancestors = [];
      for (let p = el.parentElement; p; p = p.parentElement) ancestors.push(position.get(p));
      const cs = getComputedStyle(el);
      return {
        visible: !(mock && mock.contains(el)) && el.checkVisibility(),
        describe: describe(el),
        inline,
        ancestors,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
      };
    });
  })()`);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: "*",
  });
  if (nodeIds.length !== page.length)
    throw new Error("DOM and page element counts differ.");
  const visible = page.flatMap((e, i) => (e.visible ? [i] : []));
  return { elements: page, nodeIds, visible, visibleSet: new Set(visible) };
}

async function measure(page, index, context, pseudo) {
  const element = page.elements[index];
  const matched = await cdp.send("CSS.getMatchedStylesForNode", {
    nodeId: page.nodeIds[index],
  });
  const inherited = matched.inherited ?? [];
  // The inherited chain follows the flat tree, so it can include user-agent shadow nodes.
  const chain = [
    { rules: matched.matchedCSSRules ?? [], inline: matched.inlineStyle },
    ...inherited.map((entry) => ({
      rules: entry.matchedCSSRules ?? [],
      inline: entry.inlineStyle,
    })),
  ];
  const fontSize = resolve(chain, "font-size");
  const lineHeight = resolve(chain, "line-height");
  const results = [
    {
      fontSize,
      lineHeight,
      context,
      pseudo,
      element: element.describe,
      computed: element,
    },
  ];
  // A pseudo-element counts only where an author rule for it sets type; otherwise it shares the element's pair.
  for (const entry of matched.pseudoElements ?? []) {
    const rules = entry.matches ?? [];
    const setsType = rules.some((m) =>
      ["font", "font-size", "line-height"].some(
        (prop) =>
          m.rule.origin === "regular" &&
          candidates(m.rule.style, m.rule.origin, m.rule, prop).length > 0,
      ),
    );
    if (!setsType) continue;
    const name = `::${entry.pseudoType}`;
    const effective = await evaluate(`(() => {
      const cs = getComputedStyle(document.querySelectorAll("*")[${index}], ${JSON.stringify(name)});
      return { content: cs.content, fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    })()`);
    if (effective.content === "none") continue;
    const pseudoChain = [{ rules, inline: null }, ...chain];
    results.push({
      fontSize: resolve(pseudoChain, "font-size"),
      lineHeight: resolve(pseudoChain, "line-height"),
      context,
      pseudo,
      pseudoElement: name,
      effective: {
        fontSize: effective.fontSize,
        lineHeight: effective.lineHeight,
      },
      element: `${element.describe}${name}`,
      computed: effective,
    });
  }
  return results;
}

// Cascade ranks: user-agent, author and inline normal, then author, inline and user-agent important.
function rank(origin, important) {
  const base = { "user-agent": 0, regular: 1, inline: 2 }[origin] ?? 1;
  return important ? [3, 4, 5][[1, 2, 0].indexOf(base)] : base;
}

function candidates(style, origin, rule, prop) {
  if (!style) return [];
  const found = [];
  for (const p of style.cssProperties ?? []) {
    if (p.disabled || p.parsedOk === false) continue;
    if (p.name === prop) {
      found.push({
        value: p.value,
        important: Boolean(p.important),
        range: p.range,
        name: p.name,
      });
    } else {
      const longhand = (p.longhandProperties ?? []).find(
        (l) => l.name === prop,
      );
      if (longhand) {
        found.push({
          value: longhand.value,
          important: Boolean(p.important),
          range: p.range,
          name: p.name,
        });
      }
    }
  }
  // A longhand the browser expanded from a shorthand carries no range; the shorthand entry stands for it.
  const explicit = found.filter((c) => c.range);
  const chosen =
    origin === "user-agent" || explicit.length === 0 ? found : explicit;
  return chosen.map((c) => ({
    ...c,
    origin,
    rule,
    styleSheetId: style.styleSheetId,
    cssText: style.cssText,
  }));
}

function winner(level, prop) {
  const all = [
    ...level.rules.flatMap((m) =>
      candidates(m.rule.style, m.rule.origin, m.rule, prop),
    ),
    ...candidates(level.inline, "inline", null, prop),
  ];
  let best = null;
  for (const c of all) {
    if (
      !best ||
      rank(c.origin, c.important) >= rank(best.origin, best.important)
    )
      best = c;
  }
  return best;
}

function resolve(chain, prop) {
  for (let k = 0; k < chain.length; k++) {
    const w = winner(chain[k], prop);
    if (!w || ["inherit", "unset"].includes(w.value.trim())) continue;
    return { ...locate(w, prop), inherited: k > 0 };
  }
  return {
    value: prop === "font-size" ? "medium" : "normal",
    selector: null,
    line: null,
    atRules: [],
    origin: "initial",
    inherited: false,
  };
}

function locate(w, prop) {
  if (w.origin === "inline") {
    const sources = [...inlineElements.values()].filter(
      (e) => e.text === w.cssText,
    );
    if (sources.length !== 1)
      throw new Error(
        `Inline style not unique in the mockup source: ${w.cssText}.`,
      );
    const inline = sources[0];
    const decl = [...inline.decls].reverse().find((d) => d.prop === w.name);
    return {
      value: w.name === prop ? decl.value : w.value,
      selector: inline.selector,
      line: inline.line,
      atRules: [],
      origin: "inline",
    };
  }
  if (w.origin !== "regular" || !w.range) {
    return {
      value: w.value,
      selector: w.rule?.selectorList?.text ?? null,
      line: null,
      atRules: [],
      origin: w.origin,
    };
  }
  const header = sheetHeaders.get(w.styleSheetId);
  const line = header.startLine + w.range.startLine + 1;
  const column =
    (w.range.startLine === 0 ? header.startColumn : 0) +
    w.range.startColumn +
    1;
  const found = declByPosition.get(`${line}:${column}`);
  if (!found || found.decl.prop !== w.name)
    throw new Error(`No source declaration at ${line}:${column}.`);
  return {
    value: w.name === prop ? found.decl.value : w.value,
    selector: found.selector,
    line: found.line,
    atRules: found.atRules,
    origin: "stylesheet",
  };
}

function catName(fontSize, lineHeight) {
  const part = (v) =>
    v
      .toLowerCase()
      .replace(/rem/g, "")
      .replaceAll(".", "-")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `cat-${part(fontSize)}-${part(lineHeight)}`;
}

function roleOf(fs, lh) {
  return NAMED_PAIRS.find(([, , , roles]) =>
    roles.some(
      ([fsSelector, fsLine, lhSelector, lhLine]) =>
        fs.selector === fsSelector &&
        fs.line === fsLine &&
        lh.selector === lhSelector &&
        lh.line === lhLine,
    ),
  );
}

// A named role no DOM state lets win is recorded from its authored declarations alone.
function authoredEvidence([label, fontSize, lineHeight, roles]) {
  const sourceDecl = (selector, line, prop) =>
    [...declByPosition.values()].find(
      (d) => d.selector === selector && d.line === line && d.decl.prop === prop,
    );
  for (const [fsSelector, fsLine, lhSelector, lhLine] of roles) {
    const fs = sourceDecl(fsSelector, fsLine, "font-size");
    const lh = sourceDecl(lhSelector, lhLine, "line-height");
    if (!fs || !lh) continue;
    if (normalise(fs.decl.value) !== normalise(fontSize)) continue;
    if (lh.decl.value !== lineHeight) continue;
    return {
      fontSize: {
        name: `--fs-${label}`,
        value: fontSize,
        mockupSpelling: fs.decl.value,
      },
      lineHeight: { name: `--lh-${label}`, value: lineHeight },
      named: true,
      provenance: [
        {
          selector: fs.selector,
          line: fs.line,
          atRules: fs.atRules,
          origin: "stylesheet",
          lineHeightFrom: {
            selector: lh.selector,
            line: lh.line,
            atRules: lh.atRules,
            origin: "stylesheet",
            inherited: false,
          },
          fontSizeInherited: false,
          evidence: "authored source",
          note: "not observed as the winning DOM pair",
        },
      ],
    };
  }
  return null;
}

function buildCatalogue(measurements) {
  const pairs = new Map();
  for (const m of measurements) {
    const fs = m.fontSize;
    const lh = m.lineHeight;
    const computed = {
      fontSize: m.computed.fontSize,
      lineHeight: m.computed.lineHeight,
    };
    if (m.computed.lineHeight === "normal" || lh.value === "normal") {
      report.normalLineHeights.push({
        element: m.element,
        from: lh.origin,
        selector: lh.selector,
        computed,
      });
    }
    // Only author declarations form pairs; user-agent and initial values are reported instead.
    const authored = (d) => d.origin === "stylesheet" || d.origin === "inline";
    if (!authored(fs) || !authored(lh)) {
      for (const [property, d] of [
        ["font-size", fs],
        ["line-height", lh],
      ]) {
        if (authored(d)) continue;
        report.unexpectedSources.push({
          element: m.element,
          property,
          value: d.value,
          origin: d.origin,
          selector: d.selector,
          computed,
        });
      }
      continue;
    }
    {
      let unexpected = false;
      valueParser(fs.value).walk((n) => {
        if (n.type !== "word") return;
        const unit = valueParser.unit(n.value);
        if (!unit || !["rem", "vw"].includes(unit.unit)) unexpected = true;
      });
      if (unexpected) {
        report.unexpectedSources.push({
          element: m.element,
          property: "font-size",
          value: fs.value,
          origin: fs.origin,
        });
      }
    }
    const role = roleOf(fs, lh);
    const key = role ? `named\u0000${role[0]}` : `${fs.value}\u0000${lh.value}`;
    const pair = pairs.get(key) ?? {
      fontSize: fs.value,
      lineHeight: lh.value,
      role,
      provenance: new Map(),
    };
    if (role && (fs.value !== pair.fontSize || lh.value !== pair.lineHeight)) {
      report.namedPairs.push({
        name: role[0],
        mockup: `${fs.value} / ${lh.value}`,
        note: "role measured with two values",
      });
    }
    const lineHeightFrom = {
      selector: lh.selector,
      line: lh.line,
      atRules: lh.atRules,
      origin: lh.origin,
      inherited: lh.inherited,
    };
    const provKey = JSON.stringify([
      fs.selector,
      fs.line,
      lineHeightFrom,
      fs.inherited,
      m.pseudoElement,
    ]);
    const prov = pair.provenance.get(provKey) ?? {
      selector: fs.selector,
      line: fs.line,
      atRules: fs.atRules,
      origin: fs.origin,
      lineHeightFrom,
      fontSizeInherited: fs.inherited,
      viewports: new Set(),
      themes: new Set(),
      views: new Set(),
      states: new Set(),
      pseudo: new Set(),
      unforced: false,
      elements: new Set(),
      pseudoElement: m.pseudoElement,
      effective: new Set(),
    };
    if (m.pseudoElement) prov.effective.add(JSON.stringify(m.effective));
    prov.viewports.add(m.context.width);
    prov.themes.add(m.context.theme);
    prov.views.add(m.context.view);
    prov.states.add(m.context.state);
    if (m.pseudo) m.pseudo.forEach((p) => prov.pseudo.add(p));
    else prov.unforced = true;
    prov.elements.add(m.element);
    pair.provenance.set(provKey, prov);
    pairs.set(key, pair);
  }

  const sorted = (set, numeric) =>
    [...set].sort(numeric ? (a, b) => b - a : (a, b) => a.localeCompare(b));
  const matchedNames = new Set();
  const out = [...pairs.values()].map((pair) => {
    const named = pair.role;
    let fontSize;
    let lineHeight;
    if (named) {
      const [label, fs, lh] = named;
      matchedNames.add(label);
      measuredRoles.add(label);
      fontSize = { name: `--fs-${label}`, value: fs };
      lineHeight = { name: `--lh-${label}`, value: lh };
      if (
        normalise(fs) !== normalise(pair.fontSize) ||
        lh !== pair.lineHeight
      ) {
        report.namedPairs.push({
          name: label,
          contract: `${fs} / ${lh}`,
          mockup: `${pair.fontSize} / ${pair.lineHeight}`,
          note: "role value differs from the contract",
        });
      } else if (fs !== pair.fontSize) {
        report.namedPairs.push({
          name: label,
          contract: fs,
          mockup: pair.fontSize,
          note: "spelling differs",
        });
      }
      fontSize.mockupSpelling = pair.fontSize;
    } else {
      const label = catName(pair.fontSize, pair.lineHeight);
      if (!/^cat-[0-9-]+$/.test(label)) {
        report.nameAnomalies.push({
          value: `${pair.fontSize} / ${pair.lineHeight}`,
          name: `--fs-${label}`,
        });
      }
      const coincident = NAMED_PAIRS.find(
        ([, fs, lh]) =>
          normalise(fs) === normalise(pair.fontSize) && lh === pair.lineHeight,
      );
      if (coincident) {
        report.coincidentRoles.push({
          name: `--fs-${label}`,
          sharesValuesWith: `--fs-${coincident[0]}`,
          selectors: [...pair.provenance.values()].map((p) => p.selector),
        });
      }
      fontSize = { name: `--fs-${label}`, value: pair.fontSize };
      lineHeight = { name: `--lh-${label}`, value: pair.lineHeight };
    }
    const provenance = [...pair.provenance.values()]
      .map((p) => ({
        selector: p.selector,
        line: p.line,
        atRules: p.atRules,
        origin: p.origin,
        lineHeightFrom: p.lineHeightFrom,
        fontSizeInherited: p.fontSizeInherited,
        viewports: sorted(p.viewports, true),
        themes: sorted(p.themes),
        views: sorted(p.views),
        states: sorted(p.states),
        pseudo: sorted(p.pseudo),
        unforced: p.unforced,
        elements: sorted(p.elements),
        ...(p.pseudoElement && {
          pseudoElement: p.pseudoElement,
          effective: sorted(p.effective).map((e) => JSON.parse(e)),
        }),
      }))
      .sort(
        (a, b) =>
          (a.line ?? 0) - (b.line ?? 0) ||
          String(a.selector).localeCompare(String(b.selector)) ||
          JSON.stringify(a.lineHeightFrom).localeCompare(
            JSON.stringify(b.lineHeightFrom),
          ) ||
          Number(a.fontSizeInherited) - Number(b.fontSizeInherited) ||
          String(a.pseudoElement).localeCompare(String(b.pseudoElement)),
      );
    return { fontSize, lineHeight, named: Boolean(named), provenance };
  });

  for (const role of NAMED_PAIRS) {
    if (matchedNames.has(role[0])) continue;
    const evidence = AUTHORED_ONLY.has(role[0]) ? authoredEvidence(role) : null;
    if (evidence) out.push(evidence);
    else
      report.namedPairs.push({
        name: role[0],
        contract: `${role[1]} / ${role[2]}`,
        note: "never measured",
      });
  }
  out.sort(
    (a, b) =>
      a.fontSize.name.localeCompare(b.fontSize.name) ||
      a.lineHeight.name.localeCompare(b.lineHeight.name),
  );

  const values = new Set(
    [...pairs.values()].map((p) => `${p.fontSize}\u0000${p.lineHeight}`),
  );
  for (const [fs, lh] of LISTED_PAIRS) {
    if (!values.has(`${fs}\u0000${lh}`))
      report.listedPairs.push(`${fs} / ${lh}`);
  }
  catalogue = { source, generator: GENERATOR, pairs: out };
}

async function writeJson(name, data) {
  const target = new URL(name, REGISTRY);
  const options = (await prettier.resolveConfig(target)) ?? {};
  const text = await prettier.format(JSON.stringify(data, null, 2), {
    ...options,
    parser: "json",
  });
  writeFileSync(target, text);
}

const failures = roleFailures({
  roles: NAMED_PAIRS,
  authoredOnly: AUTHORED_ONLY,
  declarations: [
    ...[...declByPosition.values()].map((d) => ({
      selector: d.selector,
      line: d.line,
      prop: d.decl.prop,
      value: d.decl.value,
    })),
    ...[...inlineElements.values()].flatMap((e) =>
      e.decls.map((d) => ({
        selector: e.selector,
        line: e.line,
        prop: d.prop,
        value: d.value,
      })),
    ),
  ],
  measured: measuredRoles,
  conflicts: report.namedPairs,
});
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

await writeJson("spacing-inventory.json", {
  source,
  generator: GENERATOR,
  tokens: spacingTokens,
});
await writeJson("type-catalogue.json", catalogue);

const dedupe = (list) =>
  [...new Set(list.map((x) => JSON.stringify(x)))]
    .sort()
    .map((x) => JSON.parse(x));
for (const key of Object.keys(report)) report[key] = dedupe(report[key]);
console.log(JSON.stringify(report, null, 2));
console.log(
  `pseudo targets: ${pseudoTargets.size}; spacing tokens: ${spacingTokens.length}; catalogue pairs: ${catalogue.pairs.length}; named matched: ${
    catalogue.pairs.filter((p) => p.named).length
  }`,
);
