// The test-only content harness build; its compiler-backed preflight runs before Vite starts.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { harnessOutput, overlapping } from "../build-guard/exclusion.js";
import { acceptEnvelope } from "../content-check/envelope.ts";
import { recordInventory } from "../content-check/inventory.ts";
import { runTestRecords } from "../content-check/records.ts";

const web = realpathSync.native(join(import.meta.dirname, ".."));
const repository = join(web, "..");

const fail = (message) => {
  throw new Error(`content harness: ${message}`);
};

/**
 * The drift-and-validation checks of the round trip over a repository-shaped tree: the compiler
 * compares every committed payload with fresh output and validates the bytes it accepted.
 * Returns the digest of the accepted records; any failure throws.
 */
export function preflight(tree = repository, records = runTestRecords) {
  const run = records({ repository: tree });
  let accepted;
  try {
    // The inventory is read only once the compiler has accepted the tree.
    const expected =
      run.exit === 0 ? recordInventory(join(tree, "web", "compiled")) : [];
    accepted = acceptEnvelope(run.stdout, run.exit, expected);
  } catch (error) {
    fail(`preflight refused: ${String(error)}\n${run.stderr}`);
  }
  return createHash("sha256").update(JSON.stringify(accepted)).digest("hex");
}

/**
 * Builds the harness page of a repository-shaped tree into its own output root, never dist,
 * and only after the preflight over that same tree has passed.
 */
export async function buildHarness({
  tree = repository,
  outDir = harnessOutput(join(tree, "web")),
  records = runTestRecords,
} = {}) {
  const dist = join(tree, "web", "dist");
  if (overlapping(outDir, dist) || overlapping(outDir, join(web, "dist")))
    fail(`output ${outDir} overlaps the production output`);
  const certificate = preflight(tree, records);
  await build({
    root: join(tree, "web", "harness", "content"),
    configFile: false,
    logLevel: "warn",
    plugins: [react()],
    cacheDir: join(web, ".cache", "vite-harness"),
    publicDir: false,
    define: {
      "import.meta.env.SHARPLADDER_HARNESS_PREFLIGHT":
        JSON.stringify(certificate),
    },
    build: { outDir, emptyOutDir: true, sourcemap: false },
  });
  return { outDir, certificate };
}

const invoked =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));

if (invoked) {
  try {
    const [tree, outDir] = process.argv.slice(2);
    const built = await buildHarness({
      ...(tree === undefined ? {} : { tree }),
      ...(outDir === undefined ? {} : { outDir }),
    });
    console.log(`content harness built in ${built.outDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
