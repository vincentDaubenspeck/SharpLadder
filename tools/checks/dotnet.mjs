// The .NET configuration check: the SDK pin and a smoke evaluation of the props files.
// Standalone props evaluation skips the SDK imports, so the full check is the probe build
// in tools/tests/dotnet-probe.mjs; .globalconfig and BannedSymbols.txt are read only there.
// Usage: node tools/checks/dotnet.mjs [repository root]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { anyFailed, dotnet, exec, installHint, pins, report } from "./lib.mjs";

const name = ".NET config";

// Each props file and the values its own properties must evaluate to.
const smoke = {
  "Directory.Build.props": {
    Nullable: "enable",
    TreatWarningsAsErrors: "true",
    AnalysisLevel: "latest-recommended",
  },
  "Directory.Packages.props": { ManagePackageVersionsCentrally: "true" },
};

function sdkProblems(root) {
  const want = pins.dotnet.version;
  const file = join(root, "global.json");
  if (!existsSync(file)) return ["global.json not found"];
  let sdk;
  try {
    sdk = JSON.parse(readFileSync(file, "utf8")).sdk ?? {};
  } catch (err) {
    return [`global.json: ${err.message}`];
  }
  const problems = [];
  if (sdk.version !== want) {
    problems.push(`global.json SDK ${sdk.version} differs from tools/tool-pins.json ${want}`);
  }
  if (sdk.rollForward !== "disable") problems.push('global.json rollForward must be "disable"');
  if (problems.length > 0) return problems;
  const r = exec(dotnet, ["--version"], { cwd: root });
  if (r.code === null) return [`dotnet not found; ${installHint}`];
  if (r.code !== 0 || r.out.trim() !== want) {
    return [`dotnet SDK ${want} not usable here; ${installHint}`, r.out];
  }
  return [];
}

function propsProblems(root) {
  const problems = [];
  for (const [file, want] of Object.entries(smoke)) {
    const path = join(root, file);
    if (!existsSync(path)) {
      problems.push(`${file} not found`);
      continue;
    }
    const args = ["msbuild", path, "-nologo", ...Object.keys(want).map((p) => `-getProperty:${p}`)];
    const r = exec(dotnet, args, { cwd: root });
    if (r.code !== 0) {
      problems.push(`${file} does not evaluate`, r.out);
      continue;
    }
    const keys = Object.keys(want);
    let got;
    try {
      // MSBuild prints a lone property as its bare value and several as JSON.
      got = keys.length === 1 ? { [keys[0]]: r.out.trim() } : JSON.parse(r.out).Properties;
    } catch {
      problems.push(`${file}: unexpected msbuild output`, r.out);
      continue;
    }
    for (const [prop, value] of Object.entries(want)) {
      if (got[prop] !== value) problems.push(`${file}: ${prop} is "${got[prop]}", want "${value}"`);
    }
  }
  return problems;
}

export function dotnetChecks(root) {
  const sdk = sdkProblems(root);
  report(name, sdk.length > 0 ? sdk : propsProblems(root));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotnetChecks(process.argv[2] ?? process.cwd());
  process.exitCode = anyFailed() ? 1 : 0;
}
