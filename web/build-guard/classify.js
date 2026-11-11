// Pure checks behind the build guard, kept apart from the plugin so tests can drive them directly.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import {
  checkProgram,
  describeFinding,
  parseSource,
} from "../source-policy/index.js";
import { isReservedPath } from "../source-policy/renderer.js";
import {
  canonical,
  descendant,
  sourceIdentity,
} from "../source-policy/unit.js";

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

const realpath = (p) => {
  try {
    return canonical(p);
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

// Resolves the fixed locations once, in the spelling the disk holds; every later comparison is
// character for character. The src folder and the page are the project's own, never a link
// elsewhere.
export function guardContext(root) {
  const realRoot = realpath(root);
  const src = realpath(join(root, "src"));
  if (src !== join(realRoot, "src")) {
    fail(`src resolves outside the project root (${src})`);
  }
  const modules = join(root, "node_modules");
  return {
    root: realRoot,
    src,
    html: join(realRoot, "index.html"),
    modules: existsSync(modules) ? realpath(modules) : null,
  };
}

/** A project file's path below the project directory, with forward slashes, or null. */
export const projectPath = (ctx, real) =>
  descendant(ctx.root, real)?.split(sep).join("/") ?? null;

// The first named package.json above a dependency file must be its package directory's own.
function dependency(ctx, real, below) {
  const segments = below.split(sep);
  const width = segments[0]?.startsWith("@") ? 2 : 1;
  const dirName = segments.slice(0, width).join("/");
  if (
    segments.length <= width ||
    dirName.startsWith(".") ||
    segments.some((segment) => segment.toLowerCase() === "node_modules")
  ) {
    fail(`dependency id outside a top-level package: ${real}`);
  }
  const packageDir = join(ctx.modules, ...segments.slice(0, width));
  for (
    let dir = dirname(real);
    descendant(ctx.modules, dir) !== null;
    dir = dirname(dir)
  ) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const owner = readJson(manifest).name;
    if (owner === undefined) continue;
    if (dir !== packageDir || owner !== dirName) {
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
  if (real === ctx.html) return { kind: "html" };
  if (descendant(ctx.src, real) !== null) {
    const extension = firstPartyExtension.exec(real)?.[1];
    if (extension === undefined)
      fail(`first-party file is not .ts, .tsx or .css: ${real}`);
    if (anyModuleStyle.test(real) && !real.endsWith(".module.css")) {
      fail(`CSS modules must be .module.css: ${real}`);
    }
    return { kind: "first-party", lang: extension };
  }
  const below = ctx.modules === null ? null : descendant(ctx.modules, real);
  if (below !== null) return dependency(ctx, real, below);
  return fail(`id outside src and node_modules: ${real}`);
}

// The build verdict parses the original source as the editor does and reads the tree alone,
// so no disable comment can reach it; a parse failure throws.
export function scriptViolations(code, filePath, unit = null) {
  const { ast, scopeManager } = parseSource(code, filePath);
  return checkProgram(
    ast,
    scopeManager,
    unit,
    code,
    code.startsWith("\uFEFF"),
  ).map(describeFinding);
}

// A first-party module's path under src, in its real case, with forward slashes. A module the
// guard holds to be first-party always has one, so the two can never disagree in silence.
export const sourceUnit = (ctx, id) => {
  const { unit, error } = sourceIdentity(ctx.root, id);
  if (error !== undefined) fail(`${id}: ${error}`);
  return unit ?? fail(`${id}: it has no place under src`);
};

// The renderer, its tests and the generated content are test-only and never reach production,
// under any letter case of their folders.
export const isTestOnly = (unit) => isReservedPath(unit);

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
