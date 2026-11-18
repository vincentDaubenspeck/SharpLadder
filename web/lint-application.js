// The application lint command, run through the bound ESLint (eslint-rules/application-eslint.js).
// Usage: node lint-application.js [--format <name>] [--stdin-filename <name>] [paths...]
//   (names are relative to the current directory and must exist; with --stdin-filename the text
//   on standard input is linted under that name; with neither, the whole web folder is linted)
// Any error or warning fails with exit 1, since ESLint reports a name it never linted as a
// warning; a thrown error, such as an unreadable name, a formatter outside the allowed built-ins
// or a lint that gave no result at all, fails with exit 2.
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { applicationESLint } from "./eslint-rules/application-eslint.js";

function options(args) {
  const parsed = { format: "stylish", stdin: undefined, paths: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--format" || arg === "--stdin-filename") {
      const value = args[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === "--format") parsed.format = value;
      else parsed.stdin = value;
      i += 1;
    } else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else parsed.paths.push(arg);
  }
  if (parsed.stdin !== undefined && parsed.paths.length > 0)
    throw new Error("give --stdin-filename or paths, not both");
  return parsed;
}

// ESLint reads a name that is no file or folder as a glob pattern, so only names that exist are
// taken, and ESLint lints each as that file or folder.
function existing(path) {
  const full = resolve(path);
  let found;
  try {
    found = statSync(full);
  } catch {
    found = undefined;
  }
  if (found === undefined)
    throw new Error(`${path} is not an existing file or folder`);
  return full;
}

async function standardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

try {
  const { format, stdin, paths } = options(process.argv.slice(2));
  const eslint = applicationESLint();
  const outcome =
    stdin === undefined
      ? await eslint.lintFiles(
          paths.length === 0 ? ["."] : paths.map(existing),
          format,
        )
      : await eslint.lintText(await standardInput(), resolve(stdin), format);
  if (outcome.output) console.log(outcome.output);
  const failed =
    outcome.errorCount + outcome.warningCount + outcome.fatalErrorCount > 0;
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
