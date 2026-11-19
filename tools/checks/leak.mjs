// The leak stage: tools/SharpLadder.CodeCheck scans the build output for reference solutions, wrong
// solutions and their marker lines, once with the content and its reference root and once with the
// content fixture pair, whose compiled output web/compiled holds. web/dist comes from the production
// build stage, which runs first. A finding fails the stage, and so does a scan that cannot run.
// Usage: node tools/checks/leak.mjs [repository root]   (builds the checker first)
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkerDll } from "./code-check.mjs";
import { dotnetChecks } from "./dotnet.mjs";
import { anyFailed, dotnet, exec, report, toolProblems } from "./lib.mjs";

const stage = "leak";
const project = "tools/SharpLadder.CodeCheck/SharpLadder.CodeCheck.csproj";
const schema = "content/schema";
export const pairs = [
  ["content", "reference"],
  ["tools/SharpLadder.Content.Tests/fixtures/content", "tools/SharpLadder.Content.Tests/fixtures/reference"],
];
export const targets = ["web/dist", "web/compiled"];

// One scan with one content pair; every path is relative to root, or absolute.
export function leakRun(root, [content, reference], scanned = targets) {
  // The checker accepts full paths only.
  const paths = [schema, content, reference, ...scanned].map((p) => resolve(root, p));
  return exec(dotnet, [join(root, checkerDll), "leak", ...paths], { cwd: root });
}

// The checker's own lines from both scans are the problems.
export function leakProblems(root, scanned = targets) {
  return pairs.flatMap((pair) => toolProblems(leakRun(root, pair, scanned), stage));
}

// built is the .NET build state from csharpChecks: empty when the build passed.
export function leakChecks(root, built) {
  report(stage, built.length > 0 ? built : leakProblems(root));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? process.cwd();
  let built = ["needs .NET config (see above)"];
  if (dotnetChecks(root)) {
    const build = exec(dotnet, ["build", project, "-nologo"], { cwd: root });
    built = build.code === 0 ? [] : ["code checker build failed", build.out];
  }
  leakChecks(root, built);
  process.exitCode = anyFailed() ? 1 : 0;
}
