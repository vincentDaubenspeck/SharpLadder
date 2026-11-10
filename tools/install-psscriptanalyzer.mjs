// Installs the pinned PSScriptAnalyzer into the current user's PowerShell module folder.
// Usage: node tools/install-psscriptanalyzer.mjs [--python <python executable>]
// The package URL and SHA-256 come from tools/tool-pins.json; the package is never unpacked before it matches.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkDigest } from "./digest.mjs";

const gallery = "https://www.powershellgallery.com/api/v2/package/PSScriptAnalyzer/";
// Package-format metadata that Install-Module also leaves out of an installed module.
const metadata = ["_rels", "package", "[Content_Types].xml", "PSScriptAnalyzer.nuspec"];

export function modulesDir(env = process.env) {
  // PowerShell on Linux and macOS resolves CurrentUser modules under XDG_DATA_HOME.
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "powershell", "Modules");
}

export function pinnedPackage(pins) {
  const pin = pins.psscriptanalyzer;
  const pkg = pin?.package;
  if (!pin?.version || !pkg?.url || !/^[0-9a-f]{64}$/.test(pkg.sha256 ?? "")) {
    throw new Error("tools/tool-pins.json: psscriptanalyzer needs a version, a package url and a SHA-256");
  }
  if (pkg.url !== `${gallery}${pin.version}`) {
    throw new Error(`psscriptanalyzer: package url ${pkg.url} is not the gallery package for ${pin.version}`);
  }
  return { version: pin.version, asset: { url: pkg.url, sha256: pkg.sha256 } };
}

export async function installPssa({ pins, dest, fetchImpl = fetch, extract }) {
  const { version, asset } = pinnedPackage(pins);
  const res = await fetchImpl(asset.url);
  if (!res.ok) throw new Error(`psscriptanalyzer: HTTP ${res.status} for ${asset.url}`);
  const data = Buffer.from(await res.arrayBuffer());
  checkDigest("psscriptanalyzer", asset, data);
  const parent = join(dest, "PSScriptAnalyzer");
  mkdirSync(parent, { recursive: true });
  // Staged beside the target so the final rename never leaves a partial module behind.
  const work = mkdtempSync(join(parent, "tmp-"));
  try {
    const file = join(work, "package.nupkg");
    writeFileSync(file, data);
    const staged = join(work, "module");
    extract(file, staged);
    rmSync(file);
    for (const m of metadata) rmSync(join(staged, m), { recursive: true, force: true });
    if (!existsSync(join(staged, "PSScriptAnalyzer.psd1"))) {
      throw new Error("psscriptanalyzer: the package has no PSScriptAnalyzer.psd1");
    }
    const target = join(parent, version);
    rmSync(target, { recursive: true, force: true });
    renameSync(staged, target);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return version;
}

function pythonExtract(python) {
  return (file, staged) => {
    // The archive is digest-verified before this point and goes into a fresh directory; zipfile
    // also strips absolute and parent-relative parts from member names rather than refusing them.
    const r = spawnSync(python, ["-I", "-m", "zipfile", "-e", file, staged], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("psscriptanalyzer: extracting the package failed");
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pyFlag = process.argv.indexOf("--python");
  const python = pyFlag > 0 ? process.argv[pyFlag + 1] : "python3";
  const pins = JSON.parse(readFileSync(join(import.meta.dirname, "tool-pins.json"), "utf8"));
  try {
    if (process.platform === "win32") throw new Error("Windows uses Install-Module (see tools/checks/pssa.ps1)");
    const v = await installPssa({ pins, dest: modulesDir(), extract: pythonExtract(python) });
    console.log(`installed PSScriptAnalyzer ${v}`);
  } catch (err) {
    console.error(`install-psscriptanalyzer: ${err.message}`);
    process.exit(1);
  }
}
