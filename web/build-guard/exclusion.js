// Output-side evidence that the test-only content harness never reaches the production build.
import { existsSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

/** The fixed string the harness page and entry carry; production output never holds it. */
export const harnessMarker = "sharpladder-content-harness";

/** The harness build's output root under a web root; production output goes to dist instead. */
export const harnessOutput = (web) => join(web, ".cache", "harness-dist");

// A folder not yet created resolves through its nearest existing ancestor, so an 8.3 alias of
// either side still compares as the same folder.
function realOf(path) {
  const rest = [];
  let at = resolve(path);
  while (!existsSync(at)) {
    const parent = dirname(at);
    if (parent === at) break;
    rest.unshift(basename(at));
    at = parent;
  }
  const real = join(realpathSync.native(at), ...rest);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

const within = (inner, outer) => {
  const path = relative(outer, inner);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
};

/** True when either folder is the other or lies inside it, both sides resolved. */
export function overlapping(a, b) {
  const x = realOf(a);
  const y = realOf(b);
  return within(x, y) || within(y, x);
}

/** A production output path that names the harness, or a file that holds its marker. */
export function exclusionViolations(files) {
  const marker = Buffer.from(harnessMarker);
  const found = [];
  for (const [path, { bytes }] of files) {
    if (/harness/iu.test(path)) found.push(`${path} names the harness`);
    if (Buffer.from(bytes).includes(marker))
      found.push(`${path} holds the harness marker`);
  }
  return found;
}
