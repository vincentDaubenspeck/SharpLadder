// Probe build for the .NET configuration: a throwaway project, built against copies of the
// repository's config files, must report exactly the expected diagnostics in each case.
// Usage: node tools/tests/dotnet-probe.mjs <empty work directory>
// Needs nuget.org. The lock file it generates is a test artefact, never a committed lock.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dotnet, env, exec, win } from "../checks/lib.mjs";

const src = join(import.meta.dirname, "..", "..");
const probe = join(resolve(process.argv[2] ?? "."), "probe");
const configFiles = [
  "global.json",
  "Directory.Build.props",
  "Directory.Packages.props",
  ".globalconfig",
  "BannedSymbols.txt",
  ".editorconfig",
];

const analyzers = {
  AsyncFixer: "2.1.0",
  IDisposableAnalyzers: "4.0.8",
  "Meziantou.Analyzer": "3.0.321",
  "Microsoft.CodeAnalysis.BannedApiAnalyzers": "5.6.0",
  "Microsoft.VisualStudio.Threading.Analyzers": "18.12.1",
  "Roslynator.Analyzers": "5.0.1",
  "StyleCop.Analyzers": "1.3.171-beta",
};
// Central package management also lists every global reference as a package version.
const packageVersions = { "xunit.analyzers": "2.2.0", ...analyzers };
const properties = {
  Nullable: "enable",
  TreatWarningsAsErrors: "true",
  CodeAnalysisTreatWarningsAsErrors: "true",
  EnableNETAnalyzers: "true",
  EnforceCodeStyleInBuild: "true",
  AnalysisLevel: "latest-recommended",
  AnalysisLevelSecurity: "latest-all",
  AnalysisLevelPerformance: "latest-all",
  RestorePackagesWithLockFile: "true",
  ManagePackageVersionsCentrally: "true",
  GenerateDocumentationFile: "true",
  PublishDocumentationFile: "false",
};
const restoreAudit = ["NU1901", "NU1902", "NU1903", "NU1904"];
// Diagnostics that mean an analyzer or a config file was not loaded as intended.
const loadErrors = ["CS8032", "CS8033", "CS8034", "CS8784", "CS8785", "CS9057", "AD0001"];

let passed = 0;
let failed = 0;
function check(label, problems, detail = "") {
  if (problems.length === 0) {
    console.log(`PASS dotnet probe: ${label}`);
    passed++;
    return;
  }
  console.log(`FAIL dotnet probe: ${label}`);
  for (const p of problems) console.log(`  ${p}`);
  const lines = detail.split(/\r?\n/).filter((l) => /(error|warning) /.test(l));
  for (const line of [...new Set(lines)].slice(0, 8)) console.log(`    ${line.trim()}`);
  failed++;
}

const localEnv = { ...env };
for (const k of Object.keys(localEnv)) if (k.toUpperCase() === "GITHUB_ACTIONS") delete localEnv[k];
const ciEnv = { ...localEnv, GITHUB_ACTIONS: "true" };
const run = (args, ci) => exec(dotnet, args, { cwd: probe, env: ci ? ciEnv : localEnv });

mkdirSync(probe, { recursive: true });
for (const f of configFiles) copyFileSync(join(src, f), join(probe, f));
writeFileSync(
  join(probe, "nuget.config"),
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<configuration>",
    "  <packageSources>",
    "    <clear />",
    '    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />',
    "  </packageSources>",
    "</configuration>",
    "",
  ].join("\n"),
);
writeFileSync(
  join(probe, "SharpLadder.Probe.csproj"),
  [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "  <PropertyGroup>",
    "    <TargetFramework>net10.0</TargetFramework>",
    "  </PropertyGroup>",
    "</Project>",
    "",
  ].join("\n"),
);
const globalconfig = readFileSync(join(probe, ".globalconfig"), "utf8");

function evaluation(ci) {
  const label = ci ? "evaluation under CI" : "evaluation outside CI";
  const want = {
    ...properties,
    ContinuousIntegrationBuild: ci ? "true" : "",
    RestoreLockedMode: ci ? "true" : "",
  };
  const args = [
    "msbuild",
    "SharpLadder.Probe.csproj",
    "-nologo",
    ...Object.keys(want).map((p) => `-getProperty:${p}`),
    "-getProperty:WarningsNotAsErrors",
    "-getItem:GlobalPackageReference",
    "-getItem:PackageVersion",
    "-getItem:AdditionalFiles",
  ];
  const r = run(args, ci);
  let json;
  try {
    json = JSON.parse(r.out);
  } catch {
    check(label, ["msbuild did not return JSON"], r.out);
    return;
  }
  const problems = [];
  const props = json.Properties ?? {};
  for (const [p, v] of Object.entries(want)) {
    if (props[p] !== v) problems.push(`${p} is "${props[p]}", want "${v}"`);
  }
  const notAsErrors = (props.WarningsNotAsErrors ?? "").split(";");
  for (const id of restoreAudit) {
    if (!notAsErrors.includes(id)) problems.push(`WarningsNotAsErrors lacks ${id}`);
  }
  const items = json.Items ?? {};
  for (const [kind, expected] of [
    ["GlobalPackageReference", analyzers],
    ["PackageVersion", packageVersions],
  ]) {
    const got = Object.fromEntries((items[kind] ?? []).map((i) => [i.Identity, i.Version]));
    const sorted = (o) => JSON.stringify(Object.entries(o).sort());
    if (sorted(got) !== sorted(expected)) {
      problems.push(`${kind} is ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
    }
  }
  const norm = (p) => (win ? resolve(p).toLowerCase() : resolve(p));
  const extra = (items.AdditionalFiles ?? []).map((i) => norm(i.FullPath));
  if (!extra.includes(norm(join(probe, "BannedSymbols.txt")))) {
    problems.push("AdditionalFiles does not include BannedSymbols.txt");
  }
  check(label, problems);
}

function diagnostics(out) {
  const ids = new Set();
  for (const m of out.matchAll(/:\s+(?:error|warning)\s+([A-Za-z][A-Za-z0-9_]*)\s*:/g)) {
    ids.add(m[1]);
  }
  return [...ids].sort();
}

function build(label, code, expected, severities = {}) {
  let config = globalconfig;
  for (const [id, sev] of Object.entries(severities)) {
    const line = `dotnet_diagnostic.${id}.severity = `;
    config = config.replace(new RegExp(`^${line.replace(/\./g, "\\.")}.*$`, "m"), `${line}${sev}`);
  }
  writeFileSync(join(probe, ".globalconfig"), config);
  writeFileSync(join(probe, "Sample.cs"), code);
  const r = run(["build", "--no-restore", "-nologo", "-clp:NoSummary"], true);
  const got = diagnostics(r.out);
  const want = [...expected].sort();
  const problems = [];
  const loaded = got.filter((id) => loadErrors.includes(id));
  if (loaded.length > 0) problems.push(`analyzer or config load errors: ${loaded.join(", ")}`);
  if (got.join() !== want.join()) {
    problems.push(`diagnostics [${got.join(", ")}], want [${want.join(", ")}]`);
  }
  if ((r.code === 0) !== (want.length === 0)) problems.push(`build exit ${r.code}`);
  check(label, problems, problems.length > 0 ? r.out : "");
  writeFileSync(join(probe, ".globalconfig"), globalconfig);
}

const cls = (body, usings = "") =>
  `${usings}namespace SharpLadder.Probe;\n\ninternal static class Sample\n{\n${body}\n}\n`;

// Each lowered rule fires here when set back to error; the code is otherwise clean.
const lowered = `using System.Text;
using System.Threading.Tasks;

namespace SharpLadder.Probe;

internal sealed class Sample
{
    private readonly StringBuilder _text = new();

    internal int Length => _text.Length;

    internal static Sample Create() => new();

    internal async Task<int> LengthAsync()
    {
        return await Task.FromResult(_text.Length).ConfigureAwait(false);
    }
}
`;
const loweredIds = ["SA1101", "SA1200", "SA1309", "SA1600", "SA1633", "AsyncFixer01"];

// Code that reads each banned symbol; a new kind of entry needs a generator here.
function useOf(docId) {
  const [kind, name] = [docId.slice(0, 2), docId.slice(2)];
  if (kind === "P:" || kind === "F:") return `global::${name}`;
  if (kind === "T:") return `typeof(global::${name})`;
  return null;
}
// Compiler diagnostics a banned symbol also raises on its own.
const alsoRaised = {
  "T:System.Runtime.Serialization.Formatters.Binary.BinaryFormatter": ["SYSLIB0011"],
};

const boot = run(["restore", "-nologo"], false);
check("bootstrap restore writes the probe lock file", boot.code === 0 ? [] : ["restore failed"], boot.out);
evaluation(false);
evaluation(true);
const locked = run(["restore", "-nologo"], true);
check("locked restore under CI", locked.code === 0 ? [] : ["locked restore failed"], locked.out);

build("clean code builds with no diagnostics", cls("    internal static int Add(int left, int right) => left + right;"), []);
build("lowered rules are silent", lowered, []);
for (const id of loweredIds) {
  build(`${id} fires when set back to error (positive control)`, lowered, [id], { [id]: "error" });
}
build(
  "SuppressMessage without Justification fails with SA1404",
  cls('    [SuppressMessage("Style", "IDE0022")]\n    internal static int One() => 1;', "using System.Diagnostics.CodeAnalysis;\n\n"),
  ["SA1404"],
);
// Doc comments are optional, but the ones that exist are still checked.
build(
  "a returns tag on a void method fails with SA1617 and MA0203",
  cls("    /// <summary>Does nothing.</summary>\n    /// <returns>Nothing.</returns>\n    internal static void Run()\n    {\n    }"),
  ["MA0203", "SA1617"],
);
build(
  "an empty returns tag fails with SA1616",
  cls("    /// <summary>Returns one.</summary>\n    /// <returns></returns>\n    internal static int One() => 1;"),
  ["SA1616"],
);
build(
  "a documented non-void method without a returns tag fails with SA1615",
  cls("    /// <summary>Returns one.</summary>\n    internal static int One() => 1;"),
  ["SA1615"],
);
const partialParams = cls(
  '    /// <summary>Adds two numbers.</summary>\n    /// <param name="left">The first.</param>\n    /// <param name="right">The second.</param>\n    /// <param name="scale">The factor.</param>\n    /// <returns>The scaled sum.</returns>\n    internal static int Add(int left, int right, int scale) => (left + right) * scale;',
);
build("fully documented parameters build with no diagnostics", partialParams, []);
const missingParam = partialParams.replace('    /// <param name="scale">The factor.</param>\n', "");
build("a missing param tag fails with SA1611 only", missingParam, ["SA1611"]);
build("CS1573 fires when set back to error (positive control)", missingParam, ["CS1573", "SA1611"], {
  CS1573: "error",
});
build(
  "a param tag naming no parameter fails with SA1612, CS1572 and RCS1263",
  partialParams.replace('name="scale"', 'name="factor"'),
  ["CS1572", "RCS1263", "SA1611", "SA1612"],
);
const banned = readFileSync(join(probe, "BannedSymbols.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("//"))
  .map((l) => l.split(";")[0]);
for (const docId of banned) {
  const use = useOf(docId);
  if (!use) {
    check(`banned ${docId}`, ["no generator for this kind of entry"]);
    continue;
  }
  build(`banned ${docId} fails with RS0030`, cls(`    internal static object Read() => ${use};`), [
    "RS0030",
    ...(alsoRaised[docId] ?? []),
  ]);
}

const packagesProps = join(probe, "Directory.Packages.props");
const goodPackages = readFileSync(packagesProps, "utf8");
writeFileSync(packagesProps, goodPackages.replace("</Project>", ""));
// Restore alone reports success on a malformed import, so the build is what must fail.
const bad = run(["build", "--no-restore", "-nologo", "-clp:NoSummary"], true);
check(
  "malformed Directory.Packages.props fails the build",
  bad.code !== 0 && /MSB4024/.test(bad.out) ? [] : [`build exit ${bad.code}, want MSB4024`],
  bad.out,
);
writeFileSync(packagesProps, goodPackages);

console.log(`dotnet probe: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
