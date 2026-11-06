// npm audit cases for both test suites: the audit script from web/package.json runs against a
// fixture lockfile and a local stand-in registry, so the threshold is tested without the network.
// Usage: node tools/tests/npm-audit-cases.mjs <empty work directory>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
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

let advisories = {};
const requests = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    requests.push(`${req.method} ${req.url}`);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && req.url === "/-/npm/v1/security/advisories/bulk") {
      const raw = Buffer.concat(chunks);
      const asked = JSON.parse(
        (req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString("utf8"),
      );
      send(200, Object.fromEntries(Object.entries(advisories).filter(([name]) => name in asked)));
    } else if (req.method === "GET" && req.url === "/fx-pkg") {
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

const project = join(work, "fx");
mkdirSync(project, { recursive: true });
const manifest = { name: "fx", version: "1.0.0", private: true, dependencies: { "fx-pkg": "1.0.0" } };
writeFileSync(join(project, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const lock = {
  name: "fx",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": { name: "fx", version: "1.0.0", dependencies: { "fx-pkg": "1.0.0" } },
    "node_modules/fx-pkg": { version: "1.0.0", resolved: `${base}/fx-pkg-1.0.0.tgz` },
  },
};
writeFileSync(join(project, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
const userConfig = join(work, "user.npmrc");
const globalConfig = join(work, "global.npmrc");
writeFileSync(userConfig, "");
writeFileSync(globalConfig, "");

// The user's npm configuration and cache stay out, so only the stand-in registry answers. Every
// inherited npm_config_ variable goes in any letter case: npm reads them case-insensitively, and
// on Windows an uppercase duplicate can win over the fixture's lowercase value.
function audit(inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([k]) => !/^npm_config_/i.test(k)));
  return new Promise((done) => {
    const child = spawn(script, {
      cwd: project,
      shell: true,
      env: {
        ...env,
        npm_config_registry: `${base}/`,
        npm_config_userconfig: userConfig,
        npm_config_globalconfig: globalConfig,
        npm_config_cache: join(work, "cache"),
        npm_config_update_notifier: "false",
        npm_config_fund: "false",
      },
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => done({ code, out }));
  });
}

const advisory = (severity) => ({
  "fx-pkg": [
    {
      id: 1,
      url: "https://example.invalid/advisories/1",
      title: "Fixture advisory",
      severity,
      vulnerable_versions: "<1.0.1",
      cwe: [],
      cvss: { score: 0, vectorString: null },
    },
  ],
});

check("npm audit script is npm audit", /^npm audit( |$)/.test(script), script);

advisories = {};
let r = await audit();
check("npm audit passes with no advisories", r.code === 0, `exit ${r.code}\n${r.out}`);

advisories = advisory("low");
r = await audit();
const asked = requests.some((q) => q.startsWith("POST /-/npm/v1/security/advisories/bulk"));
check(
  "npm audit fails a low-severity advisory",
  asked && r.code !== 0 && /\b1 low severity vulnerability\b/.test(r.out),
  `exit ${r.code}\n${r.out}\n${requests.join("\n")}`,
);

const decoyHits = [];
const decoy = createServer((req, res) => {
  decoyHits.push(`${req.method} ${req.url}`);
  res.writeHead(500);
  res.end();
});
await new Promise((ok) => decoy.listen(0, "127.0.0.1", ok));
const sentinelCache = join(work, "sentinel-cache");
const before = requests.length;
r = await audit({
  ...process.env,
  NPM_CONFIG_REGISTRY: `http://127.0.0.1:${decoy.address().port}/`,
  NPM_CONFIG_CACHE: sentinelCache,
  NPM_CONFIG_USERCONFIG: join(work, "sentinel-user.npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(work, "sentinel-global.npmrc"),
});
const standInAsked = requests
  .slice(before)
  .some((q) => q.startsWith("POST /-/npm/v1/security/advisories/bulk"));
check(
  "npm audit ignores inherited uppercase npm config",
  standInAsked &&
    decoyHits.length === 0 &&
    !existsSync(sentinelCache) &&
    r.code !== 0 &&
    /\b1 low severity vulnerability\b/.test(r.out),
  `exit ${r.code}\n${r.out}\nstand-in: ${requests.slice(before).join(", ")}\ndecoy: ${decoyHits.join(", ")}`,
);

decoy.close();
server.close();
process.exitCode = failed > 0 ? 1 : 0;
