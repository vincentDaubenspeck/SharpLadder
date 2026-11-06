// The C# stages: build, tests, suppression reasons and the NuGet vulnerability scan.
// Each needs a working .NET config; when that failed they report so instead of running.
// Usage: node tools/checks/csharp.mjs [repository root] [--vulnerabilities-only]
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dotnetChecks } from "./dotnet.mjs";
import { anyFailed, ciEnv, dotnet, exec, report } from "./lib.mjs";

const solution = "SharpLadder.sln";
const policyDll = "tools/SharpLadder.Policy/bin/Debug/net10.0/SharpLadder.Policy.dll";
// The documented severities; any other value fails rather than being read as harmless.
const severities = new Set(["Low", "Moderate", "High", "Critical"]);

// The tool prints its own problem lines and a final PASS or FAIL line.
function toolProblems(r, name) {
  const lines = r.out.split(/\r?\n/).filter((l) => l.trim() !== "");
  const last = lines.pop() ?? "";
  if (r.code === 0 && last === `PASS ${name}`) return [];
  const problems = lines.map((l) => l.replace(/^ {2}/, ""));
  return problems.length > 0 ? problems : [last || `exit ${String(r.code)}`];
}

const samePath = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

// Reads the JSON report of `dotnet list package --vulnerable`; anything unexpected fails.
// A clean project carries no frameworks entry, so missing audit data shows as no sources
// or as a reported problem.
export function vulnerabilityProblems(code, out, projects) {
  if (code !== 0) return [`dotnet list package exited ${String(code)}`, out];
  let data;
  try {
    data = JSON.parse(out);
  } catch (err) {
    return [`vulnerability report is not JSON: ${err.message}`];
  }
  if (data?.version !== 1 || !Array.isArray(data.projects)) {
    return ["vulnerability report lacks version 1 and a projects list"];
  }
  if (!Array.isArray(data.sources) || data.sources.length === 0) {
    return ["vulnerability report names no package source; no audit data"];
  }
  // A shape the reader does not know could hide an advisory, so every level is checked.
  const shape = [];
  const isObject = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
  const list = (owner, key, path) => {
    const value = owner[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      shape.push(`${path}.${key} is not an array`);
      return [];
    }
    return value.flatMap((item, i) => {
      if (isObject(item)) return [[item, `${path}.${key}[${String(i)}]`]];
      shape.push(`${path}.${key}[${String(i)}] is not an object`);
      return [];
    });
  };
  const text = (owner, key, path) => {
    if (typeof owner[key] === "string") return true;
    shape.push(`${path}.${key} is not a string`);
    return false;
  };
  const problems = list(data, "problems", "$").map(([p]) => `report problem: ${p.text ?? JSON.stringify(p)}`);
  const reported = list(data, "projects", "$");
  for (const [project, at] of reported) text(project, "path", at);
  for (const want of projects) {
    if (!reported.some(([p]) => typeof p.path === "string" && samePath(resolve(p.path), resolve(want)))) {
      problems.push(`${want}: missing from the vulnerability report`);
    }
  }
  for (const [project, at] of reported) {
    for (const [p] of list(project, "problems", at)) problems.push(`${project.path}: ${p.text ?? JSON.stringify(p)}`);
    for (const [fw, fwAt] of list(project, "frameworks", at)) {
      text(fw, "framework", fwAt);
      const packages = [...list(fw, "topLevelPackages", fwAt), ...list(fw, "transitivePackages", fwAt)];
      for (const [pkg, pkgAt] of packages) {
        for (const [v, vAt] of list(pkg, "vulnerabilities", pkgAt)) {
          const complete = [text(v, "severity", vAt), text(v, "advisoryurl", vAt)].every(Boolean);
          if (!complete) continue;
          if (!severities.has(v.severity)) {
            shape.push(`${vAt}.severity ${JSON.stringify(v.severity)} is not one of ${[...severities].join(", ")}`);
          } else if (v.severity !== "Low") {
            problems.push(
              `${project.path} ${fw.framework}: ${pkg.id} ${pkg.resolvedVersion} ${v.severity} ${v.advisoryurl}`,
            );
          }
        }
      }
    }
  }
  return [...shape.map((s) => `vulnerability report: ${s}`), ...problems];
}

// Locked restore as CI runs it, so a lock file that does not match fails here.
export const restoreSolution = (root) => exec(dotnet, ["restore", solution, "-nologo"], { cwd: root, env: ciEnv });

export function nugetVulnerabilities(root) {
  const run = (args) => exec(dotnet, args, { cwd: root, env: ciEnv });
  const list = exec(dotnet, ["sln", solution, "list"], { cwd: root });
  if (list.code !== 0) return [`dotnet sln list failed`, list.out];
  const projects = list.out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /\.csproj$/i.test(l))
    .map((l) => resolve(root, l));
  if (projects.length === 0) return [`${solution} lists no projects`];
  const restore = restoreSolution(root);
  if (restore.code !== 0) return ["locked restore failed", restore.out];
  const scan = run([
    "list",
    solution,
    "package",
    "--vulnerable",
    "--include-transitive",
    "--format",
    "json",
    "--output-version",
    "1",
    "--no-restore",
  ]);
  return vulnerabilityProblems(scan.code, scan.out, projects);
}

export function csharpChecks(root, configOk) {
  const config = configOk ? [] : ["needs .NET config (see above)"];
  const build = config.length > 0 ? config : runProblems(exec(dotnet, ["build", solution, "-nologo"], { cwd: root }));
  report(".NET build", build);
  // Tests and the suppression check run the build output, so a failed build fails them too.
  const built = config.length > 0 ? config : build.length > 0 ? ["needs .NET build (see above)"] : [];
  const testArgs = ["test", "--solution", solution, "--no-build"];
  report(".NET tests", built.length > 0 ? built : runProblems(exec(dotnet, testArgs, { cwd: root })));
  const name = "C# suppression reasons";
  report(name, built.length > 0 ? built : toolProblems(exec(dotnet, [policyDll], { cwd: root }), name));
  report("nuget vulnerabilities", config.length > 0 ? config : nugetVulnerabilities(root));
}

const runProblems = (r) => (r.code === 0 ? [] : [r.out]);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? process.cwd();
  if (process.argv[3] === "--vulnerabilities-only") report("nuget vulnerabilities", nugetVulnerabilities(root));
  else csharpChecks(root, dotnetChecks(root));
  process.exitCode = anyFailed() ? 1 : 0;
}
