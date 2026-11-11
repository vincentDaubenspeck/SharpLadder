// Names a file by where it is on disk, never by how the caller spelled it, so an alias of a
// renderer module is still that module. A location that cannot be established is a finding.
// Resolved paths are compared character for character; folding letter case may refuse a file
// and never admits or names one. The tree is taken not to change while it is being read.
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";

const windows = sep === "\\";
const problem = (error) => ({ unit: null, error });
const reason = (error) =>
  error instanceof Error ? error.message : String(error);

// The two Windows namespace prefixes that name an ordinary location are reduced to it; a device
// path or any other prefixed form is refused. Dot segments are left for the checks below.
function plain(path) {
  if (!windows) return path;
  const back = path.replaceAll("/", "\\");
  if (/^\\\\\?\\UNC\\/iu.test(back)) return `\\\\${back.slice(8)}`;
  if (/^\\\\\?\\[A-Za-z]:\\/u.test(back)) return back.slice(4);
  return /^\\\\[?.]\\/u.test(back) ? null : back;
}

const segmentsOf = (path) =>
  path
    .slice(parse(path).root.length)
    .split(sep)
    .filter((segment) => segment !== "");

const dots = (segment) => segment === "." || segment === "..";

// Windows drops a trailing dot or space and reads a colon as a stream of the same file, so such
// a name would be classified as one file and read as another; it is refused on every platform.
function unsafeSegment(path) {
  if (path.includes("\0")) return "a NUL character";
  for (const segment of segmentsOf(path)) {
    if (dots(segment)) continue;
    if (
      segment.includes(":") ||
      segment.includes("\\") ||
      /[. ]$/u.test(segment)
    )
      return JSON.stringify(segment);
  }
  return null;
}

/**
 * The location the file system gives a path, in the spelling the disk holds.
 * @param {string} path A path that exists.
 * @returns {string} Its resolved path; a path that cannot be resolved throws.
 */
export const canonical = (path) => {
  const found = plain(realpathSync.native(path));
  if (found === null) throw new Error("it resolves to a device path");
  return found;
};

/**
 * The part of a path below a directory, both as canonical gives them, compared character for
 * character: two names the file system keeps apart are never taken for one.
 * @param {string} dir The canonical directory.
 * @param {string} path The canonical path.
 * @returns {string | null} Null when the path is the directory itself or is not below it.
 */
export function descendant(dir, path) {
  const base = dir.endsWith(sep) ? dir : dir + sep;
  return path.length > base.length && path.startsWith(base)
    ? path.slice(base.length)
    : null;
}

// Folds more than any file system does, on every platform, and so can only refuse: it never
// admits or names a file.
const refusalKey = (path) => path.toUpperCase().toLowerCase();
const looksBelow = (dir, path) => {
  const from = relative(refusalKey(dir), refusalKey(path));
  return !(
    from === "" ||
    from === ".." ||
    from.startsWith(`..${sep}`) ||
    isAbsolute(from)
  );
};

// A file an editor has not saved yet has no location of its own: each part that exists is
// resolved, and only the parts proved absent are appended as written.
function locate(path) {
  try {
    return { path: canonical(path) };
  } catch (error) {
    if (error?.code !== "ENOENT")
      return { error: `it cannot be resolved: ${reason(error)}` };
  }
  const segments = segmentsOf(path);
  if (segments.some(dots))
    return { error: "a file that does not exist is named through . or .." };
  let current;
  try {
    current = canonical(parse(path).root);
  } catch (error) {
    return { error: `its root cannot be resolved: ${reason(error)}` };
  }
  for (const [index, segment] of segments.entries()) {
    const next = join(current, segment);
    try {
      if (!lstatSync(current).isDirectory())
        return { error: `${JSON.stringify(current)} is not a directory` };
      lstatSync(next);
    } catch (error) {
      if (error?.code === "ENOENT")
        return { path: join(current, ...segments.slice(index)) };
      return { error: `it cannot be examined: ${reason(error)}` };
    }
    try {
      current = canonical(next);
    } catch (error) {
      return {
        error: `${JSON.stringify(next)} cannot be resolved: ${reason(error)}`,
      };
    }
  }
  return { error: "it changed while it was being resolved" };
}

/**
 * The path of a file under the project's src, in its real case with forward slashes.
 * @param {string} root The project directory that holds src.
 * @param {unknown} filename The file as the caller names it.
 * @returns {{ unit: string | null, error?: string }} A null unit is a file outside src.
 */
export function sourceIdentity(root, filename) {
  if (typeof filename !== "string" || !isAbsolute(filename))
    return { unit: null };
  const given = plain(filename);
  if (given === null) return problem("a device path is not a source location");
  const unsafe = unsafeSegment(given);
  if (unsafe !== null)
    return problem(`its path holds ${unsafe}, which is not a source name`);
  let src;
  try {
    src = canonical(join(root, "src"));
    if (src !== join(canonical(root), "src"))
      return problem("src resolves outside the project root");
  } catch (error) {
    return problem(`the source root cannot be resolved: ${reason(error)}`);
  }
  const found = locate(given);
  if (found.error !== undefined) return problem(found.error);
  // A link can lead to a name the caller's spelling never showed.
  const resolved = unsafeSegment(found.path);
  if (resolved !== null)
    return problem(`it resolves to ${resolved}, which is not a source name`);
  const below = descendant(src, found.path);
  if (below !== null) return { unit: below.split(sep).join("/") };
  // A share can name the project's own disk, and nothing here can tell; it is never passed.
  const [there, here] = [parse(found.path).root, parse(src).root];
  if (there.startsWith("\\\\") && there !== here)
    return problem("a network path is not a source location");
  // What follows only refuses. A place that reads as under src in another letter case, or a
  // name under src that leads elsewhere, is not an outside file.
  if (looksBelow(src, found.path))
    return problem("it resolves beside src, under a name that reads as src");
  const spelled = resolve(given);
  return looksBelow(src, spelled) || looksBelow(join(root, "src"), spelled)
    ? problem("it is named under src but resolves outside it")
    : { unit: null };
}
