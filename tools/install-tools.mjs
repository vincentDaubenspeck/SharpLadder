// Installs the pinned check tools into .tools/ after verifying each download.
// Usage: node tools/install-tools.mjs [--python <python executable>]
// Pins and digests live in tools/tool-pins.json; nothing is fetched to learn them.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { checkDigest, digestOf } from "./digest.mjs";

const root = join(import.meta.dirname, "..");
const platform = `${process.platform}-${process.arch}`;
const win = process.platform === "win32";
// Git Bash puts GNU tar first on PATH, which cannot read zip files.
const tar = win ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
// Before the second and third attempts, in milliseconds; a dropped transfer needs a new connection, not a long backoff.
const pauses = [1000, 4000];
const attempts = pauses.length + 1;
// Statuses a server sends when a later request can succeed.
const transient = (status) => status === 408 || status === 429 || (status >= 500 && status <= 599);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function stampOk(ctx, name, asset) {
  const { algo, value } = digestOf(asset);
  const stamp = join(ctx.dest, `${name}.${algo}`);
  return existsSync(stamp) && readFileSync(stamp, "utf8").trim() === value;
}

function writeStamp(ctx, name, asset) {
  const { algo, value } = digestOf(asset);
  writeFileSync(join(ctx.dest, `${name}.${algo}`), `${value}\n`);
}

// A fetch or body-read error keeps its useful detail, such as the socket error, on its cause chain.
function describe(err) {
  const parts = [];
  const seen = new Set();
  for (let e = err; e !== undefined && e !== null && !seen.has(e); e = e.cause) {
    seen.add(e);
    const message = typeof e.message === "string" ? e.message : String(e);
    const code = typeof e.code === "string" || typeof e.code === "number" ? ` (${e.code})` : "";
    parts.push(`${message}${code}`);
  }
  return parts.join("; cause: ").replace(/[\r\n]+/g, " ");
}

// Every attempt is a fresh request, so no bytes of a dropped transfer are reused.
async function fetchBody(ctx, name, url) {
  let cause;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      console.error(`install-tools: ${name}: attempt ${attempt - 1} of ${attempts} failed, retrying: ${describe(cause)}`);
      await ctx.pause(pauses[attempt - 2]);
    }
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      cause = err;
      continue;
    }
    if (!res.ok) {
      if (!transient(res.status)) throw new Error(`${name}: HTTP ${res.status} for ${url}`);
      cause = new Error(`HTTP ${res.status} for ${url}`);
      // The status alone decides the retry, so a failed release is ignored.
      await res.body?.cancel().catch(() => {});
      continue;
    }
    try {
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      cause = err;
    }
  }
  throw new Error(`${name}: all ${attempts} download attempts failed; last cause: ${describe(cause)}`, { cause });
}

export async function download(ctx, name, asset) {
  const data = await fetchBody(ctx, name, asset.url);
  checkDigest(name, asset, data);
  // Inside .tools, so moving the extracted Node never crosses file systems.
  const work = mkdtempSync(join(ctx.dest, `tmp-${name}-`));
  const file = join(work, asset.url.split("/").pop());
  writeFileSync(file, data);
  return { work, file };
}

export async function installBinary(ctx, name) {
  const tool = ctx.pins[name];
  const asset = tool.assets[platform];
  if (!asset) throw new Error(`${name}: no pinned build for ${platform}`);
  if (stampOk(ctx, name, asset)) return;
  const { work, file } = await download(ctx, name, asset);
  const bin = join(ctx.dest, "bin");
  const target = join(bin, win ? `${name}.exe` : name);
  // Staged beside the target so the rename that replaces it never leaves a partial file.
  const staged = join(bin, `tmp-${name}-${process.pid}`);
  try {
    if (asset.member) run(tar, ["-xf", file, "-C", work]);
    copyFileSync(asset.member ? join(work, asset.member) : file, staged);
    if (!win) chmodSync(staged, 0o755);
    renameSync(staged, target);
  } finally {
    rmSync(staged, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
  writeStamp(ctx, name, asset);
  console.log(`installed ${name} ${tool.version}`);
}

async function installNode(ctx) {
  const { pins, dest } = ctx;
  const nvmrc = readFileSync(join(root, "web/.nvmrc"), "utf8").trim();
  if (nvmrc !== pins.node.version) {
    throw new Error(`node pin ${pins.node.version} differs from web/.nvmrc ${nvmrc}`);
  }
  const asset = pins.node.assets[platform];
  if (!asset) throw new Error(`node: no pinned build for ${platform}`);
  if (stampOk(ctx, "node", asset)) return;
  const { work, file } = await download(ctx, "node", asset);
  const target = join(dest, "node");
  // Outside the work directory, so a failed restore never deletes the previous install.
  const aside = join(dest, `tmp-node-old-${process.pid}`);
  try {
    run(tar, ["-xf", file, "-C", work]);
    if (existsSync(target)) renameSync(target, aside);
    try {
      renameSync(join(work, asset.dir), target);
    } catch (err) {
      if (existsSync(aside)) renameSync(aside, target);
      throw err;
    }
    rmSync(aside, { recursive: true, force: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeStamp(ctx, "node", asset);
  console.log(`installed node ${pins.node.version}`);
}

// The SDK archive has no top-level folder, so the whole work directory becomes .tools/dotnet.
async function installDotnet(ctx) {
  const { pins, dest } = ctx;
  const asset = pins.dotnet.assets[platform];
  if (!asset) throw new Error(`dotnet: no pinned build for ${platform}`);
  if (stampOk(ctx, "dotnet", asset)) return;
  const { work, file } = await download(ctx, "dotnet", asset);
  const target = join(dest, "dotnet");
  const aside = join(dest, `tmp-dotnet-old-${process.pid}`);
  try {
    run(tar, ["-xf", file, "-C", work]);
    rmSync(file);
    if (existsSync(target)) renameSync(target, aside);
    try {
      renameSync(work, target);
    } catch (err) {
      if (existsSync(aside)) renameSync(aside, target);
      throw err;
    }
    rmSync(aside, { recursive: true, force: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeStamp(ctx, "dotnet", asset);
  console.log(`installed dotnet SDK ${pins.dotnet.version}`);
}

function installYamllint(ctx, python) {
  const { pins, dest } = ctx;
  const venv = join(dest, "venv");
  const venvPython = join(venv, win ? "Scripts/python.exe" : "bin/python");
  if (!existsSync(venvPython)) run(python, ["-m", "venv", venv]);
  const req = join(root, pins.yamllint.requirements);
  run(venvPython, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--require-hashes", "--no-deps", "-r", req]);
  console.log(`installed yamllint ${pins.yamllint.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const pins = JSON.parse(readFileSync(join(root, "tools/tool-pins.json"), "utf8"));
    const pyFlag = process.argv.indexOf("--python");
    const python = pyFlag > 0 ? process.argv[pyFlag + 1] : win ? "python" : "python3";
    const ctx = { pins, dest: join(root, ".tools"), pause: sleep };
    mkdirSync(join(ctx.dest, "bin"), { recursive: true });
    await installNode(ctx);
    for (const name of ["shfmt", "shellcheck", "ec", "cyclonedx"]) await installBinary(ctx, name);
    installYamllint(ctx, python);
    await installDotnet(ctx);
  } catch (err) {
    console.error(`install-tools: ${err.message}`);
    process.exit(1);
  }
}
