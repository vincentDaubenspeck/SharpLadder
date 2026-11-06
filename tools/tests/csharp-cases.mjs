// C# cases for both test suites: the suppression check on the fixtures from fixtures.mjs, the
// nuget vulnerabilities and nuget licences stages, and every C# stage failing when no SDK is found.
// Usage: node tools/tests/csharp-cases.mjs <empty work directory>
// Needs the pinned .NET SDK and nuget.org.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { licenceProblems, restoreSolution, toolPackageProblems, vulnerabilityProblems } from "../checks/csharp.mjs";
import { dotnet, env, exec, localEnv } from "../checks/lib.mjs";

const src = join(import.meta.dirname, "..", "..");
const work = resolve(process.argv[2] ?? ".");
const node = process.execPath;
const csharp = join(src, "tools", "checks", "csharp.mjs");
const stage = "C# suppression reasons";

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (ok) return;
  failed++;
  for (const line of detail.split(/\r?\n/).filter((l) => l.trim() !== "")) console.log(`  ${line}`);
}
const lines = (out) => out.split(/\r?\n/);

// Suppression check on each C# fixture, and on the tracked files.
const policyProject = join(src, "tools/SharpLadder.Policy/SharpLadder.Policy.csproj");
const build = exec(dotnet, ["build", policyProject, "-nologo"], { cwd: src });
check("policy tool builds", build.code === 0, build.out);
const dll = join(src, "tools/SharpLadder.Policy/bin/Debug/net10.0/SharpLadder.Policy.dll");
const fx = join(work, "fx");
const manifest = exec(node, [join(src, "tools/tests/fixtures.mjs"), fx], { cwd: src });
check("fixtures written", manifest.code === 0, manifest.out);
// One run over every case project; each case passes only when no problem names its file.
const fxRestore = exec(dotnet, ["restore", "Fixtures.slnx", "-nologo"], { cwd: join(fx, "cs"), env: localEnv });
check("C# fixture projects restore", fxRestore.code === 0, fxRestore.out);
const fxRun = exec(dotnet, [dll, "Fixtures.slnx"], { cwd: join(fx, "cs") });
const fxOut = lines(fxRun.out);
const rows = lines(manifest.out).filter((l) => l.startsWith("cs\t")).map((l) => l.split("\t"));
for (const [, want, file, label, problem] of rows) {
  const mine = fxOut.filter((l) => l.startsWith(`  ${file}:`));
  const ok = want === "pass" ? mine.length === 0 : mine.some((l) => l.includes(`: ${problem}`));
  check(`cs ${want}: ${label}`, ok, fxRun.out);
}
const failFiles = rows.filter((r) => r[1] === "fail").map((r) => `  ${r[2]}:`);
check(
  "cs fixture run fails and names only failing cases",
  fxRun.code !== 0 &&
    fxOut.includes(`FAIL ${stage}`) &&
    fxOut.filter((l) => l.startsWith("  ")).every((l) => failFiles.some((f) => l.startsWith(f))),
  fxRun.out,
);
const loadFail = join(work, "load-fail");
mkdirSync(loadFail);
copyFileSync(join(src, "global.json"), join(loadFail, "global.json"));
writeFileSync(join(loadFail, "Broken.slnx"), `<Solution>\n  <Project Path="Missing/Missing.csproj" />\n</Solution>\n`);
const broken = exec(dotnet, [dll, "Broken.slnx"], { cwd: loadFail });
check(
  "cs fail: project that does not load",
  broken.code !== 0 && broken.out.includes("project load failed: ") && lines(broken.out).includes(`FAIL ${stage}`),
  broken.out,
);
// A project's restore state, in a solution whose tracked files the tool must account for.
const rs = join(work, "restore-state");
mkdirSync(join(rs, "Fx"), { recursive: true });
for (const f of ["global.json", "nuget.config"]) copyFileSync(join(src, f), join(rs, f));
writeFileSync(
  join(rs, "Fx", "SharpLadder.Fx.csproj"),
  `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n` +
    `  </PropertyGroup>\n</Project>\n`,
);
writeFileSync(join(rs, "Fx", "Good.cs"), "namespace Fx;\n\ninternal static class Good\n{\n}\n");
const rsSetup = [
  exec("git", ["init", "-q"], { cwd: rs }),
  exec(dotnet, ["new", "sln", "-n", "SharpLadder", "--format", "sln"], { cwd: rs, env: localEnv }),
  exec(dotnet, ["sln", "SharpLadder.sln", "add", "Fx/SharpLadder.Fx.csproj"], { cwd: rs, env: localEnv }),
  exec("git", ["add", "-A"], { cwd: rs }),
];
check("restore-state fixture created", rsSetup.every((r) => r.code === 0), rsSetup.map((r) => r.out).join("\n"));
const noAssets = exec(dotnet, [dll], { cwd: rs });
check(
  "cs fail: project that is not restored",
  noAssets.code !== 0 &&
    lines(noAssets.out).includes("  Fx/SharpLadder.Fx.csproj: not restored; run dotnet restore") &&
    lines(noAssets.out).includes(`FAIL ${stage}`) &&
    !/does not compile|in no project/.test(noAssets.out),
  noAssets.out,
);
const rsRestore = exec(dotnet, ["restore", "SharpLadder.sln", "-nologo"], { cwd: rs, env: localEnv });
check("restore-state fixture restores", rsRestore.code === 0, rsRestore.out);
const restored = exec(dotnet, [dll], { cwd: rs });
check("cs pass: restored project", restored.code === 0 && lines(restored.out).includes(`PASS ${stage}`), restored.out);
writeFileSync(join(rs, "Fx", "Broken.cs"), "namespace Fx;\n\ninternal static class Broken\n{\n    private static Missing? unused;\n}\n");
const addBroken = exec("git", ["add", "Fx/Broken.cs"], { cwd: rs });
check("restore-state compile failure added", addBroken.code === 0, addBroken.out);
const noCompile = exec(dotnet, [dll], { cwd: rs });
check(
  "cs fail: restored project that does not compile",
  noCompile.code !== 0 &&
    /^ {2}Fx\/Broken\.cs:5: does not compile: CS0246 /m.test(noCompile.out) &&
    !noCompile.out.includes("not restored"),
  noCompile.out,
);
// The tool only reads a prepared tree, so the solution is restored first, as the check's build does.
const solutionRestore = restoreSolution(src);
check("solution restores", solutionRestore.code === 0, solutionRestore.out);
const tracked =
  solutionRestore.code === 0 ? exec(dotnet, [dll], { cwd: src }) : { code: null, out: "needs the solution restore (see above)" };
check("cs pass: tracked C# files", tracked.code === 0 && lines(tracked.out).includes(`PASS ${stage}`), tracked.out);

// The report reader, on reports the scan could produce.
const project = resolve(work, "p", "P.csproj");
const pkg = (severity) => ({
  id: "Fx.Package",
  resolvedVersion: "1.0.0",
  vulnerabilities: [{ severity, advisoryurl: "https://example.invalid/advisory" }],
});
const reportOf = (fields) =>
  JSON.stringify({ version: 1, sources: ["https://api.nuget.org/v3/index.json"], projects: [{ path: project }], ...fields });
const withPackages = (key, severity) =>
  reportOf({ projects: [{ path: project, frameworks: [{ framework: "net10.0", [key]: [pkg(severity)] }] }] });
const withVulnerabilities = (vulnerabilities) =>
  reportOf({
    projects: [
      {
        path: project,
        frameworks: [{ framework: "net10.0", topLevelPackages: [{ ...pkg("Low"), vulnerabilities }] }],
      },
    ],
  });
for (const [label, code, out, want] of [
  ["clean report passes", 0, reportOf({}), null],
  ["low advisory fails", 0, withPackages("topLevelPackages", "Low"), "Fx.Package 1.0.0 Low"],
  ["moderate top-level advisory fails", 0, withPackages("topLevelPackages", "Moderate"), "Fx.Package 1.0.0 Moderate"],
  ["high transitive advisory fails", 0, withPackages("transitivePackages", "High"), "Fx.Package 1.0.0 High"],
  ["critical advisory fails", 0, withPackages("topLevelPackages", "Critical"), "Fx.Package 1.0.0 Critical"],
  ["command failure fails", 1, "error: no audit", "dotnet list package exited 1"],
  ["malformed JSON fails", 0, "{ not json", "vulnerability report is not JSON"],
  ["wrong shape fails", 0, JSON.stringify({ version: 2, projects: [] }), "lacks version 1"],
  ["missing project fails", 0, reportOf({ projects: [] }), "missing from the vulnerability report"],
  ["no package source fails", 0, reportOf({ sources: [] }), "names no package source"],
  ["reported problem fails", 0, reportOf({ problems: [{ level: "error", text: "source unavailable" }] }), "source unavailable"],
  [
    "project problem fails",
    0,
    reportOf({ projects: [{ path: project, problems: [{ text: "no audit data" }] }] }),
    "no audit data",
  ],
  [
    "vulnerability without a severity fails",
    0,
    withVulnerabilities([{ advisoryurl: "https://example.invalid/advisory" }]),
    "vulnerabilities[0].severity is not a string",
  ],
  ["unknown severity fails", 0, withPackages("topLevelPackages", "Severe"), '.severity "Severe" is not one of'],
  ["lower-case severity fails", 0, withPackages("topLevelPackages", "high"), '.severity "high" is not one of'],
  ["vulnerabilities as a string fails", 0, withVulnerabilities("High"), "vulnerabilities is not an array"],
  ["vulnerability that is not an object fails", 0, withVulnerabilities(["High"]), "vulnerabilities[0] is not an object"],
  [
    "vulnerability without an advisory URL fails",
    0,
    withVulnerabilities([{ severity: "High" }]),
    "vulnerabilities[0].advisoryurl is not a string",
  ],
  ["projects as an object fails", 0, reportOf({ projects: { path: project } }), "lacks version 1"],
  ["project that is not an object fails", 0, reportOf({ projects: [project] }), "$.projects[0] is not an object"],
  ["project without a path fails", 0, reportOf({ projects: [{}] }), "$.projects[0].path is not a string"],
  [
    "frameworks as an object fails",
    0,
    reportOf({ projects: [{ path: project, frameworks: { framework: "net10.0" } }] }),
    "$.projects[0].frameworks is not an array",
  ],
  [
    "framework without a name fails",
    0,
    reportOf({ projects: [{ path: project, frameworks: [{ topLevelPackages: [] }] }] }),
    "frameworks[0].framework is not a string",
  ],
  [
    "top-level packages as an object fails",
    0,
    reportOf({ projects: [{ path: project, frameworks: [{ framework: "net10.0", topLevelPackages: pkg("High") }] }] }),
    "frameworks[0].topLevelPackages is not an array",
  ],
  [
    "transitive package that is not an object fails",
    0,
    reportOf({ projects: [{ path: project, frameworks: [{ framework: "net10.0", transitivePackages: [null] }] }] }),
    "frameworks[0].transitivePackages[0] is not an object",
  ],
  ["report problems as a string fails", 0, reportOf({ problems: "source unavailable" }), "$.problems is not an array"],
]) {
  const problems = vulnerabilityProblems(code, out, [project]);
  const ok = want === null ? problems.length === 0 : problems.some((p) => p.includes(want));
  check(`nuget report: ${label}`, ok, problems.join("\n"));
}

// The licence report reader, on reports nuget-license could produce.
const allowed = ["MIT", "Apache-2.0"];
const entry = (id, license, errors) => ({
  PackageId: id,
  PackageVersion: "1.2.0",
  License: license,
  ...(errors ? { ValidationErrors: [{ Error: `License "${license}" not found`, Context: project }] } : {}),
});
const mixed = JSON.stringify([entry("Fx.Mit", "MIT"), entry("Fx.Apache", "Apache-2.0"), entry("Fx.Gpl", "GPL-3.0", true)]);
const exception = (fields) => ({
  package: "Fx.Gpl",
  version: "1.2.0",
  license: "GPL-3.0",
  reason: "Build-only analyzer, never shipped.",
  addedOn: "2026-11-06",
  ...fields,
});
const notRange = '"version" must be an exact version, not a range or wildcard';
const notCovered = 'Fx.Gpl 1.2.0: licence "GPL-3.0" is not allowed and no exception covers it';
const badIdentity = "lacks a non-blank PackageId and PackageVersion";
const identityCases = [
  ["blank id", { PackageId: "" }],
  ["whitespace id", { PackageId: "  " }],
  ["whitespace version", { PackageVersion: "  " }],
  ["missing version", { PackageVersion: undefined }],
].flatMap(([what, fields]) => [
  [`allowed package with a ${what} fails`, 0, JSON.stringify([{ ...entry("Fx.Mit", "MIT"), ...fields }]), [], badIdentity],
  [
    `disallowed package with a ${what} fails`,
    1,
    JSON.stringify([{ ...entry("Fx.Gpl", "GPL-3.0", true), ...fields }]),
    [exception({})],
    badIdentity,
  ],
]);
for (const [label, code, out, exceptions, want] of [
  ["all allowed passes", 0, JSON.stringify([entry("Fx.Mit", "MIT"), entry("Fx.Apache", "Apache-2.0")]), [], null],
  ["disallowed licence without an exception fails", 1, mixed, [], notCovered],
  ["disallowed licence with a reasoned exception passes", 1, mixed, [exception({})], null],
  ["exception with the exact reported version passes", 1, mixed, [exception({ version: "1.2.0" })], null],
  ["exception for a patch-bumped version fails", 1, mixed, [exception({ version: "1.2.1" })], notCovered],
  ["exception with an interval version fails", 1, mixed, [exception({ version: "[1.0.0,2.0.0)" })], notRange],
  ["exception with a wildcard version fails", 1, mixed, [exception({ version: "1.0.*" })], notRange],
  ["exception version differing only by whitespace passes", 1, mixed, [exception({ version: " 1.2.0 " })], null],
  [
    "exception version differing only by case fails",
    1,
    JSON.stringify([{ ...entry("Fx.Gpl", "GPL-3.0", true), PackageVersion: "1.2.0-beta" }]),
    [exception({ version: "1.2.0-BETA" })],
    'Fx.Gpl 1.2.0-beta: licence "GPL-3.0" is not allowed and no exception covers it',
  ],
  [
    "exception that matches no package fails",
    1,
    mixed,
    [exception({}), exception({ package: "Fx.Absent" })],
    "Fx.Absent 1.2.0 GPL-3.0 matches no disallowed package",
  ],
  ["exception for another licence fails", 1, mixed, [exception({ license: "LGPL-3.0" })], notCovered],
  ["exception with an empty reason fails", 1, mixed, [exception({ reason: " " })], '"reason" must be one non-blank line'],
  ["exception without a reason fails", 1, mixed, [exception({ reason: undefined })], '"reason" must be one non-blank line'],
  ["exception with an unknown field fails", 1, mixed, [exception({ note: "x" })], 'unknown field "note"'],
  ["exception with an impossible date fails", 1, mixed, [exception({ addedOn: "2026-02-30" })], "real YYYY-MM-DD date"],
  ["licence outside the allowlist without a tool error fails", 0, JSON.stringify([entry("Fx.Gpl", "GPL-3.0")]), [], notCovered],
  ["package without a licence fails", 0, JSON.stringify([entry("Fx.None")]), [], 'licence null is not allowed'],
  ["tool failure without a validation error fails", 2, JSON.stringify([entry("Fx.Mit", "MIT")]), [], "exited 2 without"],
  ["tool that did not start fails", null, "spawn ENOENT", [], "nuget-license did not start"],
  ["malformed JSON fails", 0, "{ not json", [], "report is not JSON"],
  ["report that is not an array fails", 0, JSON.stringify({ packages: [] }), [], "not an array of packages"],
  ["package without an id fails", 0, JSON.stringify([{ PackageVersion: "1.0.0" }]), [], badIdentity],
  ...identityCases,
]) {
  const problems = licenceProblems(code, out, allowed, exceptions);
  const ok = want === null ? problems.length === 0 : problems.some((p) => p.includes(want));
  check(`nuget licence report: ${label}`, ok, problems.join("\n"));
}
const emptyAllow = licenceProblems(0, "[]", [], []);
check("nuget licence report: empty allowlist fails", emptyAllow.some((p) => p.includes("non-empty array")), emptyAllow.join("\n"));

// The restored tool package against its pinned digest, on a stand-in package folder.
const toolPkgs = join(work, "tool-packages");
mkdirSync(join(toolPkgs, "nuget-license", "9.9.9"), { recursive: true });
const fakePkg = Buffer.from("stand-in package");
writeFileSync(join(toolPkgs, "nuget-license", "9.9.9", "nuget-license.9.9.9.nupkg"), fakePkg);
const fakePin = { version: "9.9.9", sha512: createHash("sha512").update(fakePkg).digest("hex") };
const hashOk = toolPackageProblems(toolPkgs, fakePin);
check("nuget-license package: matching digest passes", hashOk.length === 0, hashOk.join("\n"));
const hashBad = toolPackageProblems(toolPkgs, { ...fakePin, sha512: "0".repeat(128) });
check("nuget-license package: digest mismatch fails", hashBad.some((p) => p.includes("SHA-512 mismatch")), hashBad.join("\n"));
const hashNone = toolPackageProblems(toolPkgs, { ...fakePin, version: "9.9.8" });
check("nuget-license package: missing package fails", hashNone.some((p) => p.includes("not found")), hashNone.join("\n"));
const licences = exec(node, [csharp, src, "--licences-only"], { cwd: src });
check(
  "nuget licences stage passes the repository",
  licences.code === 0 && lines(licences.out).includes("PASS nuget licences"),
  licences.out,
);

// A solution with a known-vulnerable package: restore succeeds and the stage itself fails it.
const vuln = join(work, "vuln");
mkdirSync(join(vuln, "Fx"), { recursive: true });
for (const f of ["global.json", "nuget.config", "Directory.Build.props"]) copyFileSync(join(src, f), join(vuln, f));
writeFileSync(
  join(vuln, "Directory.Packages.props"),
  `<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n` +
    `  </PropertyGroup>\n  <ItemGroup>\n    <PackageVersion Include="Newtonsoft.Json" Version="12.0.3" />\n` +
    `  </ItemGroup>\n</Project>\n`,
);
writeFileSync(
  join(vuln, "Fx", "SharpLadder.Fx.csproj"),
  `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n` +
    `  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="Newtonsoft.Json" />\n  </ItemGroup>\n</Project>\n`,
);
const setup = [
  exec(dotnet, ["new", "sln", "-n", "SharpLadder", "--format", "sln"], { cwd: vuln, env: localEnv }),
  exec(dotnet, ["sln", "SharpLadder.sln", "add", "Fx/SharpLadder.Fx.csproj"], { cwd: vuln, env: localEnv }),
];
check("vulnerable fixture solution created", setup.every((r) => r.code === 0), setup.map((r) => r.out).join("\n"));
// A local restore writes the lock file that the stage's locked restore then requires.
const restore = exec(dotnet, ["restore", "SharpLadder.sln", "-nologo"], { cwd: vuln, env: localEnv });
check(
  "restore of a known-vulnerable package succeeds with NU1903",
  restore.code === 0 && restore.out.includes("NU1903"),
  restore.out,
);
const scan = exec(node, [csharp, vuln, "--vulnerabilities-only"], { cwd: vuln });
const advisory = /^ {2}\S.*SharpLadder\.Fx\.csproj net10\.0: Newtonsoft\.Json 12\.0\.3 High https:\/\/github\.com\/advisories\//m;
check(
  "nuget vulnerabilities stage fails a known-vulnerable package",
  scan.code !== 0 && lines(scan.out).includes("FAIL nuget vulnerabilities") && advisory.test(scan.out),
  scan.out,
);
const baseline = exec(node, [csharp, src, "--vulnerabilities-only"], { cwd: src });
check(
  "nuget vulnerabilities stage passes the repository",
  baseline.code === 0 && lines(baseline.out).includes("PASS nuget vulnerabilities"),
  baseline.out,
);

// With no SDK at all, the config check names the install step and every C# stage fails.
const bare = join(work, "bare");
mkdirSync(join(bare, "tools", "checks"), { recursive: true });
for (const f of ["lib.mjs", "dotnet.mjs", "csharp.mjs"]) {
  copyFileSync(join(src, "tools", "checks", f), join(bare, "tools", "checks", f));
}
copyFileSync(join(src, "tools", "tool-pins.json"), join(bare, "tools", "tool-pins.json"));
writeFileSync(join(bare, "global.json"), readFileSync(join(src, "global.json")));
const empty = join(work, "empty");
mkdirSync(empty);
const noPath = Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== "PATH"));
const none = exec(node, [join(bare, "tools", "checks", "csharp.mjs"), bare], {
  cwd: bare,
  env: { ...noPath, PATH: empty },
});
const out = lines(none.out);
check(
  "no SDK: .NET config names the install step",
  none.code !== 0 &&
    out.includes("  dotnet not found; install the pinned tools with: node tools/install-tools.mjs") &&
    out.includes("FAIL .NET config"),
  none.out,
);
for (const name of [".NET build", ".NET tests", stage, "nuget vulnerabilities", "nuget licences"]) {
  const at = out.indexOf(`FAIL ${name}`);
  check(`no SDK: ${name} fails`, at > 0 && out[at - 1] === "  needs .NET config (see above)", none.out);
}

process.exitCode = failed > 0 ? 1 : 0;
