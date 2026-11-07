import { isAbsolute, relative, sep } from "node:path";

/** Compares canonical paths, so ".." segments and look-alike prefixes never pass. */
export function inside(root, path) {
  const r = relative(root, path);
  return (
    r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r))
  );
}

export const shown = (root, path) => relative(root, path).split(sep).join("/");
