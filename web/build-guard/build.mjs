// The release build; a bare `vite build` still runs the in-plugin checks but skips the disk walk.
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { GuardError } from "./classify.js";
import { sameInventory, takeInventory, walkDist } from "./output.js";

const web = join(import.meta.dirname, "..");

// Builds with the real config, then requires dist to hold exactly the snapshot the guard took.
export async function releaseBuild(inline = {}) {
  takeInventory();
  await build({
    root: web,
    configFile: join(web, "vite.config.ts"),
    ...inline,
  });
  const record = takeInventory();
  if (record === null || !record.written || typeof record.outDir !== "string") {
    throw new GuardError("build guard: the build wrote no admitted output");
  }
  sameInventory(record.files, walkDist(record.outDir), record.outDir);
  return record;
}

const invoked =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));

if (invoked) {
  try {
    await releaseBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
