// Asset licence cases for both test suites: the command line fails closed on a repeated JSON
// key in the build-guard-owned list or the inventory, where JSON.parse would keep only one.
// Usage: node tools/tests/asset-licence-cases.mjs <empty work directory>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const src = join(import.meta.dirname, "..", "..");
const cli = join(src, "web", "asset-licence-check.js");
const work = resolve(process.argv[2] ?? ".");
const hash = (text) => createHash("sha256").update(text).digest("hex");

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (ok) return;
  failed++;
  for (const line of detail.split(/\r?\n/).filter((l) => l.trim() !== ""))
    console.log(`  ${line}`);
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const inventory = JSON.stringify({
  schemaVersion: 1,
  allowedLicences: ["OFL-1.1"],
  noticesContract: {
    assetsAreNoticesSource: true,
    servedWithEachShippedAsset: ["copyright", "licenceText"],
    siteLicenceGrantsExcludeAssets: true,
    consumer: "notices-page-generator",
    consumerReads: "web/assets/licences/asset-inventory.json",
  },
  assets: [],
});
const root = join(work, "repo");
const inventoryFile = join(
  root,
  "web",
  "assets",
  "licences",
  "asset-inventory.json",
);
write(inventoryFile, inventory);
const output = join(work, "dist");
const page = "<!doctype html>\n";
write(join(output, "index.html"), page);

function run(name, owned) {
  const file = join(work, `${name}.json`);
  write(file, owned);
  const r = spawnSync(
    process.execPath,
    [cli, "--root", root, "--output", output, "--owned", file],
    {
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  return {
    code: r.status,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error?.message ?? ""}`,
  };
}

const entry = `"index.html": "${hash(page)}"`;
const ok = run("owned", `{"files": {${entry}}}`);
check(
  "asset licence check accepts a complete output",
  ok.code === 0 && /asset output closure valid/.test(ok.out),
  ok.out,
);

for (const [name, owned] of [
  ["a repeated owned path", `{"files": {${entry}, ${entry}}}`],
  [
    "a repeated owned path spelt with an escape",
    `{"files": {${entry}, "index\\u002ehtml": "${hash(page)}"}}`,
  ],
  ["a repeated files key", `{"files": {${entry}}, "files": {${entry}}}`],
]) {
  const r = run(name.replaceAll(" ", "-"), owned);
  check(
    `asset licence check fails ${name}`,
    r.code === 1 && /duplicate key/.test(r.out),
    r.out,
  );
}

write(
  inventoryFile,
  inventory.replace('"assets":[]', '"assets":[],"assets":[]'),
);
const repeated = spawnSync(process.execPath, [cli, "--root", root], {
  encoding: "utf8",
  timeout: 60_000,
});
check(
  "asset licence check fails a repeated inventory key",
  repeated.status === 1 && /duplicate key "assets"/.test(repeated.stdout),
  `${repeated.stdout ?? ""}${repeated.stderr ?? ""}`,
);

process.exitCode = failed > 0 ? 1 : 0;
