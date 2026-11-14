// npm audit cases for both test suites: the audit script from web/package.json runs against a
// fixture lockfile and a local stand-in registry, so the threshold is tested without the network.
// The check run's npm audit stage then runs the same way, and with injected outcomes it must fail.
// Usage: node tools/tests/npm-audit-cases.mjs <empty work directory>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const src = join(import.meta.dirname, "..", "..");
const work = resolve(process.argv[2] ?? ".");
const script = JSON.parse(readFileSync(join(src, "web", "package.json"), "utf8")).scripts.audit;

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (ok) return;
  failed++;
  for (const line of detail.split(/\r?\n/).filter((l) => l.trim() !== "")) console.log(`  ${line}`);
}

const bulkPath = "/-/npm/v1/security/advisories/bulk";
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let advisories = {};
// How the stand-in answers the advisory request: "ok", an HTTP error status, or "garbage".
let registryMode = "ok";
const requests = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    let body = null;
    if (req.method === "POST") {
      try {
        body = JSON.parse((req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString("utf8"));
      } catch {
        body = "(unreadable)";
      }
    }
    requests.push({ method: req.method, url: req.url, body });
    const send = (code, payload) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };
    // A registry selected by a path prefix answers like the root one, so a case can tell them apart.
    const path = req.url.replace(/^\/selected(?=\/)/u, "");
    if (req.method === "POST" && path === bulkPath) {
      if (registryMode === "garbage") send(200, "not json {");
      else if (registryMode !== "ok") send(registryMode, { error: "stand-in registry failure" });
      else send(200, Object.fromEntries(Object.entries(advisories).filter(([name]) => isRecord(body) && name in body)));
    } else if (req.method === "GET" && path === "/fx-pkg") {
      // The vulnerable-range calculation reads every published version of the package.
      const version = (v) => ({ name: "fx-pkg", version: v, dist: { tarball: `${base}/fx-pkg-${v}.tgz` } });
      send(200, {
        name: "fx-pkg",
        "dist-tags": { latest: "1.0.1" },
        versions: { "1.0.0": version("1.0.0"), "1.0.1": version("1.0.1") },
      });
    } else {
      send(404, { error: "not found" });
    }
  });
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

// The bulk advisory requests made since a mark, to the root registry or the one under prefix.
const bulkPosts = (from, prefix = "") =>
  requests.slice(from).filter((q) => q.method === "POST" && q.url === `${prefix}${bulkPath}`);
const fxBody = { "fx-pkg": ["1.0.0"] };
const askedFor = (from, prefix = "") =>
  bulkPosts(from, prefix).some((q) => JSON.stringify(q.body) === JSON.stringify(fxBody));
const seen = (from) =>
  requests
    .slice(from)
    .map((q) => `${q.method} ${q.url} ${JSON.stringify(q.body)}`)
    .join("\n");

const lockFlags = {
  dependencies: {},
  devDependencies: { dev: true },
  optionalDependencies: { optional: true },
  peerDependencies: { peer: true },
};
// A separate project wherever a case needs its own npmrc, dependency type or lockfile.
function fixtureProject(name, opts = {}) {
  const { npmrc, type = "dependencies", spec = "1.0.0", manifest = {}, packages, lockText, shrinkwrap } = opts;
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const deps = { [type]: { "fx-pkg": spec } };
  const pkg = { name: "fx", version: "1.0.0", private: true, scripts: { audit: script }, ...deps, ...manifest };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const lock = (v) => ({
    name: "fx",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: packages ?? {
      "": { name: "fx", version: "1.0.0", ...deps },
      "node_modules/fx-pkg": { version: v, resolved: `${base}/fx-pkg-${v}.tgz`, ...lockFlags[type] },
    },
  });
  const files = {
    "package-lock.json": lockText === undefined ? `${JSON.stringify(lock("1.0.0"), null, 2)}\n` : lockText,
    "npm-shrinkwrap.json": shrinkwrap === undefined ? null : `${JSON.stringify(lock(shrinkwrap), null, 2)}\n`,
    ".npmrc": npmrc ?? null,
    ...opts.files,
  };
  for (const [file, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}
const project = fixtureProject("fx");
const userConfig = join(work, "user.npmrc");
const globalConfig = join(work, "global.npmrc");
writeFileSync(userConfig, "");
writeFileSync(globalConfig, "");

// The user's npm configuration and cache stay out, so only the stand-in registry answers. Every
// inherited npm_config_ variable goes in any letter case: npm reads them case-insensitively, and
// on Windows an uppercase duplicate can win over the fixture's lowercase value.
function fixtureEnv(inherited = process.env, registry = `${base}/`) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([k]) => !/^npm_config_/i.test(k)));
  return {
    ...env,
    npm_config_registry: registry,
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: join(work, "cache"),
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    // A failing stand-in answers at once, so npm's retry backoff would only slow the cases.
    npm_config_fetch_retries: "0",
  };
}

// Asynchronous, so the stand-in registry in this process can answer while the child waits. The
// child's stdout is also kept as bytes, since a block of npm output is cut by its byte count.
function run(cmd, args, opts) {
  return new Promise((done) => {
    const child = spawn(cmd, args, opts);
    const all = [];
    const stdout = [];
    child.stdout.on("data", (c) => {
      all.push(c);
      stdout.push(c);
    });
    child.stderr.on("data", (c) => all.push(c));
    child.on("error", (err) => all.push(Buffer.from(String(err.message))));
    child.on("close", (code, signal) =>
      done({ code, signal, out: Buffer.concat(all).toString("utf8"), stdoutBytes: Buffer.concat(stdout) }),
    );
  });
}

const audit = (inherited) => run(script, [], { cwd: project, shell: true, env: fixtureEnv(inherited) });

// The stage's output as records: each block of npm output, cut by the byte count in its label,
// and the stage's own lines around them, so text inside npm's output is never read as status.
function stageRecords(bytes) {
  const records = [];
  let at = 0;
  while (at < bytes.length) {
    const end = bytes.indexOf(10, at);
    if (end < 0) return { records, recordError: `output ends without a newline at byte ${String(at)}` };
    const line = bytes.subarray(at, end).toString("utf8");
    at = end + 1;
    const head = /^ {2}npm audit (stdout|stderr), (\d+) bytes:$/u.exec(line);
    if (!head) {
      records.push({ line });
      continue;
    }
    const stop = at + Number(head[2]);
    const close = Buffer.from(`\n  end of npm audit ${head[1]}\n`);
    if (!bytes.subarray(stop, stop + close.length).equals(close)) {
      return { records, recordError: `the ${head[1]} block at byte ${String(at)} is not closed after its byte count` };
    }
    records.push({ stream: head[1], text: bytes.subarray(at, stop).toString("utf8") });
    at = stop + close.length;
  }
  return { records, recordError: null };
}

// The check run's own stage code, its report line and exit status, with the audit runner given as
// source. What the runner returned is saved, so a case compares the shown blocks with that call.
const checks = join(src, "tools", "checks");
const stageModule = (body) => `
import { writeFileSync } from "node:fs";
import { exec, setExitCode } from ${JSON.stringify(pathToFileURL(join(checks, "lib.mjs")).href)};
import { npmAuditNotRun, npmAuditStage } from ${JSON.stringify(pathToFileURL(join(checks, "web.mjs")).href)};
${body}
setExitCode();
`;
const stageSource = (runner) =>
  stageModule(`const runner = ${runner};
await npmAuditStage(process.argv[1], (...a) => {
  const r = runner(...a);
  writeFileSync(process.argv[2], JSON.stringify(r));
  return r;
});`);
let stageRuns = 0;
async function stage({ runner = "exec", dir = project, registry, env = {}, source } = {}) {
  const saved = join(work, `exec-${String(++stageRuns)}.json`);
  const r = await run(process.execPath, ["--input-type=module", "-e", source ?? stageSource(runner), dir, saved], {
    cwd: work,
    env: { ...fixtureEnv(process.env, registry), ...env },
  });
  r.exec = existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")) : null;
  Object.assign(r, stageRecords(r.stdoutBytes));
  r.reasons = r.records.flatMap((x) => ("line" in x ? [x.line] : [])).join("\n");
  return r;
}

// What is wrong with a failing stage. It must open with npm's stdout block and then its stderr
// block, each exactly as the runner returned it, or show no block when npm never ran; then come
// reasons matching why and one FAIL as the last record, with no PASS, and exit 1.
function failureProblems(r, why, ran = true) {
  const problems = r.recordError === null ? [] : [r.recordError];
  if (r.code !== 1 || r.signal !== null) problems.push(`exit ${String(r.code)} signal ${String(r.signal)}`);
  const blocks = r.records.filter((x) => "stream" in x);
  if (!ran) {
    if (r.exec !== null) problems.push("the audit runner was called");
    if (blocks.length > 0) problems.push("npm output blocks are shown for a run that never started");
    if (!/^ {2}npm audit was not run$/mu.test(r.reasons)) problems.push("no line says npm audit was not run");
  } else if (r.exec === null) {
    problems.push("the audit runner was not called");
  } else if (blocks.length !== 2 || r.records[0]?.stream !== "stdout" || r.records[1]?.stream !== "stderr") {
    problems.push("the output does not open with a stdout block and then a stderr block");
  } else {
    for (const [i, name] of [
      [0, "stdout"],
      [1, "stderr"],
    ]) {
      if (r.records[i].text !== r.exec[name]) {
        problems.push(`${name} block ${JSON.stringify(r.records[i].text)} is not ${JSON.stringify(r.exec[name])}`);
      }
    }
  }
  const status = r.records.filter((x) => "line" in x && /^(PASS|FAIL) /u.test(x.line)).map((x) => x.line);
  if (status.join("\n") !== "FAIL npm audit" || r.records.at(-1)?.line !== "FAIL npm audit") {
    problems.push(`status records ${JSON.stringify(status)}, last record ${JSON.stringify(r.records.at(-1))}`);
  }
  if (!why.test(r.reasons)) problems.push(`no reason matches ${String(why)}`);
  return problems;
}
const stageFails = (r, why) => failureProblems(r, why).length === 0;
const stageRefuses = (r, why) => failureProblems(r, why, false).length === 0;
// A pass shows no block of npm output and one PASS as its last record.
const stagePasses = (r) =>
  r.code === 0 &&
  r.recordError === null &&
  r.records.every((x) => "line" in x) &&
  r.records.filter((x) => /^(PASS|FAIL) /u.test(x.line)).length === 1 &&
  r.records.at(-1)?.line === "PASS npm audit";
const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const severities = ["info", "low", "moderate", "high", "critical"];
const advisory = (severity) => ({
  "fx-pkg": [
    {
      // npm caches an advisory by package and id, so each severity has its own id.
      id: 1 + severities.indexOf(severity),
      url: `https://example.invalid/advisories/${String(1 + severities.indexOf(severity))}`,
      title: "Fixture advisory",
      severity,
      vulnerable_versions: "<1.0.1",
      cwe: [],
      cvss: { score: 0, vectorString: null },
    },
  ],
});
const found = (severity) =>
  new RegExp(`^ {2}npm audit found ${severities.map((k) => `${k} ${k === severity ? 1 : 0}`).join(", ")}, in fx-pkg$`, "mu");

check("npm audit script is npm audit", /^npm audit( |$)/.test(script), script);

advisories = {};
let r = await audit();
check("npm audit passes with no advisories", r.code === 0, `exit ${r.code}\n${r.out}`);

advisories = advisory("low");
let from = requests.length;
r = await audit();
check(
  "npm audit fails a low-severity advisory",
  askedFor(from) && r.code !== 0 && /\b1 low severity vulnerability\b/.test(r.out),
  `exit ${r.code}\n${r.out}\n${seen(from)}`,
);

const decoyHits = [];
const decoy = createServer((req, res) => {
  decoyHits.push(`${req.method} ${req.url}`);
  res.writeHead(500);
  res.end();
});
await new Promise((ok) => decoy.listen(0, "127.0.0.1", ok));
const sentinelCache = join(work, "sentinel-cache");
from = requests.length;
r = await audit({
  ...process.env,
  NPM_CONFIG_REGISTRY: `http://127.0.0.1:${decoy.address().port}/`,
  NPM_CONFIG_CACHE: sentinelCache,
  NPM_CONFIG_USERCONFIG: join(work, "sentinel-user.npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(work, "sentinel-global.npmrc"),
});
check(
  "npm audit ignores inherited uppercase npm config",
  askedFor(from) &&
    decoyHits.length === 0 &&
    !existsSync(sentinelCache) &&
    r.code !== 0 &&
    /\b1 low severity vulnerability\b/.test(r.out),
  `exit ${r.code}\n${r.out}\nstand-in: ${seen(from)}\ndecoy: ${decoyHits.join(", ")}`,
);

const show = (s, mark = requests.length) =>
  `exit ${String(s.code)} signal ${String(s.signal)}\n${s.out}\nshape: ${failureProblems(s, /(?:)/u).join("; ")}\nrequests:\n${seen(mark)}`;
const exited = /^ {2}npm audit exited [1-9]\d*$/mu;

advisories = {};
from = requests.length;
r = await stage();
check("npm audit stage passes a clean audit of the lockfile", stagePasses(r) && askedFor(from), show(r, from));

// npm exits 0 on an info advisory at --audit-level=low; the report's counts still fail it, and
// the failure shows npm's whole report, with the advisory details the summary leaves out.
for (const severity of severities) {
  advisories = advisory(severity);
  from = requests.length;
  r = await stage();
  const exit = severity === "info" ? r.exec?.code === 0 && !exited.test(r.reasons) : exited.test(r.reasons);
  const via = parsed(r.exec?.stdout ?? "")?.vulnerabilities?.["fx-pkg"]?.via?.[0];
  const detailed = via?.severity === severity && via?.url === advisories["fx-pkg"][0].url;
  const named = `npm audit stage fails ${severity === "info" ? "an" : "a"} ${severity} advisory and shows the report`;
  check(named, askedFor(from) && stageFails(r, found(severity)) && exit && detailed, show(r, from));
}

advisories = {};
from = requests.length;
r = await stage({ registry: `${base}/selected/` });
check(
  "npm audit stage asks the selected registry",
  stagePasses(r) && askedFor(from, "/selected") && bulkPosts(from).length === 0,
  show(r, from),
);

for (const [label, mode] of [
  ["a 500 response", 500],
  ["a 404 response", 404],
  ["an answer that is not JSON", "garbage"],
]) {
  registryMode = mode;
  from = requests.length;
  r = await stage();
  registryMode = "ok";
  check(`npm audit stage fails a registry error: ${label}`, askedFor(from) && stageFails(r, exited), show(r, from));
}

// A port just released has no listener, so the advisory request is refused.
const closed = createServer();
await new Promise((ok) => closed.listen(0, "127.0.0.1", ok));
const closedPort = closed.address().port;
await new Promise((ok) => closed.close(ok));
r = await stage({ registry: `http://127.0.0.1:${closedPort}/` });
check("npm audit stage fails an unreachable registry", stageFails(r, exited), show(r));

// Inventories npm audit cannot cover in full are refused before the audit runner is called.
const root = { name: "fx", version: "1.0.0", dependencies: { "fx-pkg": "1.0.0" } };
const noneSent = /^ {2}the lockfile lists no package npm audit would send the registry$/mu;
const notPrepared = /^ {2}npm audit inventory could not be prepared from the lockfile: /mu;
const lockOf = (packages) => `${JSON.stringify({ name: "fx", lockfileVersion: 3, requires: true, packages })}\n`;
let refusedCount = 0;
const installed = {
  "node_modules/fx-pkg/package.json": `${JSON.stringify({ name: "fx-pkg", version: "1.0.0" })}\n`,
  "node_modules/.package-lock.json": lockOf({ "node_modules/fx-pkg": { version: "1.0.0" } }),
};
for (const [label, opts, why] of [
  ["an unreadable package.json", { files: { "package.json": "{ not json\n" } }, /^ {2}package\.json could not be read: /mu],
  ["a package.json that is not an object", { files: { "package.json": "[]\n" } }, /^ {2}package\.json is not an object$/mu],
  [
    "a root-only lockfile",
    { manifest: { dependencies: {} }, packages: { "": { name: "fx", version: "1.0.0" } } },
    noneSent,
  ],
  [
    "a lockfile of links only",
    {
      spec: "file:fx-link",
      packages: {
        "": { ...root, dependencies: { "fx-pkg": "file:fx-link" } },
        "node_modules/fx-pkg": { resolved: "fx-link", link: true },
        "fx-link": { name: "fx-pkg", version: "1.0.0" },
      },
      files: { "fx-link/package.json": `${JSON.stringify({ name: "fx-pkg", version: "1.0.0" })}\n` },
    },
    noneSent,
  ],
  [
    "a lockfile without versions",
    { packages: { "": root, "node_modules/fx-pkg": { resolved: `${base}/fx-pkg-1.0.0.tgz` } } },
    noneSent,
  ],
  ["a missing lockfile beside an installed tree", { lockText: null, files: installed }, /ENOLOCK/u],
  ["a corrupt lockfile", { lockText: "{ not json\n", files: installed }, notPrepared],
  // The shrinkwrap names a fixed version, so auditing it instead of the lockfile would pass.
  ["an npm-shrinkwrap.json", { shrinkwrap: "1.0.1" }, /^ {2}npm-shrinkwrap\.json exists, /mu],
  ["package.json declaring workspaces", { manifest: { workspaces: ["packages/*"] } }, /^ {2}package\.json declares workspaces$/mu],
]) {
  advisories = advisory("low");
  from = requests.length;
  r = await stage({ dir: fixtureProject(`fx-refused-${String(++refusedCount)}`, opts) });
  check(`npm audit stage refuses ${label}`, stageRefuses(r, why) && bulkPosts(from).length === 0, show(r, from));
}

// The check run reports the stage this way when Node or npm is missing.
r = await stage({ source: stageModule(`npmAuditNotRun(["needs Node and npm (see above)"]);`) });
check(
  "npm audit stage reports a missing npm as not run",
  stageRefuses(r, /^ {2}needs Node and npm \(see above\)$/mu),
  show(r),
);

// An inherited workspace selection is dropped, so the whole lockfile is still audited.
for (const [key, value] of [
  ["npm_config_workspace", "fx-ws"],
  ["NPM_CONFIG_WORKSPACE", "fx-ws"],
  ["Npm_Config_Workspace", "fx-ws"],
  ["npm_config_workspaces", "true"],
  ["NPM_CONFIG_WORKSPACES", "true"],
  ["nPm_cOnFiG_wOrKsPaCeS", "true"],
]) {
  advisories = advisory("low");
  from = requests.length;
  r = await stage({ env: { [key]: value } });
  check(
    `npm audit stage audits the whole lockfile despite ${key}=${value}`,
    askedFor(from) && stageFails(r, found("low")) && exited.test(r.out),
    show(r, from),
  );
}

// npm refuses an npmrc workspace selection beside --workspaces=false; a narrower audit would pass here.
const workspaceUser = join(work, "workspace-user.npmrc");
writeFileSync(workspaceUser, "workspace=fx-ws\n");
const workspaceGlobal = join(work, "workspace-global.npmrc");
writeFileSync(workspaceGlobal, "workspace=fx-ws\n");
for (const [label, opts] of [
  ["project npmrc", { dir: fixtureProject("fx-ws-project", { npmrc: "workspace=fx-ws\n" }) }],
  ["user npmrc", { env: { npm_config_userconfig: workspaceUser } }],
  ["global npmrc", { env: { npm_config_globalconfig: workspaceGlobal } }],
]) {
  advisories = advisory("low");
  from = requests.length;
  r = await stage(opts);
  check(`npm audit stage never passes a workspace selection in the ${label}`, stageFails(r, exited), show(r, from));
}

// Without the lockfile npm would resolve ^1.0.0 to the fixed 1.0.1 and find nothing.
for (const [label, opts] of [
  ["package-lock=false in the env", { dir: fixtureProject("fx-caret", { spec: "^1.0.0" }), env: { npm_config_package_lock: "false" } }],
  ["package-lock=false in the project npmrc", { dir: fixtureProject("fx-caret-npmrc", { spec: "^1.0.0", npmrc: "package-lock=false\n" }) }],
]) {
  advisories = advisory("low");
  from = requests.length;
  r = await stage(opts);
  check(`npm audit stage audits the lockfile despite ${label}`, askedFor(from) && stageFails(r, found("low")), show(r, from));
}

// Each inherited setting below would skip the registry, answer from the cache or leave a
// dependency type out; the stage must still ask the stand-in registry and fail on its advisory.
const npmrcFile = (name, text) => {
  const file = join(work, name);
  writeFileSync(file, text);
  return file;
};
const devProject = fixtureProject("fx-dev", { type: "devDependencies" });
const optionalProject = fixtureProject("fx-optional", { type: "optionalDependencies" });
const peerProject = fixtureProject("fx-peer", { type: "peerDependencies" });
for (const [label, opts] of [
  ["lowercase offline env", { env: { npm_config_offline: "true" } }],
  ["uppercase offline env", { env: { NPM_CONFIG_OFFLINE: "true" } }],
  ["project npmrc offline", { dir: fixtureProject("fx-offline", { npmrc: "offline=true\n" }) }],
  ["user npmrc offline", { env: { npm_config_userconfig: npmrcFile("offline-user.npmrc", "offline=true\n") } }],
  ["global npmrc offline", { env: { npm_config_globalconfig: npmrcFile("offline-global.npmrc", "offline=true\n") } }],
  ["prefer-offline env", { env: { npm_config_prefer_offline: "true" } }],
  ["project npmrc prefer-offline", { dir: fixtureProject("fx-prefer", { npmrc: "prefer-offline=true\n" }) }],
  ["user npmrc prefer-offline", { env: { npm_config_userconfig: npmrcFile("prefer-user.npmrc", "prefer-offline=true\n") } }],
  [
    "global npmrc prefer-offline",
    { env: { npm_config_globalconfig: npmrcFile("prefer-global.npmrc", "prefer-offline=true\n") } },
  ],
  ["omit env on a dev dependency", { dir: devProject, env: { npm_config_omit: "dev" } }],
  ["NODE_ENV production on a dev dependency", { dir: devProject, env: { NODE_ENV: "production" } }],
  ["omit env on an optional dependency", { dir: optionalProject, env: { npm_config_omit: "optional" } }],
  ["omit env on a peer dependency", { dir: peerProject, env: { npm_config_omit: "peer" } }],
  ["project npmrc omit on a dev dependency", { dir: fixtureProject("fx-omit-dev", { type: "devDependencies", npmrc: "omit=dev\n" }) }],
  [
    "user npmrc omit on an optional dependency",
    { dir: optionalProject, env: { npm_config_userconfig: npmrcFile("omit-user.npmrc", "omit=optional\n") } },
  ],
  [
    "global npmrc omit on a peer dependency",
    { dir: peerProject, env: { npm_config_globalconfig: npmrcFile("omit-global.npmrc", "omit=peer\n") } },
  ],
]) {
  advisories = advisory("low");
  from = requests.length;
  r = await stage(opts);
  check(
    `npm audit stage asks the registry despite ${label}`,
    askedFor(from) && stageFails(r, exited) && stageFails(r, found("low")),
    show(r, from),
  );
}

// Injected outcomes: only stdout is read as the report, only a valid report with nothing found
// passes, and every failure shows both streams exactly as the runner returned them.
const injected = ({ code = 0, signal = null, stdout = "", stderr = "" }) =>
  `() => (${JSON.stringify({ code, signal, stdout, stderr, out: `${stdout}${stderr}` })})`;
const reportText = (edit = () => {}) => {
  const data = {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      dependencies: { prod: 1, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 },
    },
  };
  edit(data);
  return `${JSON.stringify(data, null, 2)}\n`;
};
const counts = (d, values) => Object.assign(d.metadata.vulnerabilities, values);
const lowFound = (d) => {
  d.vulnerabilities["fx-pkg"] = { name: "fx-pkg", severity: "low" };
  counts(d, { low: 1, total: 1 });
};
// A report as npm prints it, with advisory details the FAIL summary leaves out.
const vulnerable = (severity) => (d) => {
  const url = `https://example.invalid/advisories/fixture-${severity}`;
  const via = [{ source: 7, name: "fx-pkg", title: `Fixture ${severity} advisory`, url, severity, range: "<1.0.1" }];
  d.vulnerabilities["fx-pkg"] = { name: "fx-pkg", severity, isDirect: true, via, effects: [], range: "<1.0.1" };
  counts(d, { [severity]: 1, total: 1 });
};
for (const severity of severities) {
  // npm exits 0 on an info advisory at --audit-level=low and 1 above it.
  const code = severity === "info" ? 0 : 1;
  const result = { code, stdout: reportText(vulnerable(severity)), stderr: `npm warn fixture ${severity} stderr\n` };
  r = await stage({ runner: injected(result) });
  check(
    `npm audit stage shows the whole ${severity} report and its stderr after exit ${String(code)}`,
    stageFails(r, found(severity)) &&
      r.exec?.stdout === result.stdout &&
      r.exec?.stderr === result.stderr &&
      r.records[0]?.text?.includes(`fixture-${severity}`),
    show(r),
  );
}

const noJson = /^ {2}npm audit did not print a JSON report$/mu;
const notCounts = /^ {2}npm audit report counts are not all non-negative integers$/mu;
const mismatch = /^ {2}npm audit report counts do not match its vulnerabilities$/mu;
const noDependencies = /^ {2}npm audit report lists no dependencies$/mu;
for (const [label, result, why] of [
  ["positive counts after exit 0", { stdout: reportText(lowFound) }, found("low")],
  ["a clean report after exit 1", { code: 1, stdout: reportText() }, /^ {2}npm audit exited 1$/mu],
  ["truncated JSON", { stdout: '{"auditReportVersion": 2,' }, noJson],
  ["no output", { stdout: "" }, noJson],
  ["a text report", { stdout: "found 0 vulnerabilities\n" }, noJson],
  ["a text preamble before the report", { stdout: `> fx@1.0.0 audit\n${reportText()}` }, noJson],
  ["no info count", { stdout: reportText((d) => delete d.metadata.vulnerabilities.info) }, /counts have the keys /u],
  ["an extra count", { stdout: reportText((d) => counts(d, { none: 0 })) }, /counts have the keys /u],
  ["no vulnerabilities map", { stdout: reportText((d) => delete d.vulnerabilities) }, /has no vulnerabilities map$/mu],
  ["a vulnerabilities list", { stdout: reportText((d) => (d.vulnerabilities = [])) }, /has no vulnerabilities map$/mu],
  ["no metadata", { stdout: reportText((d) => delete d.metadata) }, /has no vulnerability counts$/mu],
  ["a counts list", { stdout: reportText((d) => (d.metadata.vulnerabilities = [])) }, /has no vulnerability counts$/mu],
  ["no dependency total", { stdout: reportText((d) => delete d.metadata.dependencies) }, noDependencies],
  ["a zero dependency total", { stdout: reportText((d) => (d.metadata.dependencies.total = 0)) }, noDependencies],
  ["a text dependency total", { stdout: reportText((d) => (d.metadata.dependencies.total = "1")) }, noDependencies],
  ["a text count", { stdout: reportText((d) => counts(d, { info: "0" })) }, notCounts],
  ["a negative count", { stdout: reportText((d) => counts(d, { low: -1, total: -1 })) }, notCounts],
  ["a fractional count", { stdout: reportText((d) => counts(d, { low: 0.5, total: 0.5 })) }, notCounts],
  ["a total above the counts", { stdout: reportText((d) => counts(d, { total: 1 })) }, mismatch],
  [
    "a vulnerability with zero counts",
    { stdout: reportText((d) => (d.vulnerabilities["fx-pkg"] = { name: "fx-pkg", severity: "low" })) },
    mismatch,
  ],
  ["report version 1", { stdout: reportText((d) => (d.auditReportVersion = 1)) }, /version is 1, not 2$/mu],
  ["no report version", { stdout: reportText((d) => delete d.auditReportVersion) }, /version is undefined, not 2$/mu],
  ["a JSON list", { stdout: "[]\n" }, /^ {2}npm audit report is not an object$/mu],
  [
    "an npm error report",
    { code: 1, stdout: `${JSON.stringify({ error: { code: "ENOLOCK", summary: "lockfile required" } })}\n` },
    /version is undefined, not 2$/mu,
  ],
  [
    "an audit endpoint error report",
    { code: 1, stdout: `${JSON.stringify({ message: "500 Internal Server Error", method: "POST", statusCode: 500 })}\n` },
    /version is undefined, not 2$/mu,
  ],
]) {
  r = await stage({ runner: injected({ stderr: `npm warn fixture stderr for ${label}\n`, ...result }) });
  check(`npm audit stage fails ${label} and shows both streams`, stageFails(r, why), show(r));
}

// Either stream or both may be empty; an empty stream is shown as an empty block, never filled in.
for (const [label, result, why] of [
  ["empty stdout beside stderr", { code: 1, stderr: "npm error fixture failure\n" }, exited],
  ["a vulnerable report with empty stderr", { stdout: reportText(lowFound) }, found("low")],
  ["text on stdout with empty stderr", { code: 1, stdout: "fixture text\n" }, noJson],
  ["both streams empty", { code: 1 }, exited],
]) {
  r = await stage({ runner: injected(result) });
  check(`npm audit stage shows ${label} as captured`, stageFails(r, why), show(r));
}

// Text a trimming or normalising renderer would change, and status words npm's own text may hold.
const oddStdout =
  "﻿{\r\n\r\n  \"x\": 1  \r\n\tü✓\u{1D11E}\nFAIL npm audit\nPASS npm audit\n  end of npm audit stdout\n" +
  "  npm audit stderr, 3 bytes:\nno final newline  ";
const oddStderr = "\r\n  stderr é \u{1F600}  \r\nPASS npm audit\n\n\nlast line without a newline \t";
r = await stage({ runner: injected({ code: 1, stdout: oddStdout, stderr: oddStderr }) });
check(
  "npm audit stage shows CRLF, blank lines, edge spaces, Unicode and no final newline unchanged",
  stageFails(r, noJson) && r.exec?.stdout === oddStdout && r.exec?.stderr === oddStderr,
  show(r),
);
const crlfReport = `${reportText(lowFound).replace(/\n/gu, "\r\n").trimEnd()}  `;
const crlfStderr = "  npm warn é fixture  \r\n\r\n";
r = await stage({ runner: injected({ stdout: crlfReport, stderr: crlfStderr }) });
check(
  "npm audit stage shows a valid CRLF report without a final newline unchanged",
  stageFails(r, found("low")) && r.exec?.stdout === crlfReport && r.exec?.stderr === crlfStderr,
  show(r),
);

r = await stage({ runner: injected({ stdout: reportText(), stderr: "npm warn fixture warning\n" }) });
check(
  "npm audit stage passes a clean report beside a stderr warning and shows it",
  stagePasses(r) && /^ {2}npm warn fixture warning$/mu.test(r.reasons),
  show(r),
);

r = await stage({ runner: `(cmd, args, opts) => exec(${JSON.stringify(join(work, "no-such-program"))}, [], opts)` });
check(
  "npm audit stage fails when npm cannot start",
  stageFails(r, /^ {2}npm audit did not complete \(.*ENOENT.*\)$/mu) && r.exec?.stdout === "" && r.exec?.stderr === "",
  show(r),
);

const partial = '{"auditReportVersion": 2, "vulnerabilities": {';
r = await stage({ runner: injected({ code: null, signal: "SIGKILL", stdout: partial, stderr: "npm http fixture\n" }) });
check(
  "npm audit stage fails a run killed by a signal and shows what it captured",
  stageFails(r, /^ {2}npm audit did not complete \(killed by SIGKILL\)$/mu),
  show(r),
);

// The stage's own limit, shortened so the case ends quickly, on a program that never finishes.
const sleeper = `(cmd, args, opts) => exec(process.execPath, ["-e", "setTimeout(() => {}, 60000)"],
  { ...opts, timeout: Math.min(opts.timeout, 1000) })`;
r = await stage({ runner: sleeper });
check("npm audit stage fails a run that times out", stageFails(r, /ETIMEDOUT/u), show(r));

// Real children that write and then hang or overfill a buffer. The blocks must be what that exec
// call returned, and exec must have kept what was written before the error.
const writer = (program, limits) =>
  `(cmd, args, opts) => exec(process.execPath, ["-e", ${JSON.stringify(program)}], { ...opts, ...${JSON.stringify(limits)} })`;
const hang = "setTimeout(() => {}, 60000);";
for (const [label, out, err] of [
  ["a complete clean report", reportText(), "npm warn fixture before the timeout\n"],
  ["a partial report", partial, "npm http fixture partial\n"],
]) {
  const program = `process.stdout.write(${JSON.stringify(out)}); process.stderr.write(${JSON.stringify(err)}); ${hang}`;
  r = await stage({ runner: writer(program, { timeout: 5000 }) });
  check(
    `npm audit stage shows ${label} and stderr written before a timeout`,
    stageFails(r, /^ {2}npm audit did not complete \(.*ETIMEDOUT.*\)$/mu) && r.exec?.stdout === out && r.exec?.stderr === err,
    show(r),
  );
}
for (const name of ["stdout", "stderr"]) {
  const program = `process.stdout.write("OUT-HEAD\\n"); process.stderr.write("ERR-HEAD\\n");
setTimeout(() => process.${name}.write("x".repeat(65536)), 500); ${hang}`;
  r = await stage({ runner: writer(program, { timeout: 10000, maxBuffer: 4096 }) });
  check(
    `npm audit stage shows the streams exec kept when ${name} overfills its buffer`,
    stageFails(r, /^ {2}npm audit did not complete \(.*ENOBUFS.*\)$/mu) &&
      r.exec?.stdout.startsWith("OUT-HEAD\n") &&
      r.exec?.stderr.startsWith("ERR-HEAD\n"),
    show(r),
  );
}

decoy.close();
server.close();
process.exitCode = failed > 0 ? 1 : 0;
