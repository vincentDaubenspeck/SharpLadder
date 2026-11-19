// The code check stage: tools/SharpLadder.CodeCheck compiles and runs the code blocks of the
// content group by group, so an example that does not compile, fails its check or throws the
// wrong exception fails here, and each practice suite runs against its starter, its reference and
// its wrong solutions. It reads the content source itself, so it needs neither the compiled output
// nor the content stage's result.
// Usage: node tools/checks/code-check.mjs [repository root]   (builds the checker first)
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dotnetChecks } from "./dotnet.mjs";
import { anyFailed, dotnet, exec, report, toolProblems } from "./lib.mjs";

const stage = "code check";
const project = "tools/SharpLadder.CodeCheck/SharpLadder.CodeCheck.csproj";
export const checkerDll = "tools/SharpLadder.CodeCheck/bin/Debug/net10.0/SharpLadder.CodeCheck.dll";
const schema = "content/schema";
const content = "content";
const solutions = "reference";

// Runs the checker over input and its reference root (each relative to root, or absolute); its own
// lines are the problems.
export function codeCheckProblems(root, { input = content, reference = solutions } = {}) {
  // The checker accepts full paths only.
  const r = exec(dotnet, [join(root, checkerDll), resolve(root, schema), resolve(root, input), resolve(root, reference)], { cwd: root });
  return toolProblems(r, stage);
}

// built is the .NET build state from csharpChecks: empty when the build passed.
export function codeCheckChecks(root, built) {
  report(stage, built.length > 0 ? built : codeCheckProblems(root));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? process.cwd();
  let built = ["needs .NET config (see above)"];
  if (dotnetChecks(root)) {
    const build = exec(dotnet, ["build", project, "-nologo"], { cwd: root });
    built = build.code === 0 ? [] : ["code checker build failed", build.out];
  }
  codeCheckChecks(root, built);
  process.exitCode = anyFailed() ? 1 : 0;
}
