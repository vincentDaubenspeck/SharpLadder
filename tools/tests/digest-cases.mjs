// Digest verification cases for tools/digest.mjs, and the shape of every pinned digest.
// Usage: node tools/tests/digest-cases.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDigest } from "../digest.mjs";

const data = Buffer.from("pinned download");
const sha512 = createHash("sha512").update(data).digest("hex");
const sha256 = createHash("sha256").update(data).digest("hex");
const wrong512 = "0".repeat(128);
const wrong256 = "0".repeat(64);

let failed = 0;
function expect(label, asset, error) {
  let got = null;
  try {
    checkDigest("fixture", asset, data);
  } catch (err) {
    got = err.message;
  }
  const ok = error === null ? got === null : got !== null && got.includes(error);
  console.log(`${ok ? "PASS" : "FAIL"} digest: ${label}${ok ? "" : ` (got ${got ?? "no error"})`}`);
  if (!ok) failed++;
}

expect("SHA-512 match passes", { sha512 }, null);
expect("SHA-512 mismatch fails", { sha512: wrong512 }, "SHA-512 mismatch");
expect("SHA-256 match passes", { sha256 }, null);
expect("SHA-256 mismatch fails", { sha256: wrong256 }, "SHA-256 mismatch");
expect("SHA-512 is checked when both are pinned", { sha512: wrong512, sha256 }, "SHA-512 mismatch");
expect("no pinned digest fails", {}, "no pinned SHA-512 or SHA-256 digest");

const pins = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "tool-pins.json"), "utf8"),
);
const bad = [];
for (const [name, tool] of Object.entries(pins)) {
  for (const [platform, asset] of Object.entries(tool.assets ?? {})) {
    const ok = /^[0-9a-f]{128}$/.test(asset.sha512 ?? "") || /^[0-9a-f]{64}$/.test(asset.sha256 ?? "");
    if (!ok) bad.push(`${name} ${platform}`);
  }
}
console.log(`${bad.length === 0 ? "PASS" : "FAIL"} digest: every pinned asset has a well-formed digest`);
for (const b of bad) console.log(`  ${b}`);
if (bad.length > 0) failed++;
process.exitCode = failed > 0 ? 1 : 0;
