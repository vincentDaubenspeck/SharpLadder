// Which files ESLint holds to the application policy, decided by where the shared mapper places
// a file and never by how the caller spelled it. ESLint settles a name outside its base path or
// under an ignore pattern before any selector here runs, so no selector reaches it; the bound
// ESLint (application-eslint.js) reports it as ignored. A typed name the project service cannot
// open ends in a parsing error, and a name ESLint cannot read throws. The lint command and the
// coverage check fail on each of these, so none of them passes as a policy check.
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceIdentity } from "../source-policy/unit.js";

const root = fileURLToPath(new URL("../", import.meta.url));

// The extension is read in any letter case, which can only select more. A stylesheet or font
// under src is not a script, so it stays outside every ESLint configuration as before.
const script = (filePath) => /\.[cm]?[jt]sx?$/iu.test(basename(filePath));
// Exactly the names the type-aware block's pattern matches.
const typed = (filePath) => /\.tsx?$/u.test(basename(filePath));

// A name the mapper cannot be asked about, or that makes it throw, is a refusal, not an outside file.
function identify(filePath) {
  if (typeof filePath !== "string" || !isAbsolute(filePath))
    return { unit: null, error: "ESLint gave no absolute path" };
  try {
    return sourceIdentity(root, filePath);
  } catch (error) {
    return {
      unit: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A script the mapper places under src, or any name it cannot place.
 * @param {string} filePath The path ESLint was given, resolved against its working directory.
 * @returns {boolean} True when the application policy applies.
 */
export function applicationSource(filePath) {
  const { unit, error } = identify(filePath);
  return error !== undefined || (unit !== null && script(filePath));
}

/** Application source under a name the type-aware block parses. */
export const typedSource = (filePath) =>
  applicationSource(filePath) && typed(filePath);

/** Application source under any other name, which is parsed only to be refused. */
export const untypedSource = (filePath) =>
  applicationSource(filePath) && !typed(filePath);

/**
 * Exactly the named units, as the disk spells them; a name the mapper cannot place is never one.
 * @param {...string} units Paths under src with forward slashes.
 * @returns {(filePath: string) => boolean} The selector.
 */
export const exactUnits =
  (...units) =>
  (filePath) => {
    const { unit, error } = identify(filePath);
    return error === undefined && unit !== null && units.includes(unit);
  };
