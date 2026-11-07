// Admits the production output: the entry page, one generated chunk and at most one stylesheet.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { GuardError } from "./classify.js";
import { layerOrder } from "./prelude.js";

// A drift check on the resolved pipeline, not authentication: a plugin can claim any name.
export const pinnedPlugins = [
  "vite:optimized-deps",
  "vite:watch-package-data",
  "vite:pre-alias",
  "alias",
  "sharpladder:build-guard",
  "vite:react-babel",
  "vite:react-refresh-fbm",
  "vite:react-refresh",
  "vite:modulepreload-polyfill",
  "vite:bundled-dev-client-imports",
  "vite:resolve-builtin:get-environment",
  "vite:resolve-builtin",
  "vite:html-inline-proxy",
  "vite:css",
  "builtin:oxc-runtime",
  "vite:oxc",
  "builtin:vite-json",
  "vite:wasm-helper",
  "vite:worker",
  "vite:asset",
  "vite:react-virtual-preamble",
  "vite:define",
  "vite:css-post",
  "vite:build-html",
  "vite:worker-import-meta-url",
  "vite:asset-import-meta-url",
  "vite:prepare-out-dir",
  "vite:rollup-options-plugins",
  "vite:dynamic-import-vars",
  "vite:import-glob",
  "vite:react:config-post",
  "vite:build-import-analysis",
  "native:import-analysis-build",
  "vite:terser",
  "vite:license",
  "native:manifest",
  "vite:ssr-manifest",
  "native:reporter",
  "builtin:vite-load-fallback",
  "vite:client-inject",
  "vite:css-analysis",
  "vite:import-analysis",
];

// Vite's own client aliases; any other alias could redirect an import past the guard.
const builtinAliases = ["/^\\/?@vite\\/env/", "/^\\/?@vite\\/client/"];

const fail = (message) => {
  throw new GuardError(`build guard: ${message}`);
};

export function configViolations(config) {
  const found = [];
  const names = config.plugins.map(({ name }) => name);
  if (JSON.stringify(names) !== JSON.stringify(pinnedPlugins)) {
    found.push(`plugin list differs from the pinned list: ${names.join(", ")}`);
  }
  // Vite resolves publicDir: false to the empty string.
  if (config.publicDir !== "") found.push("publicDir is not false");
  const { build } = config;
  if (build.cssCodeSplit !== false)
    found.push("build.cssCodeSplit is not false");
  if (build.assetsInlineLimit !== 0)
    found.push("build.assetsInlineLimit is not 0");
  if (build.sourcemap) found.push("build.sourcemap is enabled");
  if (build.manifest) found.push("build.manifest is enabled");
  if (build.ssrManifest) found.push("build.ssrManifest is enabled");
  if (
    build.rollupOptions?.input !== undefined ||
    build.rolldownOptions?.input !== undefined
  ) {
    found.push("build input is not the default index.html");
  }
  const aliases = config.resolve.alias.map(({ find }) => String(find));
  if (JSON.stringify(aliases) !== JSON.stringify(builtinAliases)) {
    found.push(`resolve.alias differs from Vite's own: ${aliases.join(", ")}`);
  }
  return found;
}

const sha256 = (content) => createHash("sha256").update(content).digest("hex");

// Layer names must first appear in the declared order; a nested layer would hide a new name.
export function layerViolations(css) {
  let root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    return [`unparsable output CSS: ${error.message}`];
  }
  const found = [];
  const seen = [];
  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() !== "layer") return;
    for (let up = rule.parent; up; up = up.parent) {
      if (up.type === "atrule" && up.name.toLowerCase() === "layer") {
        found.push(`nested @layer ${rule.params}`);
        return;
      }
    }
    for (const name of rule.params.split(",").map((part) => part.trim())) {
      if (!layerOrder.includes(name))
        found.push(`unknown layer ${JSON.stringify(name)}`);
      else if (!seen.includes(name)) seen.push(name);
    }
  });
  const ranks = seen.map((name) => layerOrder.indexOf(name));
  if (ranks.some((rank, i) => i > 0 && rank < ranks[i - 1])) {
    found.push(`layers first appear as ${seen.join(", ")}`);
  }
  return found;
}

const chunkName = /^assets\/[^/]+\.js$/u;
const cssName = /^assets\/[^/]+\.css$/u;

const contentOf = (fileName, content) => {
  if (typeof content !== "string" && !(content instanceof Uint8Array)) {
    fail(`output ${fileName} has no content`);
  }
  return content;
};

// Hashes every output and fails on anything outside the admitted shape.
export function snapshot(bundle) {
  const files = new Map();
  const counts = { chunk: 0, page: 0, sheet: 0 };
  for (const [key, out] of Object.entries(bundle)) {
    const { fileName, type } = out;
    if (key !== fileName) fail(`output ${key} is keyed apart from ${fileName}`);
    let content;
    if (type === "chunk" && chunkName.test(fileName)) {
      counts.chunk += 1;
      content = contentOf(fileName, out.code);
    } else if (type === "asset" && fileName === "index.html") {
      counts.page += 1;
      content = contentOf(fileName, out.source);
    } else if (type === "asset" && cssName.test(fileName)) {
      counts.sheet += 1;
      content = contentOf(fileName, out.source);
      const found = layerViolations(Buffer.from(content).toString("utf8"));
      if (found.length > 0) fail(`${fileName}: ${found.join("; ")}`);
    } else {
      fail(`unexpected ${String(type)} output ${fileName}`);
    }
    files.set(fileName, { type, sha256: sha256(content) });
  }
  if (counts.chunk !== 1) fail(`expected one chunk, found ${counts.chunk}`);
  if (counts.page !== 1) fail(`expected one index.html, found ${counts.page}`);
  if (counts.sheet > 1) {
    fail(`expected at most one stylesheet, found ${counts.sheet}`);
  }
  return files;
}

// Fails unless both inventories hold the same file names with the same hashes.
export function sameInventory(expected, actual, where) {
  for (const name of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(name);
    const got = actual.get(name);
    if (want === undefined) fail(`${where} has an extra file ${name}`);
    if (got === undefined) fail(`${where} is missing ${name}`);
    if (want.sha256 !== got.sha256) {
      fail(`${name} differs from the snapshot in ${where}`);
    }
  }
}

const attempt = (what, run) => {
  try {
    return run();
  } catch (error) {
    return fail(`cannot ${what}: ${error.message}`);
  }
};

// An lstat walk that trusts nothing the build reported: no links and no special files.
export function walkDist(outDir) {
  const files = new Map();
  const visit = (dir, prefix) => {
    for (const entry of attempt(`list ${dir}`, () => readdirSync(dir))) {
      const path = join(dir, entry);
      const name = `${prefix}${entry}`;
      const stat = attempt(`stat ${name}`, () => lstatSync(path));
      if (stat.isSymbolicLink()) fail(`${name} is a link`);
      if (stat.isDirectory()) visit(path, `${name}/`);
      else if (stat.isFile()) {
        const content = attempt(`read ${name}`, () => readFileSync(path));
        files.set(name, { sha256: sha256(content) });
      } else fail(`${name} is not a regular file`);
    }
  };
  visit(outDir, "");
  return files;
}

// The config is bundled apart from build.mjs, so the two meet through the global symbol registry.
const slot = Symbol.for("sharpladder.build-guard.inventory");

export const publishInventory = (record) => {
  globalThis[slot] = record;
};

export function takeInventory() {
  const record = globalThis[slot] ?? null;
  globalThis[slot] = null;
  return record;
}
