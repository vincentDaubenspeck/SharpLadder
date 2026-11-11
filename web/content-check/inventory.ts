import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The record paths the test-records envelope must hold for a compiled root: every regular .json
 * file below it except the root manifest, by name only. Anything else in the tree, a link
 * included, or any read error throws, so a partial list can never pass as the record set.
 */
export function recordInventory(compiledRoot: string): string[] {
  const found: string[] = [];
  const visit = (folder: string, prefix: string): void => {
    // Dirent types come from the directory entry itself, so a link below the root is refused.
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(join(folder, entry.name), path);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        if (path !== "compiled/manifest.json") found.push(path);
      } else throw new Error(`${path} is not a folder or a .json file`);
    }
  };
  try {
    // Listing a linked root would follow it, and no entry exists yet to show the link.
    if (lstatSync(compiledRoot).isSymbolicLink())
      throw new Error("compiled is a link");
    visit(compiledRoot, "compiled");
  } catch (error) {
    throw new Error(`compiled inventory refused: ${String(error)}`, {
      cause: error,
    });
  }
  return found.sort();
}
