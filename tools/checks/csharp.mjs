// The C# stages: build, tests, suppression reasons, the NuGet vulnerability scan and the
// NuGet licence allowlist. Each needs a working .NET config; when that failed they report so
// instead of running.
// Usage: node tools/checks/csharp.mjs [repository root] [--vulnerabilities-only | --licences-only]
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dotnetChecks } from "./dotnet.mjs";
import { anyFailed, ciEnv, dotnet, exec, pins, report, toolProblems } from "./lib.mjs";

const solution = "SharpLadder.sln";
const allowedFile = "tools/nuget-allowed-licenses.json";
const exceptionsFile = "tools/nuget-license-exceptions.json";
const policyDll = "tools/SharpLadder.Policy/bin/Debug/net10.0/SharpLadder.Policy.dll";
// The documented severities; any other value fails rather than being read as harmless.
const severities = new Set(["Low", "Moderate", "High", "Critical"]);

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
          } else {
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

// Exact reported versions avoid a second NuGet grammar and require review after upgrades.
const nonBlank = (v) => typeof v === "string" && v.trim() !== "";
const exceptionFields = ["package", "version", "license", "reason", "addedOn"];
const oneLine = (v) => typeof v === "string" && v.trim() !== "" && !/[\r\n]/.test(v);
// Date.parse accepts out-of-range days such as 02-30, so the round trip must give the same text.
const realDay = (d) =>
  typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;

// Reads the JSON report of nuget-license against the allowlist and the reasoned exceptions.
// The tool's verdict and a plain allowlist lookup must both accept a licence, so a licence
// expression the tool reads leniently still needs an exception. Build-only packages get no
// pass: an exception's reason is where "build-only, never shipped" would be recorded.
export function licenceProblems(code, out, allowed, exceptions) {
  if (code === null) return [`nuget-license did not start: ${out}`];
  if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every((l) => oneLine(l))) {
    return ["allowed licences must be a non-empty array of licence identifiers"];
  }
  if (!Array.isArray(exceptions)) return ["licence exceptions must be an array"];
  let data;
  try {
    data = JSON.parse(out);
  } catch (err) {
    return [`nuget-license exited ${String(code)}; report is not JSON: ${err.message}`, out];
  }
  if (!Array.isArray(data)) return ["licence report is not an array of packages"];
  const problems = [];
  const packages = [];
  data.forEach((p, i) => {
    if (
      typeof p !== "object" ||
      p === null ||
      !nonBlank(p.PackageId) ||
      !nonBlank(p.PackageVersion)
    ) {
      problems.push(`licence report: [${String(i)}] lacks a non-blank PackageId and PackageVersion`);
    } else if (p.ValidationErrors !== undefined && !Array.isArray(p.ValidationErrors)) {
      problems.push(`licence report: ${p.PackageId} ${p.PackageVersion} ValidationErrors is not an array`);
    } else packages.push(p);
  });
  const flagged = packages.filter((p) => (p.ValidationErrors?.length ?? 0) > 0);
  if (code !== 0 && flagged.length === 0) problems.push(`nuget-license exited ${String(code)} without a validation error`);
  const records = [];
  exceptions.forEach((e, i) => {
    const at = `licence exception [${String(i)}]`;
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    const before = problems.length;
    for (const key of Object.keys(e)) if (!exceptionFields.includes(key)) problems.push(`${at}: unknown field "${key}"`);
    for (const key of ["package", "license", "reason"]) {
      if (!oneLine(e[key])) problems.push(`${at}: "${key}" must be one non-blank line`);
    }
    if (!oneLine(e.version)) problems.push(`${at}: "version" must be one non-blank line`);
    else if (/[[(,*]/.test(e.version)) problems.push(`${at}: "version" must be an exact version, not a range or wildcard`);
    if (!realDay(e.addedOn)) problems.push(`${at}: "addedOn" must be a real YYYY-MM-DD date`);
    if (problems.length === before) records.push({ ...e, at, used: false });
  });
  for (const p of packages) {
    const licence = typeof p.License === "string" ? p.License : null;
    const ok = (p.ValidationErrors?.length ?? 0) === 0 && licence !== null && allowed.includes(licence);
    if (ok) continue;
    const cover = records.filter(
      (r) =>
        r.package.toLowerCase() === p.PackageId.toLowerCase() &&
        r.version.trim() === p.PackageVersion.trim() &&
        r.license === licence,
    );
    for (const r of cover) r.used = true;
    if (cover.length === 0) {
      problems.push(`${p.PackageId} ${p.PackageVersion}: licence ${JSON.stringify(licence)} is not allowed and no exception covers it`);
    }
  }
  for (const r of records) {
    if (!r.used) problems.push(`${r.at}: ${r.package} ${r.version} ${r.license} matches no disallowed package in the report`);
  }
  return problems;
}

// dotnet tool restore bypasses the lock files, so the restored package is held to a pinned digest.
export function toolPackageProblems(packagesDir, pin) {
  const id = "nuget-license";
  const dir = join(packagesDir, id, pin.version);
  const nupkg = join(dir, `${id}.${pin.version}.nupkg`);
  if (!existsSync(nupkg)) return [`${nupkg} not found after dotnet tool restore`];
  const hex = createHash("sha512").update(readFileSync(nupkg)).digest("hex");
  return hex === pin.sha512 ? [] : [`${id} ${pin.version}: SHA-512 mismatch (expected ${pin.sha512}, got ${hex})`];
}

const readJson = (root, file) => {
  try {
    return { value: JSON.parse(readFileSync(join(root, file), "utf8")) };
  } catch (err) {
    return { problem: `${file}: ${err.message}` };
  }
};

export function nugetLicences(root) {
  const pin = pins["nuget-license"];
  if (typeof pin?.version !== "string" || !/^[0-9a-f]{128}$/.test(pin.sha512 ?? "")) {
    return ['tools/tool-pins.json: "nuget-license" needs a version and a SHA-512 digest'];
  }
  const manifest = readJson(root, ".config/dotnet-tools.json");
  if (manifest.problem) return [manifest.problem];
  const listed = manifest.value?.tools?.["nuget-license"]?.version;
  if (listed !== pin.version) {
    return [`.config/dotnet-tools.json nuget-license ${String(listed)} differs from tools/tool-pins.json ${pin.version}`];
  }
  const tool = exec(dotnet, ["tool", "restore"], { cwd: root, env: ciEnv });
  if (tool.code !== 0) return ["dotnet tool restore failed", tool.out];
  const locals = exec(dotnet, ["nuget", "locals", "global-packages", "--list"], { cwd: root, env: ciEnv });
  const packagesDir = /^global-packages: (.+)$/m.exec(locals.out)?.[1]?.trim();
  if (locals.code !== 0 || !packagesDir) return ["global packages folder not found", locals.out];
  const tampered = toolPackageProblems(packagesDir, pin);
  if (tampered.length > 0) return tampered;
  const restore = restoreSolution(root);
  if (restore.code !== 0) return ["locked restore failed", restore.out];
  const allowed = readJson(root, allowedFile);
  const exceptions = readJson(root, exceptionsFile);
  const unread = [allowed.problem, exceptions.problem].filter(Boolean);
  if (unread.length > 0) return unread;
  const args = ["tool", "run", "nuget-license", "-i", solution, "-t", "-a", allowedFile, "-o", "Json"];
  const scan = exec(dotnet, args, { cwd: root, env: ciEnv });
  return licenceProblems(scan.code, scan.out, allowed.value, exceptions.value);
}

// Returns the build state the content stage needs: empty when the build passed.
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
  report("nuget licences", config.length > 0 ? config : nugetLicences(root));
  return built;
}

const runProblems = (r) => (r.code === 0 ? [] : [r.out]);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? process.cwd();
  if (process.argv[3] === "--vulnerabilities-only") report("nuget vulnerabilities", nugetVulnerabilities(root));
  else if (process.argv[3] === "--licences-only") report("nuget licences", nugetLicences(root));
  else csharpChecks(root, dotnetChecks(root));
  process.exitCode = anyFailed() ? 1 : 0;
}
