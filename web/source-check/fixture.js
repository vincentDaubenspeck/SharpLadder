// Throwaway trees for source-check tests; links are removed before any recursive delete.
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const bases = [];
const links = [];

export function tree(files) {
  const base = mkdtempSync(join(tmpdir(), "sl-source-check-"));
  bases.push(base);
  for (const [path, text] of Object.entries(files)) {
    const full = join(base, path);
    if (path.endsWith("/")) mkdirSync(full, { recursive: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
  }
  return base;
}

// A junction on Windows and a symlink elsewhere; the type is ignored off Windows.
export function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
  links.push(path);
}

export function cleanUp() {
  for (const path of links.splice(0)) {
    if (process.platform === "win32") rmdirSync(path);
    else unlinkSync(path);
  }
  for (const base of bases.splice(0))
    rmSync(base, { recursive: true, force: true });
}
