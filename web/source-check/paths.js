import { relative, sep } from "node:path";

/**
 * True when a path is the root or lies below it. Both are resolved paths and are compared
 * character for character, so a name that differs only in letter case is never inside.
 * @param {string} root The resolved directory.
 * @param {string} path The resolved path.
 * @returns {boolean} Whether the path is the root or below it.
 */
export function inside(root, path) {
  const base = root.endsWith(sep) ? root : root + sep;
  return path === root || path.startsWith(base);
}

export const shown = (root, path) => relative(root, path).split(sep).join("/");
