// Pure checks behind the build guard, kept apart from the plugin so tests can drive them directly.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import {
  checkProgram,
  describeFinding,
  parseSource,
} from "../source-policy/index.js";

export class GuardError extends Error {}

const fail = (message) => {
  throw new GuardError(`build guard: ${message}`);
};

// Each virtual id is admitted only in the hooks where a clean build was seen to produce it.
const virtualIds = new Map([
  [
    "\0vite/modulepreload-polyfill.js",
    new Set(["resolveId", "load", "transform", "moduleParsed", "getModuleIds"]),
  ],
  ["\0rolldown/runtime.js", new Set(["transform"])],
]);

// Specifiers that name a virtual module; first-party code never imports them itself.
const reservedSpecifier =
  /^(?:\0|vite\/modulepreload-polyfill|rolldown\/runtime|virtual:|\/@)/u;
export const isReservedSpecifier = (source) => reservedSpecifier.test(source);

const anyModuleStyle =
  /\.module\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/iu;
const firstPartyExtension = /\.(tsx|ts|css)$/u;

// Windows paths compare without case and with one separator; the canonical form is only a key.
export const pathKey = (p, platform = process.platform) => {
  const forward = resolve(p).replaceAll("\\", "/");
  return platform === "win32" ? forward.toLowerCase() : forward;
};

const inside = (dirKey, key) => dirKey !== null && key.startsWith(`${dirKey}/`);

const realpath = (p) => {
  try {
    return realpathSync.native(p);
  } catch (error) {
    return fail(`cannot canonicalise ${JSON.stringify(p)}: ${error.message}`);
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return fail(`cannot read ${JSON.stringify(file)}: ${error.message}`);
  }
};

// Resolves the fixed locations once; src must be a real directory, never a link elsewhere.
export function guardContext(root) {
  const realRoot = realpath(root);
  const srcKey = pathKey(realpath(join(root, "src")));
  if (srcKey !== pathKey(join(realRoot, "src"))) {
    fail(`src resolves outside the project root (${srcKey})`);
  }
  const modules = join(root, "node_modules");
  return {
    root: realRoot,
    srcKey,
    htmlKey: pathKey(join(realRoot, "index.html")),
    modulesKey: existsSync(modules) ? pathKey(realpath(modules)) : null,
  };
}

// The first named package.json above a dependency file must be its package directory's own.
function dependency(ctx, real, key) {
  const segments = key.slice(ctx.modulesKey.length + 1).split("/");
  const width = segments[0]?.startsWith("@") ? 2 : 1;
  const dirName = segments.slice(0, width).join("/");
  if (
    segments.length <= width ||
    dirName.startsWith(".") ||
    segments.includes("node_modules")
  ) {
    fail(`dependency id outside a top-level package: ${real}`);
  }
  const packageKey = `${ctx.modulesKey}/${dirName}`;
  for (
    let dir = dirname(real);
    inside(ctx.modulesKey, pathKey(dir));
    dir = dirname(dir)
  ) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const owner = readJson(manifest).name;
    if (owner === undefined) continue;
    const ownerKey =
      process.platform === "win32" ? String(owner).toLowerCase() : owner;
    if (pathKey(dir) !== packageKey || ownerKey !== dirName) {
      fail(
        `dependency ${real} is owned by ${JSON.stringify(owner)}, not its directory`,
      );
    }
    return { kind: "dependency", name: owner };
  }
  return fail(`dependency ${real} has no package.json naming its package`);
}

// Classifies one module id seen in a hook, or throws naming the id.
export function classifyId(ctx, id, hook) {
  if (typeof id !== "string" || id === "") fail(`unresolved id in ${hook}`);
  if (id.startsWith("\0")) {
    if (virtualIds.get(id)?.has(hook)) return { kind: "virtual" };
    fail(`virtual id ${JSON.stringify(id)} is not allowed in ${hook}`);
  }
  if (id.includes("?") || id.includes("#"))
    fail(`query or fragment on id ${id}`);
  if (!isAbsolute(id)) fail(`id is not an absolute path: ${id}`);
  const real = realpath(id);
  const key = pathKey(real);
  if (key === ctx.htmlKey) return { kind: "html" };
  if (inside(ctx.srcKey, key)) {
    const extension = firstPartyExtension.exec(real)?.[1];
    if (extension === undefined)
      fail(`first-party file is not .ts, .tsx or .css: ${real}`);
    if (anyModuleStyle.test(real) && !real.endsWith(".module.css")) {
      fail(`CSS modules must be .module.css: ${real}`);
    }
    return { kind: "first-party", lang: extension };
  }
  if (inside(ctx.modulesKey, key)) return dependency(ctx, real, key);
  return fail(`id outside src and node_modules: ${real}`);
}

// The build verdict parses the original source as the editor does and reads the tree alone,
// so no disable comment can reach it; a parse failure throws.
export function scriptViolations(code, filePath) {
  const { ast, scopeManager } = parseSource(code, filePath);
  return checkProgram(ast, scopeManager).map(describeFinding);
}

// Returns the forbidden constructs in a source stylesheet; an escaped name is refused because
// the CSS transformer would decode it.
export function cssViolations(code, from) {
  let root;
  try {
    root = postcss.parse(code, { from });
  } catch (error) {
    return [`unparsable CSS: ${error.message}`];
  }
  const found = [];
  root.walkDecls((decl) => {
    if (decl.prop.includes("\\")) found.push(`escaped property ${decl.prop}`);
    else if (decl.prop.toLowerCase() === "composes") found.push("composes");
  });
  root.walkAtRules((rule) => {
    if (rule.name.includes("\\")) found.push(`escaped at-rule @${rule.name}`);
    else if (rule.name.toLowerCase() === "import") found.push("@import");
  });
  return found;
}

const viewport = "width=device-width, initial-scale=1.0";

const approved = {
  tag: "html",
  attrs: { lang: "en" },
  children: [
    {
      tag: "head",
      attrs: {},
      children: [
        { tag: "meta", attrs: { charset: "UTF-8" }, children: [] },
        {
          tag: "meta",
          attrs: { name: "viewport", content: viewport },
          children: [],
        },
        { tag: "title", attrs: {}, text: true },
      ],
    },
    {
      tag: "body",
      attrs: {},
      children: [
        { tag: "div", attrs: { id: "root" }, children: [] },
        {
          tag: "script",
          attrs: { type: "module", src: "/src/main.tsx" },
          children: [],
        },
      ],
    },
  ],
};

const blank = (node) => node.nodeName === "#text" && /^\s*$/u.test(node.value);

function compareElement(node, want, path, found) {
  const where = `${path}${want.tag}`;
  if (node?.nodeName !== want.tag) {
    found.push(`${where}: found ${node?.nodeName ?? "nothing"}`);
    return;
  }
  const attrs = node.attrs.map(({ name, value }) => [name, value]);
  const expected = Object.entries(want.attrs);
  const same =
    attrs.length === expected.length &&
    expected.every(([name, value]) =>
      attrs.some(([n, v]) => n === name && v === value),
    );
  if (!same)
    found.push(
      `${where}: attributes ${JSON.stringify(Object.fromEntries(attrs))}`,
    );
  if (want.text) {
    if (!node.childNodes.every((c) => c.nodeName === "#text"))
      found.push(`${where}: not text`);
    return;
  }
  const kids = node.childNodes.filter((c) => !blank(c));
  if (kids.length !== want.children.length) {
    found.push(
      `${where}: ${kids.length} children, expected ${want.children.length}`,
    );
  }
  want.children.forEach((child, i) =>
    compareElement(kids[i], child, `${where} > `, found),
  );
}

// Returns every way the authored page differs from the approved structure.
export function htmlViolations(html) {
  const found = [];
  const doc = parseHtml(html, {
    onParseError: (e) => found.push(`parse error ${e.code}`),
  });
  const [doctype, element, ...rest] = doc.childNodes;
  if (
    doctype?.nodeName !== "#documentType" ||
    doctype.name !== "html" ||
    doctype.publicId !== "" ||
    doctype.systemId !== ""
  ) {
    found.push("missing or non-standard doctype");
  }
  if (rest.length > 0) found.push("content after the html element");
  compareElement(element, approved, "", found);
  return found;
}
