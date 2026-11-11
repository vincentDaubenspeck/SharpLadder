import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { browserTreeProblems } from "./browser-tree.js";
import { eslintCoverage, stylelintCoverage } from "./coverage.js";
import { generatedProblems } from "./generated.js";
import { programProblems } from "./program.js";
import { vitestSetupProblems } from "./vitest-setup.js";
import { admitTree } from "./walk.js";

const scriptKinds = new Set(["ts", "tsx"]);
const styleKinds = new Set(["css", "css-module"]);

export async function sourceTreeProblems(webDir, { readdir } = {}) {
  const web = realpathSync.native(webDir);
  const problems = [];
  let tree;
  try {
    tree = admitTree(join(web, "src"), readdir ? { readdir } : {});
  } catch (error) {
    problems.push(`source tree discovery failed: ${error.message}`);
  }
  if (tree) {
    for (const { path, reason } of tree.rejected)
      problems.push(`src/${path}: ${reason}`);
    // A rejected link could make Stylelint's recursive discovery leave src, so coverage waits for a clean tree.
    if (tree.rejected.length === 0) {
      const of = (kinds) =>
        tree.admitted.filter((f) => kinds.has(f.kind)).map((f) => f.path);
      problems.push(...(await eslintCoverage(web, of(scriptKinds))));
      problems.push(...stylelintCoverage(web, tree.root, of(styleKinds)));
      problems.push(...generatedProblems(tree.root, tree.admitted));
    }
  }
  problems.push(...vitestSetupProblems(web));
  const programs = programProblems(web, undefined, readdir ? { readdir } : {});
  problems.push(...programs.problems);
  for (const { files, parser } of programs.linted)
    problems.push(...(await eslintCoverage(web, files, parser)));
  const browser = programs.linted.find(
    (p) => p.tsconfig === "tsconfig.browser.json",
  );
  problems.push(
    ...(await browserTreeProblems(web, {
      ...(readdir ? { readdir } : {}),
      ...(browser ? { inputs: browser.inputs } : {}),
    })),
  );
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = await sourceTreeProblems(join(import.meta.dirname, ".."));
  for (const line of problems) console.log(line);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
