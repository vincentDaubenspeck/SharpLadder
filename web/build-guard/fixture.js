// Throwaway project trees for build-guard tests, built with the real Vite config in memory.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundleAsync, transform } from "lightningcss";
import { build, loadConfigFromFile } from "vite";
import { generateFaces } from "../asset-licence-check.js";
import { releaseBuild } from "./build.mjs";
import { classPattern, lightningTargets } from "./contract.js";
import { layerPrelude } from "./prelude.js";
import { rendererModules } from "../source-policy/renderer.js";

const web = join(import.meta.dirname, "..");
const configFile = join(web, "vite.config.ts");

export const approvedHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fixture</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

export const inventoryFile = "assets/licences/asset-inventory.json";
export const sliceRecordFile = "assets/licences/font-slice.json";

/** The recorded font slice for an inventory, as the metadata check requires it beside the inventory. */
function sliceRecord(inventory) {
  const { bytes } = generateFaces(inventory);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return `${JSON.stringify({ sha256, byteLength: bytes.length }, null, 2)}\n`;
}

// The production policy with no records, so a fixture ships no font unless it brings one.
const production = JSON.parse(readFileSync(join(web, inventoryFile), "utf8"));
const emptyInventory = `${JSON.stringify({ ...production, assets: [] }, null, 2)}\n`;

/** The smallest token sheet Tool B binds; every built fixture needs one stylesheet. */
export const tokensSheet = `@layer tokens, base, components, overrides;
@layer tokens {
  :root {
    --bg: #fff;
  }
}
`;

const tokensFile = "src/theme/tokens.css";

// Every build checks the renderer modules, so a fixture carries the real ones unless it brings its own.
const helperFiles = Object.fromEntries(
  [...rendererModules.keys()].map((unit) => [
    `src/${unit}`,
    readFileSync(join(web, "src", unit), "utf8"),
  ]),
);

// A fixture entry imports the token sheet first unless it brings its own or opts out.
function withTokens(files) {
  const main = files["src/main.tsx"];
  if (typeof main !== "string" || tokensFile in files) return files;
  return {
    ...files,
    [tokensFile]: tokensSheet,
    "src/main.tsx": `import "./theme/tokens.css";
${main}`,
  };
}

const bases = [];
const links = [];

// A link is a junction on Windows and a symlink elsewhere; the type is ignored off Windows.
export function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
  links.push(path);
}

// Lays out base/web (the project root) and base/outside; paths starting "../" land beside web.
// A fixture can put its project one named folder deeper, to choose the name of an ancestor,
// and can set up the empty project folder before any file is written.
export function fixture(
  files,
  { modules = true, tokens = true, helpers = true, under = "", prepare } = {},
) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "sl-guard-")));
  bases.push(base);
  const root = join(base, under, "web");
  mkdirSync(root, { recursive: true });
  prepare?.(root);
  const all = {
    "index.html": approvedHtml,
    [inventoryFile]: emptyInventory,
    ...(helpers ? helperFiles : {}),
    ...(tokens ? withTokens(files) : files),
  };
  // A fixture that brings no record gets the one its inventory implies; a broken one gets none.
  if (!(sliceRecordFile in all))
    try {
      all[sliceRecordFile] = sliceRecord(
        JSON.parse(String(all[inventoryFile])),
      );
    } catch {
      // The inventory check reports the broken inventory itself.
    }
  for (const [path, content] of Object.entries(all)) {
    if (content === null) continue;
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  if (modules) link(join(web, "node_modules"), join(root, "node_modules"));
  return { base, root };
}

function sheetsUnder(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sheetsUnder(path, found);
    else if (entry.isFile() && entry.name.endsWith(".css")) found.push(path);
  }
  return found;
}

/** P12: on every stylesheet of a fixture that built, transform and bundleAsync print the same bytes. */
async function agree(root) {
  const src = join(root, "src");
  if (!existsSync(src)) return 0;
  const sheets = sheetsUnder(src);
  for (const file of sheets) {
    const code = layerPrelude + readFileSync(file, "utf8");
    const options = {
      filename: file,
      errorRecovery: false,
      targets: lightningTargets,
      minify: false,
      ...(file.endsWith(".module.css")
        ? { cssModules: { pure: true, pattern: classPattern } }
        : {}),
    };
    const viaTransform = transform({ ...options, code: Buffer.from(code) });
    const viaBundle = await bundleAsync({
      ...options,
      resolver: { read: () => code, resolve: (specifier) => specifier },
    });
    if (viaBundle.code.toString("utf8") !== viaTransform.code.toString("utf8"))
      throw new Error(`P12: transform and bundleAsync differ on ${file}`);
  }
  return sheets.length;
}

// A build that passes also proves P12 over the stylesheets it was given.
export const buildRoot = async (root, options = {}) => {
  const result = await build({
    root,
    configFile,
    logLevel: "silent",
    build: { write: false },
    ...options,
  });
  await agree(root);
  return result;
};

/** The release build over a fixture, with P12 over its stylesheets once it passes. */
export async function releaseRoot(root, inline = {}, options = {}) {
  const built = await releaseBuild(
    { logLevel: "silent", root, ...inline },
    options,
  );
  await agree(root);
  return built;
}

// A6: the real config and guard instance, changed in memory only, never on disk.
export async function harness(files, mutate) {
  const { root } = fixture(files);
  const { config } = await loadConfigFromFile(
    { command: "build", mode: "production" },
    configFile,
  );
  const state = mutate(config) ?? {};
  const run = releaseBuild({
    ...config,
    root,
    configFile: false,
    logLevel: "silent",
  });
  return { run, state, root };
}

export const pluginNamed = (config, name) =>
  config.plugins.flat().find((plugin) => plugin?.name === name);

export const buildFixture = (files, options) =>
  buildRoot(fixture(files, options).root);

export const outputFiles = (result) =>
  [result]
    .flat()
    .flatMap(({ output }) => output.map(({ fileName }) => fileName));

// Links are removed first so a recursive delete can never reach through them.
export function cleanUp() {
  for (const path of links.splice(0)) {
    if (process.platform === "win32") rmdirSync(path);
    else unlinkSync(path);
  }
  for (const base of bases.splice(0))
    rmSync(base, { recursive: true, force: true });
}
