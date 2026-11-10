// Provisions the pinned Playwright browser builds for Windows into the fixed browsers path,
// then launches each engine and checks its exact version.
// Usage: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 node tools/install-browsers.mjs
// Archive bytes are untrusted until their length and SHA-256 match tools/tool-pins.json; nothing is
// listed, extracted or launched before that, and an earlier extraction is rebuilt, never reused.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkDigest } from "./digest.mjs";

export const requiredBuilds = ["chromium", "chromium-headless-shell", "firefox", "webkit", "ffmpeg", "winldd"];
const engines = new Set(["chromium", "chromium-headless-shell", "firefox", "webkit"]);
const PLAYWRIGHT_PACKAGES = ["@playwright/test", "playwright", "playwright-core"];
const hosts = new Set(["cdn.playwright.dev", "playwright.download.prss.microsoft.com", "storage.googleapis.com"]);
// Playwright writes this after its own host check at launch; anything else it might write is refused.
const launchMarker = "DEPENDENCIES_VALIDATED";
// Any download Playwright itself attempts goes to a closed local port and fails.
const closedHost = "http://127.0.0.1:9";
const segment = /^[A-Za-z0-9_][A-Za-z0-9 ._+()@-]*$/;
const device = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

function fail(message) {
  throw new Error(message);
}

function fixedPath(value, key) {
  if (typeof value !== "string" || !/^\.tools\/[a-z0-9-]+$/.test(value)) {
    fail(`tools/tool-pins.json: playwright.windows.${key} must be a fixed folder under .tools`);
  }
  return value;
}

// Returns the six pinned Windows builds; a missing, extra or malformed pin is refused.
export function pinnedBuilds(pins) {
  const win = pins.playwright?.windows;
  const builds = win?.builds ?? {};
  for (const name of Object.keys(builds)) {
    if (!requiredBuilds.includes(name)) fail(`tools/tool-pins.json: unpinned build ${name} is not allowed`);
  }
  for (const name of requiredBuilds) {
    const b = builds[name];
    if (!b) fail(`tools/tool-pins.json: no pin for ${name}`);
    const where = `tools/tool-pins.json: ${name}`;
    if (!/^[0-9]+$/.test(b.revision ?? "")) fail(`${where} needs a revision`);
    if (b.dir !== `${name.replaceAll("-", "_")}-${b.revision}`) fail(`${where} dir must be the revision directory`);
    if (!/^[0-9a-f]{64}$/.test(b.sha256 ?? "")) fail(`${where} needs a SHA-256`);
    if (!Number.isSafeInteger(b.bytes) || b.bytes <= 0) fail(`${where} needs a byte length`);
    if (!/^[a-z0-9-]+\.zip$/.test(b.archive ?? "")) fail(`${where} needs an archive name`);
    if (engines.has(name) && typeof b.browserVersion !== "string") fail(`${where} needs a browser version`);
    if (b.root !== "" && !(typeof b.root === "string" && segment.test(b.root))) fail(`${where} root is not a folder name`);
    checkEntry(name, b.executable ?? "", b.root);
    if (!Array.isArray(b.urls) || b.urls.length === 0) fail(`${where} needs at least one url`);
    for (const u of b.urls) {
      const url = new URL(u);
      if (url.protocol !== "https:" || !hosts.has(url.host) || url.pathname.split("/").pop() !== b.archive) {
        fail(`${where} url ${u} is not a recorded archive source`);
      }
    }
  }
  return {
    builds,
    browsersPath: fixedPath(win.browsersPath, "browsersPath"),
    archiveCache: fixedPath(win.archiveCache, "archiveCache"),
  };
}

// The package, lockfile, installed core and image tag must all name the pinned release and builds.
export function checkAlignment(pins, webDir, { installed = true } = {}) {
  const pw = pins.playwright ?? {};
  const v = pw.version;
  const read = (p) => JSON.parse(readFileSync(join(webDir, p), "utf8"));
  const pkg = read("package.json");
  if (pkg.devDependencies?.["@playwright/test"] !== v) {
    fail(`web/package.json: @playwright/test is ${pkg.devDependencies?.["@playwright/test"]}, pinned ${v}`);
  }
  const pinned = Object.keys(pw.packages ?? {}).sort();
  if (pinned.join() !== PLAYWRIGHT_PACKAGES.join()) {
    fail(`tools/tool-pins.json: playwright packages are ${pinned.join(", ")}, not ${PLAYWRIGHT_PACKAGES.join(", ")}`);
  }
  const lock = read("package-lock.json");
  for (const [name, integrity] of Object.entries(pw.packages)) {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (entry?.version !== v || entry?.integrity !== integrity) {
      fail(`web/package-lock.json: ${name} ${entry?.version} does not match the pinned ${v} and integrity`);
    }
  }
  // A recorded bin collision between pinned packages must name the pinned release.
  for (const record of read("bin-collisions.json")) {
    for (const d of record.declarers) {
      if (Object.hasOwn(pw.packages, d.name) && (d.path !== `node_modules/${d.name}` || d.version !== v || d.integrity !== pw.packages[d.name])) {
        fail(`web/bin-collisions.json: ${d.name} at ${d.path} ${d.version} does not match the pinned ${v} and integrity`);
      }
    }
  }
  if (pw.image?.tag !== `v${v}-noble`) fail(`tools/tool-pins.json: image tag ${pw.image?.tag} is not v${v}-noble`);
  if (!installed) return;
  for (const name of PLAYWRIGHT_PACKAGES) {
    const installedVersion = read(`node_modules/${name}/package.json`).version;
    if (installedVersion !== v) fail(`installed ${name} ${installedVersion} is not the pinned ${v}`);
  }
  const shipped = new Map(read("node_modules/playwright-core/browsers.json").browsers.map((b) => [b.name, b]));
  for (const [name, b] of Object.entries(pins.playwright.windows.builds)) {
    const s = shipped.get(name);
    if (s?.revision !== b.revision || (engines.has(name) && s?.browserVersion !== b.browserVersion)) {
      fail(`${name}: playwright-core ${v} expects revision ${s?.revision} ${s?.browserVersion ?? ""}, pinned ${b.revision}`);
    }
  }
}

// Returns the entry as a relative path; a name that is not plainly inside the build is refused.
export function checkEntry(name, entry, root) {
  if (entry === "") fail(`${name}: empty archive entry`);
  if (/^[A-Za-z]:/.test(entry)) fail(`${name}: archive entry ${entry} is drive-qualified`);
  if (entry.startsWith("/") || entry.startsWith("\\")) fail(`${name}: archive entry ${entry} is absolute`);
  if (entry.includes("\\")) fail(`${name}: archive entry ${entry} has a backslash`);
  const parts = (entry.endsWith("/") ? entry.slice(0, -1) : entry).split("/");
  if (parts.includes("..")) fail(`${name}: archive entry ${entry} has a parent segment`);
  for (const p of parts) {
    // Windows drops trailing dots and spaces and maps device names, so such names could alias.
    if (!segment.test(p) || /[ .]$/.test(p) || device.test(p)) fail(`${name}: archive entry ${entry} has a disallowed name`);
  }
  if (root !== "" && parts[0] !== root) fail(`${name}: archive entry ${entry} is outside ${root}/`);
  return parts.join("/");
}

function checkEntries(name, build, entries) {
  const files = new Set();
  const all = new Set();
  const seen = new Set();
  for (const e of entries) {
    const rel = checkEntry(name, e, build.root);
    // NTFS ignores case, so two names differing only in case would overwrite each other.
    if (seen.has(rel.toLowerCase())) fail(`${name}: archive entry ${e} is repeated`);
    seen.add(rel.toLowerCase());
    if (!e.endsWith("/")) files.add(rel);
    const parts = rel.split("/");
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join("/"));
  }
  if (!files.has(build.executable)) fail(`${name}: the archive has no ${build.executable}`);
  return { files, all };
}

// The extracted tree must be exactly the verified listing; anything the extractor added or recovered fails.
function compareTree(name, dir, listing) {
  const found = new Set();
  const walk = (rel) => {
    for (const n of readdirSync(join(dir, rel))) {
      const r = rel === "" ? n : `${rel}/${n}`;
      const st = lstatSync(join(dir, r));
      if (st.isSymbolicLink()) fail(`${name}: extracted ${r} is a link`);
      if (!listing.all.has(r)) fail(`${name}: extracted ${r} is not in the verified listing`);
      if (listing.files.has(r) !== st.isFile()) fail(`${name}: extracted ${r} has the wrong type`);
      found.add(r);
      if (st.isDirectory()) walk(r);
    }
  };
  walk("");
  for (const r of listing.all) if (!found.has(r)) fail(`${name}: ${r} is missing after extraction`);
}

export function verifyArchive(name, build, data) {
  if (data.length !== build.bytes) fail(`${name}: length mismatch (expected ${build.bytes} bytes, got ${data.length})`);
  checkDigest(name, { sha256: build.sha256 }, data);
}

async function download(name, build, fetchImpl) {
  const errors = [];
  for (const url of build.urls) {
    let res;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
      continue;
    }
    if (!res.ok) {
      errors.push(`${url}: HTTP ${res.status}`);
      continue;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > build.bytes) fail(`${name}: length mismatch (more than ${build.bytes} bytes from ${url})`);
      chunks.push(chunk);
    }
    // A source that serves wrong bytes fails the run rather than falling through to the next one.
    const data = Buffer.concat(chunks);
    verifyArchive(name, build, data);
    return data;
  }
  return fail(`${name}: no recorded source answered (${errors.join("; ")})`);
}

// Only verified archives are cached, and a cached archive is verified again before every use.
async function obtainArchive(name, build, cacheDir, fetchImpl) {
  const file = join(cacheDir, `${build.dir}-${build.archive}`);
  if (existsSync(file)) {
    const data = readFileSync(file);
    try {
      verifyArchive(name, build, data);
    } catch (err) {
      fail(`${err.message}; the cached archive ${build.dir}-${build.archive} is refused`);
    }
    return data;
  }
  const data = await download(name, build, fetchImpl);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
  return data;
}

// The browsers path holds exactly the pinned build directories; a stock-installer artefact fails.
export function checkLayout(browsersPath, builds) {
  if (!existsSync(browsersPath)) fail(`browsers path ${browsersPath} is missing`);
  const dirs = new Set(Object.values(builds).map((b) => b.dir));
  for (const n of readdirSync(browsersPath)) {
    if (!dirs.has(n)) fail(`browsers path has unpinned entry ${n}`);
  }
  for (const [name, b] of Object.entries(builds)) {
    const dir = join(browsersPath, b.dir);
    if (!existsSync(dir)) fail(`${name}: build ${b.dir} is missing`);
    if (existsSync(join(dir, "INSTALLATION_COMPLETE"))) fail(`${name}: ${b.dir} has a stock installer marker`);
    if (b.root !== "") {
      for (const n of readdirSync(dir)) {
        if (n !== b.root && n !== launchMarker) fail(`${name}: ${b.dir} has unpinned entry ${n}`);
      }
    }
    const exe = join(dir, b.executable);
    if (!existsSync(exe) || !lstatSync(exe).isFile()) fail(`${name}: ${b.dir}/${b.executable} is missing`);
  }
}

// The environment every browser process runs under: the fixed path, and no download at all.
export function browserEnv(browsersPath) {
  return {
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    PLAYWRIGHT_DOWNLOAD_HOST: closedHost,
    PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: closedHost,
    PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST: closedHost,
    PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST: closedHost,
  };
}

function checkEnv(env, browsersPath) {
  if (env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== "1") {
    fail("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD must be 1; a Playwright browser download is never allowed");
  }
  const preset = env.PLAYWRIGHT_BROWSERS_PATH;
  if (preset !== undefined && preset !== "" && !samePath(preset, browsersPath)) {
    fail(`PLAYWRIGHT_BROWSERS_PATH ${preset} is not the pinned browsers path`);
  }
}

// Windows CI temp paths are 8.3 short names, so both sides are resolved before comparing.
function samePath(a, b) {
  const real = (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  const fold = (p) => (process.platform === "win32" ? real(p).toLowerCase() : real(p));
  return fold(a) === fold(b);
}

const launches = [
  { name: "chromium", type: "chromium", options: { channel: "chromium" } },
  { name: "chromium-headless-shell", type: "chromium", options: {} },
  { name: "firefox", type: "firefox", options: {} },
  { name: "webkit", type: "webkit", options: {} },
];

// Starts each engine through Playwright's own discovery and checks it is the pinned executable and version.
export async function launchCheck(playwright, browsersPath, builds) {
  const results = [];
  for (const l of launches) {
    const b = builds[l.name];
    const type = playwright[l.type];
    const server = await type.launchServer({ ...l.options, headless: true });
    let exe;
    let version;
    try {
      exe = server.process().spawnfile;
      const browser = await type.connect(server.wsEndpoint());
      version = browser.version();
      await browser.close();
    } finally {
      await server.close();
    }
    const want = join(browsersPath, b.dir, b.executable);
    if (!samePath(exe, want)) fail(`${l.name}: launched ${exe}, not the pinned ${b.dir}/${b.executable}`);
    if (version !== b.browserVersion) fail(`${l.name}: launch reports version ${version}, pinned ${b.browserVersion}`);
    results.push(`${l.name} ${version} from ${b.dir}/${b.executable}`);
  }
  return results;
}

// Lists and extracts with the system bsdtar; any warning or non-zero exit is a failure, not a recovery.
export function zipTool(tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")) {
  const run = (args) => {
    const r = spawnSync(tar, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0 || r.stderr.trim() !== "") fail(`tar ${args[0]} failed: ${r.stderr.trim()}`);
    return r.stdout;
  };
  return {
    list: (file) => run(["-tf", file]).split(/\r?\n/).filter((l) => l !== ""),
    extract: (file, dest) => {
      mkdirSync(dest, { recursive: true });
      run(["-xf", file, "-C", dest]);
    },
  };
}

export async function provision({ pins, root, env, playwright, fetchImpl = fetch, archive = zipTool(), log = () => {} }) {
  const { builds, browsersPath, archiveCache } = pinnedBuilds(pins);
  const target = join(root, browsersPath);
  checkEnv(env, target);
  checkAlignment(pins, join(root, "web"));
  const cacheDir = join(root, archiveCache);
  mkdirSync(cacheDir, { recursive: true });
  const staging = `${target}.tmp-${process.pid}`;
  const aside = `${target}.old-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  try {
    for (const name of requiredBuilds) {
      const b = builds[name];
      const data = await obtainArchive(name, b, cacheDir, fetchImpl);
      log(`verified ${b.dir} ${b.archive}: ${b.bytes} bytes, SHA-256 ${b.sha256}`);
      const work = join(staging, `${b.dir}.zip`);
      mkdirSync(staging, { recursive: true });
      writeFileSync(work, data);
      const listing = checkEntries(name, b, archive.list(work));
      const dest = join(staging, b.dir);
      archive.extract(work, dest);
      rmSync(work);
      compareTree(name, dest, listing);
    }
    checkLayout(staging, builds);
    if (existsSync(target)) renameSync(target, aside);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(aside, { recursive: true, force: true });
  }
  log(`extracted ${requiredBuilds.length} builds into ${browsersPath}`);
  Object.assign(env, browserEnv(target));
  const results = await launchCheck(playwright(), target, builds);
  for (const r of results) log(`launch check: ${r}`);
  checkLayout(target, builds);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(import.meta.dirname, "..");
  const pins = JSON.parse(readFileSync(join(root, "tools", "tool-pins.json"), "utf8"));
  try {
    if (`${process.platform}-${process.arch}` !== "win32-x64") fail("Windows x64 only; Linux runs the pinned image");
    const web = createRequire(join(root, "web", "package.json"));
    // Loaded only after provision sets the browsers path, which Playwright reads when it loads.
    await provision({ pins, root, env: process.env, playwright: () => web("@playwright/test"), log: console.log });
  } catch (err) {
    console.error(`install-browsers: ${err.message}`);
    process.exit(1);
  }
}
