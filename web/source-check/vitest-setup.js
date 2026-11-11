import { readdirSync } from "node:fs";
import { join } from "node:path";

// Vitest prefers these files to vite.config.ts, and a workspace or projects list replaces it.
// What the suite then runs is proved by the acceptance run, never by reading the configuration.
const replacingFile = /^vitest\.(?:config|workspace|projects)\./iu;

/**
 * Any Vitest configuration file below web besides vite.config.ts, walked one folder at a time
 * and skipping only installed packages. A linked folder is refused: walking it could leave web,
 * and skipping it could hide a file.
 */
export function vitestSetupProblems(web, readdir = readdirSync) {
  const problems = [];
  const pending = [""];
  while (pending.length > 0) {
    const dir = pending.shift();
    let entries;
    try {
      entries = readdir(join(web, dir), { withFileTypes: true });
    } catch (error) {
      problems.push(
        `${dir || "."}: cannot list for Vitest configurations: ${error.code ?? error.message}`,
      );
      continue;
    }
    for (const entry of entries) {
      const at = dir ? `${dir}/${entry.name}` : entry.name;
      if (replacingFile.test(entry.name))
        problems.push(`${at}: a Vitest configuration besides vite.config.ts`);
      else if (entry.isSymbolicLink())
        problems.push(`${at}: a link is not walked for Vitest configurations`);
      else if (entry.isDirectory() && entry.name !== "node_modules")
        pending.push(at);
    }
  }
  return problems.sort();
}
