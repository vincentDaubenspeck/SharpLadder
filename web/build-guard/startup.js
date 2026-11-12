// On the pinned Node a concurrent ArrayBuffer sweeper thread can wake a libuv handle that process
// exit is already closing (nodejs/node#67417), so the guard runs only with that sweeping off.
import { GuardError } from "./classify.js";

/** The one admitted spelling, once: V8 applies the last of several, so any other form could undo it. */
export const sweepingFlag = "--no-concurrent-array-buffer-sweeping";

const sweepingName = "concurrent-array-buffer-sweeping";

// V8 reads one or two dashes, underscores for hyphens, a "no" prefix with or without a separator
// and a value after "=", so every such form names the same flag.
function namesSweeping(token) {
  if (!token.startsWith("-")) return false;
  const name = token
    .replace(/^--?/u, "")
    .split("=")[0]
    .replaceAll("_", "-")
    .toLowerCase();
  return (
    name === sweepingName ||
    (name.startsWith("no") && name.slice(2).replace(/^-/u, "") === sweepingName)
  );
}

// Read exactly as Node reads NODE_OPTIONS, so a token is refused only where Node would pass it on:
// a space alone separates, a double quote toggles a string without starting an argument, and in a
// string a backslash takes the next character. Null where Node refuses the whole variable.
function nodeOptionArgs(text) {
  const args = [];
  let inString = false;
  let fresh = true;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === "\\" && inString) {
      if (i + 1 === text.length) return null;
      c = text[++i];
    } else if (c === " " && !inString) {
      fresh = true;
      continue;
    } else if (c === '"') {
      inString = !inString;
      continue;
    }
    if (fresh) args.push(c);
    else args[args.length - 1] += c;
    fresh = false;
  }
  return inString ? null : args;
}

// The startup arguments are the whole contract, since V8 offers no public way to read a flag back.
export function startupProblems(execArgv, nodeOptions = "") {
  const problems = [];
  const exact = execArgv.filter((arg) => arg === sweepingFlag).length;
  if (exact !== 1)
    problems.push(
      `the process must start with ${sweepingFlag} exactly once, found ${exact}`,
    );
  for (const arg of execArgv)
    if (arg !== sweepingFlag && namesSweeping(arg))
      problems.push(
        `the process starts with ${JSON.stringify(arg)}, another form of ${sweepingFlag}`,
      );
  // The pinned Node already refuses this flag in NODE_OPTIONS; the check holds if a release admits it.
  const options = nodeOptionArgs(nodeOptions);
  if (options === null)
    problems.push(
      "NODE_OPTIONS leaves a string open or ends one with a backslash",
    );
  else
    for (const arg of options)
      if (namesSweeping(arg))
        problems.push(
          `NODE_OPTIONS holds ${JSON.stringify(arg)}; the flag is admitted only on the command line`,
        );
  return problems;
}

// Supported guarded production-build paths require the startup mitigation, so each calls this
// before any work; it enforces the flag configuration, not immunity from every crash.
export function admitStartup() {
  const problems = startupProblems(
    process.execArgv,
    process.env["NODE_OPTIONS"] ?? "",
  );
  if (problems.length > 0)
    throw new GuardError(`build guard: startup: ${problems.join("; ")}`);
}
