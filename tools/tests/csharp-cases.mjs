// C# cases for both test suites: the suppression check on the fixtures from fixtures.mjs, the
// nuget vulnerabilities stage, and every C# stage failing when no SDK is found.
// Usage: node tools/tests/csharp-cases.mjs <empty work directory>
// Needs the pinned .NET SDK and nuget.org.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { vulnerabilityProblems } from "../checks/csharp.mjs";
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
const tracked = exec(dotnet, [dll], { cwd: src });
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
  ["low advisory passes", 0, withPackages("topLevelPackages", "Low"), null],
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
for (const name of [".NET build", ".NET tests", stage, "nuget vulnerabilities"]) {
  const at = out.indexOf(`FAIL ${name}`);
  check(`no SDK: ${name} fails`, at > 0 && out[at - 1] === "  needs .NET config (see above)", none.out);
}

process.exitCode = failed > 0 ? 1 : 0;
