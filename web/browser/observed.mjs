// Joins every font-observed-*.json under a results folder into one file in the baseline shape.
// Usage: node browser/observed.mjs <results dir> <output file>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { mergeObserved } from "./fonts.ts";

const [results, output] = process.argv.slice(2);
if (results === undefined || output === undefined) {
  console.error("usage: node browser/observed.mjs <results dir> <output file>");
  process.exit(2);
}
if (basename(output) === "font-baselines.json") {
  console.error("observed: the reviewed baseline file is never an output");
  process.exit(2);
}
const files = readdirSync(results, { recursive: true, encoding: "utf8" })
  .filter((name) => /^font-observed-.+\.json$/u.test(basename(name)))
  .sort();
const text = mergeObserved(
  files.map((name) => readFileSync(join(results, name), "utf8")),
);
writeFileSync(output, text);
console.log(
  `observed: ${String(JSON.parse(text).entries.length)} unreviewed identities from ${String(files.length)} files`,
);
