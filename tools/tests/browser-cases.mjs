// Browser provisioning cases for tools/install-browsers.mjs, with stand-in downloads, archives and engines.
// Usage: node tools/tests/browser-cases.mjs <work dir>
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  browserEnv,
  checkAlignment,
  checkEntry,
  checkLayout,
  pinnedBuilds,
  provision,
  requiredBuilds,
} from "../install-browsers.mjs";

const work = process.argv[2];
if (!work)
  throw new Error("usage: node tools/tests/browser-cases.mjs <work dir>");
const real = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "tool-pins.json"), "utf8"),
);
const repoWeb = join(import.meta.dirname, "..", "..", "web");

let failed = 0;
function report(ok, label, detail = "") {
  console.log(
    `${ok ? "PASS" : "FAIL"} browsers: ${label}${ok ? "" : ` (${detail})`}`,
  );
  if (!ok) failed++;
}

// A stand-in archive is JSON mapping entry names to contents; the stand-in tool lists and extracts it.
function archiveFor(build, extra = {}) {
  const entries = { [build.executable]: `${build.dir} executable`, ...extra };
  if (build.root !== "") entries[`${build.root}/`] = "";
  return Buffer.from(JSON.stringify(entries));
}

function fixture(name, { archives = {}, edit = (p) => p, fresh = true } = {}) {
  const root = join(work, name);
  if (fresh) rmSync(root, { recursive: true, force: true });
  const pins = structuredClone(real);
  const bytes = {};
  for (const n of requiredBuilds) {
    const b = pins.playwright.windows.builds[n];
    const data = archives[n] ?? archiveFor(b);
    bytes[b.urls[0]] = data;
    b.bytes = data.length;
    b.sha256 = createHash("sha256").update(data).digest("hex");
  }
  const v = pins.playwright.version;
  const web = join(root, "web");
  const core = join(web, "node_modules", "playwright-core");
  mkdirSync(core, { recursive: true });
  writeFileSync(
    join(web, "package.json"),
    JSON.stringify({ devDependencies: { "@playwright/test": v } }),
  );
  const lock = { packages: {} };
  for (const [p, integrity] of Object.entries(pins.playwright.packages)) {
    lock.packages[`node_modules/${p}`] = { version: v, integrity };
  }
  writeFileSync(join(web, "package-lock.json"), JSON.stringify(lock));
  for (const p of Object.keys(pins.playwright.packages)) {
    mkdirSync(join(web, "node_modules", p), { recursive: true });
    writeFileSync(
      join(web, "node_modules", p, "package.json"),
      JSON.stringify({ version: v }),
    );
  }
  writeFileSync(
    join(web, "bin-collisions.json"),
    readFileSync(join(repoWeb, "bin-collisions.json")),
  );
  const shipped = Object.entries(pins.playwright.windows.builds).map(
    ([n, b]) => ({
      name: n,
      revision: b.revision,
      browserVersion: b.browserVersion,
    }),
  );
  writeFileSync(
    join(core, "browsers.json"),
    JSON.stringify({ browsers: shipped }),
  );
  return { root, pins: edit(pins), bytes };
}

function standIns(
  bytes,
  { extraFile = false, serve = (url) => bytes[url] } = {},
) {
  const log = { fetched: 0, extracted: 0 };
  const fetchImpl = async (url) => {
    log.fetched++;
    const data = serve(url);
    return data ? { ok: true, body: [data] } : { ok: false, status: 404 };
  };
  const archive = {
    list: (file) => Object.keys(JSON.parse(readFileSync(file, "utf8"))),
    extract: (file, dest) => {
      log.extracted++;
      for (const [entry, body] of Object.entries(
        JSON.parse(readFileSync(file, "utf8")),
      )) {
        const p = join(dest, entry);
        if (entry.endsWith("/")) {
          mkdirSync(p, { recursive: true });
        } else {
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, body);
        }
      }
      if (extraFile) writeFileSync(join(dest, "recovered.bin"), "");
    },
  };
  return { log, fetchImpl, archive };
}

// Stand-in engines report the pinned version from the pinned executable unless told otherwise.
function engines(
  pins,
  root,
  { version = (b) => b.browserVersion, exe = null, during = () => {} } = {},
) {
  const builds = pins.playwright.windows.builds;
  const path = join(root, pins.playwright.windows.browsersPath);
  const type = (pick) => ({
    launchServer: async (options) => {
      const b = builds[pick(options)];
      during(path);
      return {
        process: () => ({ spawnfile: exe ?? join(path, b.dir, b.executable) }),
        wsEndpoint: () => pick(options),
        close: async () => {},
      };
    },
    connect: async (name) => ({
      version: () => version(builds[name]),
      close: async () => {},
    }),
  });
  return () => ({
    chromium: type((o) =>
      o.channel === "chromium" ? "chromium" : "chromium-headless-shell",
    ),
    firefox: type(() => "firefox"),
    webkit: type(() => "webkit"),
  });
}

async function attempt(
  name,
  {
    env = { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    engine = {},
    tool = {},
    ...opts
  } = {},
) {
  const fx = fixture(name, opts);
  const s = standIns(fx.bytes, tool);
  let error = null;
  try {
    await provision({
      pins: fx.pins,
      root: fx.root,
      env: { ...env },
      playwright: engines(fx.pins, fx.root, engine),
      fetchImpl: s.fetchImpl,
      archive: s.archive,
    });
  } catch (err) {
    error = err.message;
  }
  const browsers = join(fx.root, ".tools", "ms-playwright");
  return { ...fx, ...s.log, error, browsers, standIns: s };
}

const good = await attempt("good");
report(
  good.error === null &&
    good.extracted === 6 &&
    existsSync(join(good.browsers, "webkit-2388", "Playwright.exe")),
  "pinned archives are verified, extracted and launch-checked",
  `error ${good.error}`,
);

const second = await attempt("good", { fresh: false });
report(
  second.error === null && second.fetched === 0 && second.extracted === 6,
  "a second run re-verifies the cached archives and rebuilds without downloading",
  `error ${second.error}, fetched ${second.fetched}`,
);

const missing = await attempt("missing-pin", {
  edit: (p) => (delete p.playwright.windows.builds.winldd, p),
});
report(
  missing.error?.includes("no pin for winldd") && missing.fetched === 0,
  "a missing pin fails before any download",
  `error ${missing.error}`,
);

const extraPin = await attempt("extra-pin", {
  edit: (p) => (
    (p.playwright.windows.builds.android = p.playwright.windows.builds.winldd),
    p
  ),
});
report(
  extraPin.error?.includes("unpinned build android"),
  "an extra build in the pins is refused",
  `error ${extraPin.error}`,
);

const sha = await attempt("wrong-sha", {
  edit: (p) => (
    (p.playwright.windows.builds.firefox.sha256 = "0".repeat(64)),
    p
  ),
});
report(
  sha.error?.includes("firefox: SHA-256 mismatch") &&
    sha.extracted === 2 &&
    !existsSync(sha.browsers),
  "a wrong SHA-256 is rejected before extraction",
  `error ${sha.error}, extracted ${sha.extracted}`,
);

const long = await attempt("wrong-length", {
  edit: (p) => ((p.playwright.windows.builds.chromium.bytes -= 1), p),
});
report(
  long.error?.includes("chromium: length mismatch") && long.extracted === 0,
  "a wrong length is rejected before extraction",
  `error ${long.error}`,
);

const short = await attempt("short-length", {
  edit: (p) => ((p.playwright.windows.builds.chromium.bytes += 1), p),
});
report(
  short.error?.includes("chromium: length mismatch") && short.extracted === 0,
  "a short download is rejected",
  `error ${short.error}`,
);

const primed = await attempt("cache");
const cached = await attempt("cache", {
  fresh: false,
  edit: (p) => {
    writeFileSync(
      join(
        work,
        "cache",
        ".tools",
        "ms-playwright-archives",
        "ffmpeg-1013-ffmpeg-win64.zip",
      ),
      "tampered",
    );
    return p;
  },
});
report(
  primed.error === null &&
    cached.error?.includes(
      "cached archive ffmpeg-1013-ffmpeg-win64.zip is refused",
    ) &&
    cached.fetched === 0,
  "a tampered cached archive is refused, never downloaded over",
  `error ${cached.error}`,
);

const entries = [
  ["parent", "chrome-win64/../../evil.exe", "has a parent segment"],
  ["absolute", "/chrome-win64/evil.exe", "is absolute"],
  ["drive", "C:/Windows/evil.exe", "is drive-qualified"],
  ["backslash", "chrome-win64\\evil.exe", "has a backslash"],
  ["outside", "other/evil.exe", "is outside chrome-win64/"],
  ["stream", "chrome-win64/chrome.exe:payload", "has a disallowed name"],
  ["device", "chrome-win64/nul.txt", "has a disallowed name"],
  ["repeat", "chrome-win64/CHROME.exe", "is repeated"],
];
for (const [label, entry, message] of entries) {
  const pinsBuild = real.playwright.windows.builds.chromium;
  const r = await attempt(`entry-${label}`, {
    archives: { chromium: archiveFor(pinsBuild, { [entry]: "x" }) },
  });
  report(
    r.error?.includes(message) && r.extracted === 0,
    `an archive entry that ${message} is refused (${label})`,
    `error ${r.error}`,
  );
}

const noExe = await attempt("no-executable", {
  archives: { webkit: Buffer.from(JSON.stringify({ "other.dll": "x" })) },
});
report(
  noExe.error?.includes("webkit: the archive has no Playwright.exe") &&
    noExe.extracted === 3,
  "an archive without the pinned executable is a missing build",
  `error ${noExe.error}`,
);

const recovered = await attempt("recovered", { tool: { extraFile: true } });
report(
  recovered.error?.includes("recovered.bin is not in the verified listing") &&
    !existsSync(recovered.browsers),
  "an extracted file outside the verified listing fails",
  `error ${recovered.error}`,
);

const unset = await attempt("skip-unset", { env: {} });
report(
  unset.error?.includes("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD must be 1") &&
    unset.fetched === 0,
  "an unset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD fails before anything runs",
  `error ${unset.error}`,
);

const preset = await attempt("preset-path", {
  env: {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    PLAYWRIGHT_BROWSERS_PATH: work,
  },
});
report(
  preset.error?.includes("is not the pinned browsers path"),
  "a preinstalled browsers path is refused",
  `error ${preset.error}`,
);

const stock = await attempt("stock-download", {
  engine: {
    during: (path) => mkdirSync(join(path, ".links"), { recursive: true }),
  },
});
report(
  stock.error?.includes("unpinned entry .links"),
  "a stock download attempt with the skip variable set is detected",
  `error ${stock.error}`,
);

const marker = await attempt("stock-marker", {
  engine: {
    during: (path) =>
      writeFileSync(join(path, "firefox-1572", "INSTALLATION_COMPLETE"), ""),
  },
});
report(
  marker.error?.includes("stock installer marker"),
  "a stock installer marker in a build is detected",
  `error ${marker.error}`,
);

const env = browserEnv("x");
report(
  env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1" &&
    env.PLAYWRIGHT_DOWNLOAD_HOST.startsWith("http://127.0.0.1:"),
  "the browser environment forbids downloads and points any attempt at a closed port",
  JSON.stringify(env),
);

const pkg = await attempt("package-version", {
  edit: (p) => {
    writeFileSync(
      join(work, "package-version", "web", "package.json"),
      JSON.stringify({ devDependencies: { "@playwright/test": "1.64.0" } }),
    );
    return p;
  },
});
report(
  pkg.error?.includes("@playwright/test is 1.64.0, pinned 1.65.0") &&
    pkg.fetched === 0,
  "a package version mismatch fails",
  `error ${pkg.error}`,
);

const unpinned = await attempt("unpinned-package", {
  edit: (p) => (delete p.playwright.packages.playwright, p),
});
report(
  unpinned.error?.includes(
    "playwright packages are @playwright/test, playwright-core, not @playwright/test, playwright, playwright-core",
  ) && unpinned.fetched === 0,
  "a playwright package missing from the pins fails",
  `error ${unpinned.error}`,
);

const lockDrift = await attempt("lock-integrity", {
  edit: (p) => (
    (p.playwright.packages.playwright =
      p.playwright.packages["playwright-core"]),
    p
  ),
});
report(
  lockDrift.error?.includes(
    "web/package-lock.json: playwright 1.65.0 does not match the pinned 1.65.0 and integrity",
  ),
  "a playwright integrity that differs from the lock fails",
  `error ${lockDrift.error}`,
);

const recordDrift = await attempt("record-version", {
  edit: (p) => {
    const file = join(work, "record-version", "web", "bin-collisions.json");
    const records = JSON.parse(readFileSync(file, "utf8"));
    records[0].declarers[1].version = "1.64.0";
    writeFileSync(file, JSON.stringify(records));
    return p;
  },
});
report(
  recordDrift.error?.includes(
    "web/bin-collisions.json: playwright at node_modules/playwright 1.64.0 does not match the pinned 1.65.0",
  ),
  "a bin collision record that disagrees with the pins fails",
  `error ${recordDrift.error}`,
);

const installedDrift = await attempt("installed-version", {
  edit: (p) => {
    writeFileSync(
      join(
        work,
        "installed-version",
        "web",
        "node_modules",
        "playwright",
        "package.json",
      ),
      JSON.stringify({ version: "1.64.0" }),
    );
    return p;
  },
});
report(
  installedDrift.error?.includes(
    "installed playwright 1.64.0 is not the pinned 1.65.0",
  ),
  "an installed playwright version mismatch fails",
  `error ${installedDrift.error}`,
);

const image = await attempt("image-version", {
  edit: (p) => ((p.playwright.image.tag = "v1.64.0-noble"), p),
});
report(
  image.error?.includes("image tag v1.64.0-noble is not v1.65.0-noble"),
  "an image version mismatch fails",
  `error ${image.error}`,
);

const rev = await attempt("revision", {
  edit: (p) => (
    (p.playwright.windows.builds.webkit.revision = "2387"),
    (p.playwright.windows.builds.webkit.dir = "webkit-2387"),
    p
  ),
});
report(
  rev.error?.includes("webkit: playwright-core 1.65.0 expects revision 2388"),
  "a revision the package does not ship fails",
  `error ${rev.error}`,
);

const ver = await attempt("launch-version", {
  engine: {
    version: (b) => (b.dir === "firefox-1572" ? "158.0" : b.browserVersion),
  },
});
report(
  ver.error?.includes("firefox: launch reports version 158.0, pinned 159.0"),
  "a launch reporting another version fails",
  `error ${ver.error}`,
);

const elsewhere = await attempt("launch-path", {
  engine: { exe: join(work, "chrome.exe") },
});
report(
  elsewhere.error?.includes(
    "not the pinned chromium-1254/chrome-win64/chrome.exe",
  ),
  "a launch from an unpinned executable fails",
  `error ${elsewhere.error}`,
);

// An earlier extraction is never trusted: tampering and additions disappear on the next run.
const exe = join(good.browsers, "chromium-1254", "chrome-win64", "chrome.exe");
writeFileSync(exe, "tampered");
writeFileSync(
  join(good.browsers, "chromium-1254", "chrome-win64", "planted.dll"),
  "",
);
const rebuilt = await attempt("good", { fresh: false });
report(
  rebuilt.error === null &&
    readFileSync(exe, "utf8") === "chromium-1254 executable" &&
    !existsSync(
      join(good.browsers, "chromium-1254", "chrome-win64", "planted.dll"),
    ),
  "a tampered extraction is rebuilt from the verified archive, never reused",
  `error ${rebuilt.error}`,
);

const builds = good.pins.playwright.windows.builds;
function layoutError(change) {
  change();
  try {
    checkLayout(good.browsers, builds);
    return null;
  } catch (err) {
    return err.message;
  }
}
const extraBuild = layoutError(() =>
  mkdirSync(join(good.browsers, "chromium-1200")),
);
report(
  extraBuild?.includes("unpinned entry chromium-1200"),
  "an extra unpinned build in the browsers path fails",
  String(extraBuild),
);
rmSync(join(good.browsers, "chromium-1200"), { recursive: true });
const gone = layoutError(() =>
  rmSync(join(good.browsers, "webkit-2388"), { recursive: true }),
);
report(
  gone?.includes("webkit: build webkit-2388 is missing"),
  "a missing build in the browsers path fails",
  String(gone),
);

let pinned = null;
try {
  pinned = pinnedBuilds(real);
  checkAlignment(real, repoWeb, { installed: false });
} catch (err) {
  pinned = err.message;
}
report(
  typeof pinned === "object" && pinned.browsersPath === ".tools/ms-playwright",
  "the repository pins name six verified builds and match web/package.json and its lockfile",
  String(pinned),
);

let exeEntry = null;
try {
  exeEntry = checkEntry("x", "C:evil.exe", "");
} catch (err) {
  exeEntry = err.message;
}
report(
  exeEntry.includes("drive-qualified"),
  "a drive-relative entry is refused",
  exeEntry,
);

// The CI browser jobs: the image by its pinned digest, pinned runners, verified Node, least privilege,
// and the real high-contrast opt-in on one Windows step only.
const workflow = readFileSync(
  join(import.meta.dirname, "..", "..", ".github", "workflows", "ci.yml"),
  "utf8",
);
function job(name) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}
const linuxJob = job("browser-linux");
const windowsJob = job("browser-windows");
const pinnedImage = `mcr.microsoft.com/playwright@${real.playwright.image.digest}`;
report(
  linuxJob.includes(`      image: >-\n        ${pinnedImage}\n`) &&
    linuxJob.includes("    runs-on: ubuntu-24.04\n"),
  "browser-linux runs on ubuntu-24.04 in the Playwright image by its pinned digest",
  linuxJob.slice(0, 80),
);
report(
  (workflow.match(/mcr\.microsoft\.com\/playwright\S*/g) ?? []).every(
    (ref) => ref === pinnedImage,
  ),
  "the workflow names the Playwright image only by its pinned digest",
  "unpinned image reference",
);
report(
  windowsJob.includes("    runs-on: windows-2025\n"),
  "browser-windows runs on windows-2025",
  windowsJob.slice(0, 80),
);
const nodeStep = linuxJob.slice(
  linuxJob.indexOf("Install pinned Node"),
  linuxJob.indexOf("GITHUB_PATH"),
);
report(
  nodeStep.includes('p.node.assets["linux-x64"]') &&
    nodeStep.includes("| sha256sum -c -") &&
    nodeStep.indexOf("sha256sum -c") < nodeStep.indexOf("tarfile"),
  "browser-linux checks the pinned Node archive digest before extracting it",
  nodeStep.slice(0, 80),
);
const linuxSuite = linuxJob
  .slice(linuxJob.indexOf("- name: Browser suite"))
  .split("\n      - ")[0];
report(
  linuxSuite.includes("        env:\n") &&
    linuxSuite.includes("          HOME: /root\n"),
  "browser-linux launches the browsers with a root-owned HOME",
  linuxSuite.slice(0, 80),
);
for (const [name, text] of [
  ["browser-linux", linuxJob],
  ["browser-windows", windowsJob],
]) {
  const uses = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  report(
    uses.length > 0 &&
      uses.every((u) => /@[0-9a-f]{40}$/.test(u)) &&
      !text.includes("setup-node"),
    `${name} pins every action by commit and has no setup-node`,
    uses.join(" "),
  );
  report(
    text.includes("    permissions:\n      contents: read\n") &&
      !/: write/.test(text),
    `${name} reads contents only`,
    "permissions",
  );
  report(
    text.includes("run: npm ci --ignore-scripts\n") &&
      !/npm (ci|install)(?! --ignore-scripts)/.test(text),
    `${name} installs without install scripts`,
    "npm ci",
  );
  report(
    text.includes("observed.mjs") &&
      text.includes(`name: ${name}-evidence`) &&
      text.includes("if-no-files-found: error"),
    `${name} uploads the evidence with the observed font identities`,
    "evidence",
  );
}
const optIn = [...workflow.matchAll(/SHARPLADDER_REAL_HIGH_CONTRAST/g)].length;
const hcStep = windowsJob
  .slice(windowsJob.indexOf("- name: Real high contrast"))
  .split("\n      - ")[0];
report(
  optIn === 1 &&
    hcStep.includes('          SHARPLADDER_REAL_HIGH_CONTRAST: "1"'),
  "real high contrast is opted in on one browser-windows step only",
  String(optIn),
);

// The real high-contrast step tests last; only the summary, which keeps its failure, and the upload follow.
const windowsSteps = windowsJob.split("\n      - ").slice(1);
const hcAt = windowsSteps.findIndex((s) =>
  s.startsWith("name: Real high contrast"),
);
const afterHc = hcAt < 0 ? [] : windowsSteps.slice(hcAt + 1);
const hcOutput = "../browser-evidence/high-contrast";
const always = "        if: ${{ !cancelled() }}\n";
report(
  hcAt >= 0 &&
    afterHc.length === 2 &&
    afterHc[0].startsWith("name: Post-restore summary") &&
    afterHc[1].startsWith("uses: actions/upload-artifact@") &&
    !afterHc.some((s) =>
      /run\.mjs|playwright|vitest|npm (run )?test|dotnet test/.test(s),
    ),
  "the real high-contrast step is the final test step of browser-windows; only the summary and the upload follow",
  afterHc.map((s) => s.split("\n")[0]).join(" | "),
);
report(
  hcStep.includes("        id: high-contrast\n") &&
    hcStep.includes(always) &&
    hcStep.endsWith(`run: node browser/run.mjs --output=${hcOutput}`),
  "the real high-contrast step has an id, runs unless cancelled and writes under the evidence folder",
  hcStep.slice(0, 80),
);
const summaryStep = afterHc[0] ?? "";
report(
  summaryStep.includes(always) &&
    summaryStep.includes(
      "          HIGH_CONTRAST_OUTCOME: ${{ steps.high-contrast.outcome }}\n",
    ) &&
    summaryStep.endsWith(
      `run: node browser/high-contrast-summary.ts ${hcOutput}`,
    ),
  "the post-restore summary runs unless cancelled and is given the high-contrast step outcome",
  summaryStep.slice(0, 80),
);
const uploadStep = afterHc[1] ?? "";
report(
  uploadStep.includes(always) &&
    uploadStep.includes("          path: browser-evidence\n") &&
    hcOutput.startsWith("../browser-evidence/") &&
    windowsJob.includes("        working-directory: web\n"),
  "the evidence upload runs unless cancelled and its path covers the real high-contrast output",
  uploadStep.slice(0, 80),
);
report(
  !windowsJob.includes("continue-on-error"),
  "no browser-windows step hides a failure with continue-on-error",
  "continue-on-error",
);

// The summary itself keeps a failed or missing high-contrast result as a failed step.
const { report: summaryReport } =
  await import("../../web/browser/high-contrast-cycles.ts");
const { fixtureRun } =
  await import("../../web/browser/high-contrast-fixture.ts");
function summaryStatus(name, outcome, rows) {
  const out = join(work, `summary-${name}`);
  rmSync(out, { recursive: true, force: true });
  fixtureRun(
    out,
    Array.from({ length: rows }, () => 0),
  );
  const lines = [];
  const status = summaryReport({
    dir: out,
    outcome,
    log: (line) => lines.push(line),
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: join(out, "summary.md"),
    },
  });
  return {
    status,
    lines,
    text: existsSync(join(out, "summary.md"))
      ? readFileSync(join(out, "summary.md"), "utf8")
      : "",
  };
}
const passed = summaryStatus("passed", "success", 6);
report(
  passed.status === 0 &&
    passed.text.startsWith(
      "Post-restore: 6/6 cycles completed; 6 exact, 0 failed, 0 incomplete; high-contrast step: success.\n",
    ),
  "the summary passes six exact cycles after a successful step and writes the line to the job summary",
  passed.lines.join(" | "),
);
const stepFailed = summaryStatus("step-failed", "failure", 6);
report(
  stepFailed.status === 1 &&
    stepFailed.text.startsWith(
      "Post-restore: 6/6 cycles completed; 6 exact, 0 failed, 0 incomplete; high-contrast step: failure.\n",
    ),
  "the summary still writes the line and fails when the high-contrast step failed",
  stepFailed.lines.join(" | "),
);
const missingRows = summaryStatus("missing-rows", "success", 4);
report(
  missingRows.status === 1 && missingRows.lines[0]?.includes("2 incomplete"),
  "the summary fails and counts missing cycles as incomplete",
  missingRows.lines.join(" | "),
);
process.exitCode = failed > 0 ? 1 : 0;
