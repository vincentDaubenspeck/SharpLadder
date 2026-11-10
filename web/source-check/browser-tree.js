import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { eslintCoverage } from "./coverage.js";
import { shown } from "./paths.js";
import { admitTree } from "./walk.js";

/**
 * Every entry under web/browser by exact name. TypeScript is checked by the browser program;
 * the tooling scripts are linted as plain JavaScript and never type-checked; a declaration is
 * admitted only as a named external boundary; assets are data no program reads as code.
 */
const browserInventory = {
  tooling: [
    "observed.mjs",
    "run.mjs",
    "serve.mjs",
    "specimen.mjs",
    "specimen.test.js",
  ],
  declarations: [],
  assets: ["font-baselines.json"],
};

const declarationFile = /\.d\.[cm]?tsx?$/u;
const refusedCode = [".tsx", ".mts", ".cts", ".cjs", ".jsx"];
const toolingCode = [".mjs", ".js"];

/** Classifies one file by its path under browser; anything unlisted is refused. */
function classifyBrowserEntry(at, inventory = browserInventory) {
  if (declarationFile.test(at))
    return inventory.declarations.includes(at)
      ? { kind: "declaration" }
      : { reason: "declaration file is not on the named list" };
  const suffix = refusedCode.find((s) => at.endsWith(s));
  if (suffix) return { reason: `${suffix} is not admitted under browser` };
  if (at.endsWith(".ts")) return { kind: "ts" };
  if (toolingCode.some((s) => at.endsWith(s)))
    return inventory.tooling.includes(at)
      ? { kind: "tooling" }
      : { reason: "script is not on the named tooling list" };
  if (inventory.assets.includes(at)) return { kind: "asset" };
  return { reason: "not on the browser inventory" };
}

/** The config file sits beside web, so it must be a regular file there, never a link. */
function configProblems(web) {
  const path = join(web, "playwright.config.ts");
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile())
      return ["playwright.config.ts: not a regular file"];
    if (realpathSync.native(path) !== path)
      return ["playwright.config.ts: does not resolve to its own path"];
  } catch (error) {
    return [
      `playwright.config.ts: cannot inspect: ${error.code ?? error.message}`,
    ];
  }
  return [];
}

/**
 * Walks web/browser and checks the inventory both ways. Each .ts file and the named declarations
 * must be inputs of the browser program when its inputs are known, and each tooling script must
 * be under an ESLint configuration, so an ignore entry cannot drop it from the lint unseen.
 */
export async function browserTreeProblems(
  web,
  { readdir, inputs, inventory = browserInventory } = {},
) {
  const problems = configProblems(web);
  let tree;
  try {
    tree = admitTree(join(web, "browser"), {
      ...(readdir ? { readdir } : {}),
      name: "browser",
      classify: (name, dir, root) =>
        classifyBrowserEntry(shown(root, join(dir, name)), inventory),
    });
  } catch (error) {
    problems.push(`browser tree discovery failed: ${error.message}`);
    return problems;
  }
  for (const { path, reason } of tree.rejected)
    problems.push(`browser/${path}: ${reason}`);
  const at = (f) => shown(tree.root, f.path);
  const of = (kind) => tree.admitted.filter((f) => f.kind === kind);
  for (const kind of ["tooling", "declarations", "assets"]) {
    const present = new Set(tree.admitted.map(at));
    for (const name of inventory[kind])
      if (!present.has(name))
        problems.push(`browser/${name}: listed but missing`);
  }
  if (inputs) {
    const typed = [
      ...of("ts").map((f) => f.path),
      ...of("declaration").map((f) => f.path),
      join(web, "playwright.config.ts"),
    ];
    for (const path of typed)
      if (!inputs.has(path))
        problems.push(
          `${shown(web, path)}: not an input of the browser program`,
        );
  }
  problems.push(
    ...(await eslintCoverage(
      web,
      of("tooling").map((f) => f.path),
      {},
    )),
  );
  return problems;
}
