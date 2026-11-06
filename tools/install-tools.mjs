// Installs the pinned check tools into .tools/ after verifying each download.
// Usage: node tools/install-tools.mjs [--python <python executable>]
// Pins and SHA-256 digests live in tools/tool-pins.json; nothing is fetched to learn them.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const root = join(import.meta.dirname, "..");
const pins = JSON.parse(readFileSync(join(root, "tools/tool-pins.json"), "utf8"));
const dest = join(root, ".tools");
const bin = join(dest, "bin");
const platform = `${process.platform}-${process.arch}`;
const win = process.platform === "win32";
// Git Bash puts GNU tar first on PATH, which cannot read zip files.
const tar = win ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function stampOk(name, sha) {
  const stamp = join(dest, `${name}.sha256`);
  return existsSync(stamp) && readFileSync(stamp, "utf8").trim() === sha;
}

async function download(name, asset) {
  const res = await fetch(asset.url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${asset.url}`);
  const data = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(data).digest("hex");
  if (got !== asset.sha256) {
    throw new Error(`${name}: SHA-256 mismatch (expected ${asset.sha256}, got ${got})`);
  }
  // Inside .tools, so moving the extracted Node never crosses file systems.
  const work = mkdtempSync(join(dest, `tmp-${name}-`));
  const file = join(work, asset.url.split("/").pop());
  writeFileSync(file, data);
  return { work, file };
}

async function installBinary(name) {
  const tool = pins[name];
  const asset = tool.assets[platform];
  if (!asset) throw new Error(`${name}: no pinned build for ${platform}`);
  if (stampOk(name, asset.sha256)) return;
  const { work, file } = await download(name, asset);
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
  writeFileSync(join(dest, `${name}.sha256`), `${asset.sha256}\n`);
  console.log(`installed ${name} ${tool.version}`);
}

async function installNode() {
  const nvmrc = readFileSync(join(root, "web/.nvmrc"), "utf8").trim();
  if (nvmrc !== pins.node.version) {
    throw new Error(`node pin ${pins.node.version} differs from web/.nvmrc ${nvmrc}`);
  }
  const asset = pins.node.assets[platform];
  if (!asset) throw new Error(`node: no pinned build for ${platform}`);
  if (stampOk("node", asset.sha256)) return;
  const { work, file } = await download("node", asset);
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
  writeFileSync(join(dest, "node.sha256"), `${asset.sha256}\n`);
  console.log(`installed node ${pins.node.version}`);
}

function installYamllint(python) {
  const venv = join(dest, "venv");
  const venvPython = join(venv, win ? "Scripts/python.exe" : "bin/python");
  if (!existsSync(venvPython)) run(python, ["-m", "venv", venv]);
  const req = join(root, pins.yamllint.requirements);
  run(venvPython, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--require-hashes", "--no-deps", "-r", req]);
  console.log(`installed yamllint ${pins.yamllint.version}`);
}

const pyFlag = process.argv.indexOf("--python");
const python = pyFlag > 0 ? process.argv[pyFlag + 1] : win ? "python" : "python3";
mkdirSync(bin, { recursive: true });
try {
  await installNode();
  for (const name of ["shfmt", "shellcheck", "ec", "cyclonedx"]) await installBinary(name);
  installYamllint(python);
} catch (err) {
  console.error(`install-tools: ${err.message}`);
  process.exit(1);
}
