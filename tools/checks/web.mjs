// The npm-script stages of the check run, importable so a test drives the real stage code.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  findingProblems,
  policyFile,
  policyProblems,
  recordProblems,
  registryProblems,
  severities,
} from "./audit-exceptions.mjs";
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
  return { body, tree };
}

// Refuses an inventory the audit could not cover in full, before any request is made. The loaded
// tree is kept, since exception records are judged against its installed versions.
async function inventory(web) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
  } catch (e) {
    return { problems: [`package.json could not be read: ${String(e.message)}`] };
  }
  if (!isRecord(manifest)) return { problems: ["package.json is not an object"] };
  if (Object.hasOwn(manifest, "workspaces")) return { problems: ["package.json declares workspaces"] };
  if (existsSync(join(web, "npm-shrinkwrap.json"))) {
    return { problems: ["npm-shrinkwrap.json exists, and npm would audit it instead of package-lock.json"] };
  }
  let prepared;
  try {
    prepared = await auditBody(web);
  } catch (e) {
    const code = typeof e?.code === "string" ? `${e.code}: ` : "";
    return { problems: [`npm audit inventory could not be prepared from the lockfile: ${code}${String(e?.message ?? e)}`] };
  }
  if (Object.keys(prepared.body).length === 0) {
    return { problems: ["the lockfile lists no package npm audit would send the registry"] };
  }
  return { problems: [], tree: prepared.tree };
}

// Every installation the lockfile gives, named by its own package data and never by its folder.
function installations(tree) {
  const installs = [];
  const problems = [];
  for (const node of tree.inventory.values()) {
    if (node === tree) continue;
    const { location } = node;
    const name = node.package?.name;
    const version = node.package?.version;
    if (typeof location !== "string" || typeof name !== "string" || typeof version !== "string") {
      problems.push(`the lockfile gives ${String(location)} no package name and version`);
    } else installs.push({ location, name, version });
  }
  return { problems, installs };
}

// The pinned npm's own version library, loaded only when a record needs it.
function versionLibrary() {
  if (!npmCli) throw new Error("npm not found next to node");
  const root = join(dirname(dirname(npmCli)), "node_modules", "semver");
  const semver = npmModule(createRequire(npmCli), root, "semver");
  const used = ["valid", "validRange", "satisfies", "prerelease", "gt", "compare"];
  if (!used.every((name) => typeof semver?.[name] === "function")) {
    throw new Error("semver has an unexpected shape");
  }
  return semver;
}

// The policy file, read before any npm run; anything but the exact shape refuses the stage.
function readPolicy(web) {
  let policy;
  try {
    policy = JSON.parse(readFileSync(join(web, policyFile), "utf8"));
  } catch (e) {
    return { problems: [`${policyFile} could not be read: ${String(e?.message ?? e)}`] };
  }
  const problems = policyProblems(policy);
  return problems.length > 0 ? { problems } : { problems, exceptions: policy.exceptions };
}

// The report's shape problems, or the report itself with the number of entries it lists.
function readReport(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { problems: ["npm audit did not print a JSON report"] };
  }
  const bad = (problem) => ({ problems: [`npm audit report ${problem}`] });
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
  return { problems: [], data, sum };
}

const foundLine = (data) => {
  const counts = data.metadata.vulnerabilities;
  const named = severities.map((k) => `${k} ${String(counts[k])}`).join(", ");
  return `npm audit found ${named}, in ${Object.keys(data.vulnerabilities).join(", ")}`;
};

// The report's problems, none for a valid report with nothing found. It only judges the report;
// what is shown on a failure never depends on it.
function reportVerdict(stdout) {
  const { problems, data, sum } = readReport(stdout);
  if (problems.length > 0) return problems;
  return sum > 0 ? [foundLine(data)] : [];
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

const refuse = (reasons) => {
  auditFailure(reasons, null);
  return null;
};
const fail = (reasons, result) => {
  auditFailure(reasons, result);
  return result;
};
// npm's warnings stay visible beside a PASS.
const showStderr = (r) => {
  for (const line of lines(r.stderr).split("\n").filter((l) => l.trim() !== "")) console.log(`  ${line}`);
};

const auditCommand = ["run", "--silent", "audit", "--", "--json"];
// With both given npm includes dev, so the production run drops that override instead.
const productionOverrides = [...auditOverrides.filter((flag) => flag !== "--include=dev"), "--omit=dev"];
// Asked online every time, so a release published since the cache was filled is seen.
const registryOverrides = ["--offline=false", "--prefer-offline=false", "--prefer-online=true", "--workspaces=false"];

const errorReport = (stdout) => {
  try {
    const data = JSON.parse(stdout ?? "");
    return isRecord(data) && Object.hasOwn(data, "error");
  } catch {
    return false;
  }
};
// A run that did not finish or that reports an error is refused, whatever else it printed.
function runProblems(label, r) {
  if (r.code === null || (r.signal ?? null) !== null || (r.error ?? null) !== null) {
    const why = [r.signal ? `killed by ${r.signal}` : "", lines(String(r.error ?? ""))].filter((p) => p !== "");
    return [`${label} did not complete${why.length > 0 ? ` (${why.join("; ")})` : ""}`];
  }
  return errorReport(r.stdout) ? [`${label} reported an error`] : [];
}

function plainAudit(run, opts) {
  const r = run("npm", [...auditCommand, ...auditOverrides], opts);
  const problems = [];
  if (r.code === null) {
    const why = [r.signal ? `killed by ${r.signal}` : "", lines(r.error)].filter((p) => p !== "");
    problems.push(`npm audit did not complete${why.length > 0 ? ` (${why.join("; ")})` : ""}`);
  } else if (r.code !== 0) {
    problems.push(`npm audit exited ${String(r.code)}`);
  }
  problems.push(...reportVerdict(r.stdout ?? ""));
  if (problems.length > 0) return fail(problems, r);
  showStderr(r);
  report("npm audit", []);
  return r;
}

// Stops at the first refusal, so no run follows one and only the failing run's output is shown.
function exceptionAudit(run, opts, tree, exceptions) {
  const listed = installations(tree);
  if (listed.problems.length > 0) return refuse(listed.problems);
  let semver;
  try {
    semver = versionLibrary();
  } catch (e) {
    return refuse([`the version library could not be loaded from the pinned npm: ${String(e?.message ?? e)}`]);
  }
  const refused = recordProblems(exceptions, listed.installs, semver);
  if (refused.length > 0) return refuse(refused);

  const full = run("npm", [...auditCommand, ...auditOverrides], opts);
  const done = [full];
  let problems = runProblems("npm audit", full);
  if (problems.length > 0) return fail(problems, full);
  if (full.code !== 0 && full.code !== 1) return fail([`npm audit exited ${String(full.code)}`], full);
  const exited = full.code === 1 ? ["npm audit exited 1"] : [];
  const read = readReport(full.stdout ?? "");
  if (read.problems.length > 0) return fail([...exited, ...read.problems], full);
  if (read.sum === 0) {
    if (exited.length > 0) return fail(exited, full);
    const unused = exceptions.map((x) => `${policyFile}: ${x.advisoryId} in ${x.package} matches no finding`);
    return fail(unused, full);
  }
  let judged;
  try {
    judged = findingProblems(read.data, listed.installs, exceptions, semver);
  } catch (e) {
    judged = { problems: [`the npm audit report could not be judged: ${String(e?.message ?? e)}`] };
  }
  if (judged.problems.length > 0) return fail([...exited, foundLine(read.data), ...judged.problems], full);

  const production = run("npm", [...auditCommand, ...productionOverrides], opts);
  done.push(production);
  problems = runProblems("npm audit of the production tree", production);
  if (problems.length === 0) {
    if (production.code !== 0) problems.push(`npm audit of the production tree exited ${String(production.code)}`);
    problems.push(...reportVerdict(production.stdout ?? "").map((p) => `production tree: ${p}`));
  }
  if (problems.length > 0) return fail(problems, production);

  for (const record of exceptions) {
    const label = `npm view ${record.package} versions`;
    const view = run("npm", ["view", record.package, "versions", "--json", ...registryOverrides], opts);
    done.push(view);
    problems = runProblems(label, view);
    if (problems.length === 0 && view.code !== 0) problems.push(`${label} exited ${String(view.code)}`);
    if (problems.length === 0) {
      try {
        problems = registryProblems(record, judged.ranges.get(record), view.stdout ?? "", semver);
      } catch (e) {
        problems = [`${label} could not be judged: ${String(e?.message ?? e)}`];
      }
    }
    if (problems.length > 0) return fail(problems, view);
  }

  for (const r of done) showStderr(r);
  for (const x of exceptions) {
    console.log(`  exception in force: ${x.advisoryId} ${x.package} ${x.versions.join(", ")}`);
  }
  report("npm audit", []);
  return done.at(-1);
}

// Only this stage applies the exception records in web/dependency-audit-policy.json; the audit
// script's threshold lives in web/package.json alone. With no record a PASS needs exit 0 and
// nothing found at any severity, info included. With records every finding must be covered
// exactly, the production tree must report nothing, and no newer release may leave a range.
export async function npmAuditStage(web, run = exec) {
  const checked = await inventory(web);
  if (checked.problems.length > 0) return refuse(checked.problems);
  const policy = readPolicy(web);
  if (policy.problems.length > 0) return refuse(policy.problems);
  const opts = { cwd: web, env: auditEnv, timeout: auditTimeoutMs };
  if (policy.exceptions.length === 0) return plainAudit(run, opts);
  return exceptionAudit(run, opts, checked.tree, policy.exceptions);
}
