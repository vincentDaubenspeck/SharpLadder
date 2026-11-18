// A case script writes its fixtures under one work directory; a missing, blank or used argument
// is refused before anything runs, so fixtures never land in the caller's directory or its files.
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Returns { dir } for a directory found empty or created here, else { problem } with the argument untouched.
// A found empty directory is trusted to stay empty between this check and the caller's writes.
export function claimWorkDir(args, usage) {
  if (args.length !== 1 || args[0].trim() === "") return { problem: usage };
  const dir = resolve(args[0]);
  let found;
  try {
    found = statSync(dir, { throwIfNoEntry: false });
    if (found?.isDirectory() && readdirSync(dir).length > 0) return { problem: `work directory ${dir} is not empty` };
  } catch (error) {
    return { problem: `work directory ${dir} cannot be read: ${error.message}` };
  }
  if (found && !found.isDirectory()) return { problem: `work directory ${dir} is not a directory` };
  return found ? { dir } : createWorkDir(dir);
}

// The final directory is created exclusively, so one that appeared after the check is refused, not adopted.
export function createWorkDir(dir) {
  try {
    mkdirSync(dirname(dir), { recursive: true });
    mkdirSync(dir);
  } catch (error) {
    return { problem: `work directory ${dir} cannot be created: ${error.message}` };
  }
  return { dir };
}
