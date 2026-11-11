import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { inside, shown } from "./paths.js";

const admittedSuffixes = [
  [".module.css", "css-module"],
  [".tsx", "tsx"],
  [".ts", "ts"],
  [".css", "css"],
];

/** Declarations would add program inputs that no lint covers, so none is admitted. */
export function classifyName(name) {
  if (name.startsWith(".")) return { reason: "dotfile" };
  const lower = name.toLowerCase();
  if (lower.endsWith(".d.ts"))
    return { reason: "declaration file (.d.ts) is not admitted" };
  for (const [suffix, kind] of admittedSuffixes) {
    if (name.endsWith(suffix)) return { kind };
  }
  if (admittedSuffixes.some(([suffix]) => lower.endsWith(suffix)))
    return { reason: "extension is not lowercase" };
  if (!name.includes(".")) return { reason: "no extension" };
  return { reason: "extension is not admitted" };
}

// Font files are bytes, never program input; the asset check binds each one to the inventory.
const fontDir = ["theme", "fonts"];

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const identity = (stat) => `${stat.dev}:${stat.ino}`;

// Windows defines neither flag and opens a directory with plain "r".
const directoryFlags =
  constants.O_DIRECTORY === undefined || constants.O_NOFOLLOW === undefined
    ? "r"
    : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY;

const label = (io, root, dir) =>
  `${io.name}/${shown(root, dir)}`.replace(/\/$/u, "");

function failure(what, at, error) {
  if (error.code === "EMFILE" || error.code === "ENFILE")
    return new Error(
      `cannot hold ${at} open: ${error.code}; too many open directories, and the walk never falls back to unpinned checks`,
      { cause: error },
    );
  return new Error(`cannot ${what} ${at}: ${error.code ?? error.message}`, {
    cause: error,
  });
}

/** The path must name a real directory, never a link or junction to one. */
function realDirectory(io, root, dir) {
  const at = label(io, root, dir);
  let stat;
  let real;
  try {
    stat = io.lstat(dir, { bigint: true });
    real = realpathSync.native(dir);
  } catch (error) {
    throw failure("inspect", at, error);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || real !== dir)
    throw new Error(`${at} was replaced by a link or non-directory`);
  return stat;
}

function heldIdentity(io, root, dir, fd) {
  try {
    return identity(io.fstat(fd, { bigint: true }));
  } catch (error) {
    throw failure("inspect", label(io, root, dir), error);
  }
}

/**
 * Opens an admitted directory and keeps it open until it is listed, so its inode cannot be
 * reused by a recreated directory; the identity is fixed only if lstat, the handle and a
 * second lstat all agree.
 */
function admit(io, held, root, dir, before) {
  const at = label(io, root, dir);
  let fd;
  try {
    fd = io.open(dir, directoryFlags);
  } catch (error) {
    throw failure("open", at, error);
  }
  held.add(fd);
  const expected = heldIdentity(io, root, dir, fd);
  const after = realDirectory(io, root, dir);
  if (identity(before) !== expected || identity(after) !== expected)
    throw new Error(`${at} changed identity while the tree was walked`);
  return { dir, fd, expected };
}

/** The path must still name the directory whose handle is held. */
function stillHeld(io, root, { dir, fd, expected }) {
  const now = identity(realDirectory(io, root, dir));
  if (now !== expected || heldIdentity(io, root, dir, fd) !== expected)
    throw new Error(
      `${label(io, root, dir)} changed identity while the tree was walked`,
    );
}

// The one declaration in src, pinned by path: the round trip's typing of the Vitest records.
const providedDeclaration = ["content", "provided.d.ts"];

/** The src rule: fonts only in theme/fonts, everything else by name. */
function classifySource(name, dir, root) {
  if (name.endsWith(".woff2") && dir === join(root, ...fontDir))
    return { kind: "font" };
  if (join(dir, name) === join(root, ...providedDeclaration))
    return { kind: "ts" };
  return classifyName(name);
}

const defaults = {
  name: "src",
  classify: classifySource,
  readdir: readdirSync,
  open: openSync,
  close: closeSync,
  fstat: fstatSync,
  lstat: lstatSync,
};

/**
 * Walks one directory at a time, because recursive readdir follows junctions.
 * Held directories prevent inode-reuse false matches and detect a persistent replacement;
 * any read failure throws, so a partial listing is never returned.
 */
export function admitTree(src, seams = {}) {
  const io = { ...defaults, ...seams };
  const top = io.lstat(src, { bigint: true });
  if (top.isSymbolicLink() || !top.isDirectory())
    throw new Error(`${io.name} is not a real directory`);
  const root = realpathSync.native(src);
  const admitted = [];
  const rejected = [];
  const held = new Set();
  const release = (fd) => {
    held.delete(fd);
    io.close(fd);
  };
  try {
    // Canonicalising re-reads src, so its root must keep the identity first seen at src.
    const first = admit(io, held, root, root, top);
    let given;
    try {
      given = io.lstat(src, { bigint: true });
    } catch (error) {
      throw failure("inspect", io.name, error);
    }
    if (given.isSymbolicLink() || !given.isDirectory())
      throw new Error(`${io.name} was replaced by a link or non-directory`);
    if (identity(given) !== first.expected)
      throw new Error(`${io.name} changed identity while the tree was walked`);
    const pending = [first];
    while (pending.length > 0) {
      const current = pending.pop();
      const { dir } = current;
      // A substitution restored entirely within one path-based readdir is still unseen:
      // Node has no handle-relative listing, so acceptance assumes a quiescent tree.
      stillHeld(io, root, current);
      let entries;
      try {
        entries = io.readdir(dir, { withFileTypes: true });
      } catch (error) {
        throw failure("read", label(io, root, dir), error);
      }
      stillHeld(io, root, current);
      release(current.fd);
      for (const entry of [...entries].sort(byName)) {
        const path = join(dir, entry.name);
        const at = shown(root, path);
        const reject = (reason) => rejected.push({ path: at, reason });
        const stat = io.lstat(path, { bigint: true });
        if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
          reject("symlink or junction");
          continue;
        }
        const real = realpathSync.native(path);
        if (!inside(root, real) || real !== path) {
          reject(
            `does not resolve to its own canonical path inside ${io.name}`,
          );
          continue;
        }
        if (entry.isDirectory() && stat.isDirectory()) {
          if (entry.name.startsWith(".")) reject("dot directory");
          else pending.push(admit(io, held, root, path, stat));
          continue;
        }
        if (!(entry.isFile() && stat.isFile())) {
          reject("neither a regular file nor a directory");
          continue;
        }
        const { kind, reason } = io.classify(entry.name, dir, root);
        if (kind) admitted.push({ path, kind });
        else reject(reason);
      }
    }
  } finally {
    for (const fd of [...held]) {
      held.delete(fd);
      try {
        io.close(fd);
      } catch {
        // Only a throw leaves handles here, and its error must not be masked.
      }
    }
  }
  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    root,
    admitted: admitted.sort(byPath),
    rejected: rejected.sort(byPath),
  };
}
