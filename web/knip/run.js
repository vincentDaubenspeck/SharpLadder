// Runs knip with the jiti file cache off, so no cache lands in node_modules/.cache.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const knip = join(
  import.meta.dirname,
  "..",
  "node_modules",
  "knip",
  "bin",
  "knip.js",
);
const r = spawnSync(process.execPath, [knip, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, JITI_FS_CACHE: "false" },
});
if (r.error) throw r.error;
if (r.signal) process.kill(process.pid, r.signal);
else process.exitCode = r.status ?? 1;
