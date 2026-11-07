// Throwaway project trees for build-guard tests, built with the real Vite config in memory.
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "vite";

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

const bases = [];
const links = [];

// A link is a junction on Windows and a symlink elsewhere; the type is ignored off Windows.
export function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
  links.push(path);
}

// Lays out base/web (the project root) and base/outside; paths starting "../" land beside web.
export function fixture(files, { modules = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "sl-guard-"));
  bases.push(base);
  const root = join(base, "web");
  mkdirSync(root);
  const all = { "index.html": approvedHtml, ...files };
  for (const [path, content] of Object.entries(all)) {
    if (content === null) continue;
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  if (modules) link(join(web, "node_modules"), join(root, "node_modules"));
  return { base, root };
}

export const buildRoot = (root, options = {}) =>
  build({
    root,
    configFile,
    logLevel: "silent",
    build: { write: false },
    ...options,
  });

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
