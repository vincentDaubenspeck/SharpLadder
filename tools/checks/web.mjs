// The npm-script stages of the check run, importable so a test drives the real stage code.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { env, exec, notApplicable, npmCli, report } from "./lib.mjs";

// Printed by web/stylelint/lint-production.js while web/src has no stylesheet.
const stylesheetBootstrap = "NOT APPLICABLE — no source stylesheets";

export const webStages = [
  ["lockfile-lint", "lint:lockfile"],
  // The lockfile checks never see the installed tree, where a package can be added after npm ci.
  ["Install health", ["source-check/install-health.js"]],
  // Serial, where no Vite load or other install writer is active, unlike a vitest worker.
  ["Install health (real tree acceptance)", ["source-check/install-acceptance.js"]],
  ["licence allowlist", "license:check"],
  ["asset licence inventory", "asset-licence:check"],
  ["dependency overrides", "overrides:check"],
  ["ESLint", "lint"],
  ["Stylelint (source stylesheets)", "lint:css"],
  ["Source tree", ["source-check/index.js"]],
  ["ESLint comment policy", "lint:comments"],
  ["Prettier", "format:check"],
  ["TypeScript", "typecheck"],
  // Hosted runners set CI=true, which changes tool defaults, so the local suite runs under it too.
  ["Vitest", "test", { CI: "true" }],
  // Vitest loads the Vite config into the real tree, so a leftover .vite-temp entry shows here.
  ["Install health (after Vitest)", ["source-check/install-health.js"]],
  // The same script CI runs; it lints and typechecks before vite build replaces web/dist.
  ["Production build", "build"],
  // Array form, so the stage's own environment turns off the jiti cache in node_modules.
  ["knip", ["knip/run.js"], { JITI_FS_CACHE: "false" }],
  // After the awaited acceptance tools finish, the installation still satisfies the install-health layout contract.
  ["Install health (after tools)", ["source-check/install-health.js"]],
  ["markdownlint", "lint:md"],
  ["cspell", "lint:spell"],
];

export function runWebStage(web, [name, script, stageEnv = {}], extra = []) {
  const opts = { cwd: web, env: { ...env, ...stageEnv } };
  const r = Array.isArray(script)
    ? exec(process.execPath, [...script, ...extra], opts)
    : exec("npm", ["run", "--silent", script, ...(extra.length > 0 ? ["--", ...extra] : [])], opts);
  if (r.code === 0 && script === "lint:css" && r.out.trim() === stylesheetBootstrap) {
    // The bootstrap stage is reported as inapplicable, never relabelled PASS.
    notApplicable(name, "no source stylesheets");
    return r;
  }
  report(name, r.code === 0 ? [] : [r.out]);
  return r;
}

// Command-line settings outrank the environment and every npmrc, so no inherited setting can skip
// the registry, answer from the cache, leave a dependency type out or audit anything but the lockfile.
const auditOverrides = [
  "--offline=false",
  "--prefer-offline=false",
  "--include=dev",
  "--include=optional",
  "--include=peer",
  "--package-lock=true",
  "--package-lock-only=true",
  "--workspaces=false",
];
// An inherited workspace selection would make npm run or npm audit cover part of the tree. One
// from an npmrc stays, and with no workspaces declared npm fails on it instead.
const workspaceKey = /^npm_config_workspaces?$/iu;
const auditEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !workspaceKey.test(k)));
// A healthy audit takes seconds. The limit ends the npm process started here, not every process under it.
const auditTimeoutMs = 5 * 60 * 1000;
const severities = ["info", "low", "moderate", "high", "critical"];

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

// The pinned npm's own copy, never one installed elsewhere on the module path.
function npmModule(req, root, id) {
  const path = req.resolve(id);
  const rel = relative(realpathSync(root), realpathSync(path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${id} resolved outside the pinned npm: ${path}`);
  }
  return req(path);
}

// The packages npm audit would send the registry, prepared by the pinned npm's own Arborist from
// the lockfile with the settings the overrides force: whole tree, nothing omitted, no workspaces.
async function auditBody(web) {
  if (!npmCli) throw new Error("npm not found next to node");
  const req = createRequire(npmCli);
  const arboristRoot = join(dirname(dirname(npmCli)), "node_modules", "@npmcli", "arborist");
  const Arborist = npmModule(req, arboristRoot, "@npmcli/arborist");
  const AuditReport = npmModule(req, arboristRoot, "@npmcli/arborist/lib/audit-report.js");
  if (typeof Arborist !== "function" || typeof AuditReport?.prototype?.prepareBulkData !== "function") {
    throw new Error("Arborist or its audit report has an unexpected shape");
  }
  const arb = new Arborist({ path: web, packageLock: true, workspacesEnabled: false, workspaces: [], omit: [] });
  if (typeof arb.loadVirtual !== "function" || typeof arb.excludeWorkspacesDependencySet !== "function") {
    throw new Error("Arborist has an unexpected shape");
  }
  const tree = await arb.loadVirtual();
  // Arborist's audit narrows the tree this way whenever workspaces are off.
  const filterSet = arb.excludeWorkspacesDependencySet(tree);
  if (!(tree?.inventory instanceof Map) || !(filterSet instanceof Set)) {
    throw new Error("the loaded tree has an unexpected shape");
  }
  const body = new AuditReport(tree, { ...arb.options, omit: [], filterSet }).prepareBulkData();
  const versions = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");
  if (!isRecord(body) || !Object.values(body).every(versions)) {
    throw new Error("the audit request body has an unexpected shape");
  }
  return body;
}

// Refuses an inventory the audit could not cover in full, before any request is made.
async function inventoryProblems(web) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
  } catch (e) {
    return [`package.json could not be read: ${String(e.message)}`];
  }
  if (!isRecord(manifest)) return ["package.json is not an object"];
  if (Object.hasOwn(manifest, "workspaces")) return ["package.json declares workspaces"];
  if (existsSync(join(web, "npm-shrinkwrap.json"))) {
    return ["npm-shrinkwrap.json exists, and npm would audit it instead of package-lock.json"];
  }
  let body;
  try {
    body = await auditBody(web);
  } catch (e) {
    const code = typeof e?.code === "string" ? `${e.code}: ` : "";
    return [`npm audit inventory could not be prepared from the lockfile: ${code}${String(e?.message ?? e)}`];
  }
  if (Object.keys(body).length === 0) {
    return ["the lockfile lists no package npm audit would send the registry"];
  }
  return [];
}

// The report's problems, none for a valid report with nothing found. It only judges the report;
// what is shown on a failure never depends on it.
function reportVerdict(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return ["npm audit did not print a JSON report"];
  }
  const bad = (problem) => [`npm audit report ${problem}`];
  if (!isRecord(data)) return bad("is not an object");
  if (data.auditReportVersion !== 2) return bad(`version is ${JSON.stringify(data.auditReportVersion)}, not 2`);
  const { vulnerabilities: found, metadata } = data;
  if (!isRecord(found)) return bad("has no vulnerabilities map");
  const counts = isRecord(metadata) ? metadata.vulnerabilities : undefined;
  if (!isRecord(counts)) return bad("has no vulnerability counts");
  const keys = Object.keys(counts).sort();
  if (keys.join(",") !== [...severities, "total"].sort().join(",")) {
    return bad(`counts have the keys ${keys.join(", ")}`);
  }
  if (!Object.values(counts).every(isCount)) return bad("counts are not all non-negative integers");
  const sum = severities.reduce((s, k) => s + counts[k], 0);
  if (counts.total !== sum || Object.keys(found).length !== sum) {
    return bad("counts do not match its vulnerabilities");
  }
  const dependencies = isRecord(metadata.dependencies) ? metadata.dependencies.total : undefined;
  if (!Number.isSafeInteger(dependencies) || dependencies < 1) return bad("lists no dependencies");
  if (sum > 0) {
    const named = severities.map((k) => `${k} ${String(counts[k])}`).join(", ");
    return [`npm audit found ${named}, in ${Object.keys(found).join(", ")}`];
  }
  return [];
}

const lines = (text) => (text ?? "").replace(/\r/gu, "").replace(/\s+$/u, "");

// Every audit-stage failure ends here. npm's output is untrusted, so each captured stream is
// written exactly as captured, in its own block whose byte count marks where it ends; nothing in
// it decides what is shown, and report, which trims and indents, never sees it.
function auditFailure(reasons, result) {
  if (result === null) {
    report("npm audit", [...reasons, "npm audit was not run"]);
    return;
  }
  for (const stream of ["stdout", "stderr"]) {
    const text = String(result[stream] ?? "");
    const size = String(Buffer.byteLength(text, "utf8"));
    process.stdout.write(`  npm audit ${stream}, ${size} bytes:\n${text}\n  end of npm audit ${stream}\n`);
  }
  report("npm audit", reasons);
}

// For a failure found before the stage, such as a missing npm.
export const npmAuditNotRun = (reasons) => auditFailure(reasons, null);

// The same script CI runs, so its threshold lives in web/package.json alone. A PASS needs the
// inventory check, exit 0 and a valid report with nothing found at any severity, info included.
export async function npmAuditStage(web, run = exec) {
  const refused = await inventoryProblems(web);
  if (refused.length > 0) {
    auditFailure(refused, null);
    return null;
  }
  const opts = { cwd: web, env: auditEnv, timeout: auditTimeoutMs };
  const r = run("npm", ["run", "--silent", "audit", "--", "--json", ...auditOverrides], opts);
  const problems = [];
  if (r.code === null) {
    const why = [r.signal ? `killed by ${r.signal}` : "", lines(r.error)].filter((p) => p !== "");
    problems.push(`npm audit did not complete${why.length > 0 ? ` (${why.join("; ")})` : ""}`);
  } else if (r.code !== 0) {
    problems.push(`npm audit exited ${String(r.code)}`);
  }
  problems.push(...reportVerdict(r.stdout ?? ""));
  if (problems.length > 0) {
    auditFailure(problems, r);
    return r;
  }
  // npm's warnings stay visible beside a PASS.
  for (const line of lines(r.stderr).split("\n").filter((l) => l.trim() !== "")) console.log(`  ${line}`);
  report("npm audit", []);
  return r;
}
