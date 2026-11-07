import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eslintCoverage, stylelintCoverage } from "./coverage.js";
import { programInputs, tsconfigShapeProblems } from "./program.js";
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
    }
  }
  const tsconfig = join(web, "tsconfig.json");
  problems.push(
    ...tsconfigShapeProblems(tsconfig),
    ...programInputs(web, { tsconfig }).problems,
  );
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = await sourceTreeProblems(join(import.meta.dirname, ".."));
  for (const line of problems) console.log(line);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
