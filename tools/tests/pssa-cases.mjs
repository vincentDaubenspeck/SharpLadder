// PSScriptAnalyzer installer cases for tools/install-psscriptanalyzer.mjs, with a stand-in download.
// Usage: node tools/tests/pssa-cases.mjs <work dir>
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installPssa, modulesDir, pinnedPackage } from "../install-psscriptanalyzer.mjs";

const work = process.argv[2];
if (!work) throw new Error("usage: node tools/tests/pssa-cases.mjs <work dir>");
const pins = JSON.parse(readFileSync(join(import.meta.dirname, "..", "tool-pins.json"), "utf8"));
const data = Buffer.from("stand-in package");
const sum = createHash("sha256").update(data).digest("hex");
const url = "https://www.powershellgallery.com/api/v2/package/PSScriptAnalyzer/9.9.9";
const fake = (body) => ({ version: "9.9.9", package: { url, sha256: body } });
const fetchOk = async () => ({ ok: true, arrayBuffer: async () => data });

let failed = 0;
function report(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} psscriptanalyzer: ${label}${ok ? "" : ` (${detail})`}`);
  if (!ok) failed++;
}

async function attempt(name, pin) {
  const dest = join(work, name);
  let extracted = 0;
  const extract = (file, staged) => {
    extracted++;
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, "PSScriptAnalyzer.psd1"), "@{}\n");
    writeFileSync(join(staged, "[Content_Types].xml"), "<Types/>\n");
  };
  let error = null;
  try {
    await installPssa({ pins: { psscriptanalyzer: pin }, dest, fetchImpl: fetchOk, extract });
  } catch (err) {
    error = err.message;
  }
  return { dest, extracted, error };
}

const bad = await attempt("wrong", fake("0".repeat(64)));
report(
  bad.error?.includes("SHA-256 mismatch") && bad.extracted === 0 && !existsSync(bad.dest),
  "a wrong checksum is rejected before extraction",
  `error ${bad.error}, extracted ${bad.extracted}`,
);

const good = await attempt("right", fake(sum));
const mod = join(good.dest, "PSScriptAnalyzer", "9.9.9");
report(
  good.error === null && good.extracted === 1 && existsSync(join(mod, "PSScriptAnalyzer.psd1")) &&
    !existsSync(join(mod, "[Content_Types].xml")) &&
    readdirSync(join(good.dest, "PSScriptAnalyzer")).join() === "9.9.9",
  "a matching checksum installs the module without package metadata",
  `error ${good.error}`,
);

const moved = await attempt("url", { ...fake(sum), package: { url: `${url}0`, sha256: sum } });
report(moved.error?.includes("is not the gallery package") && moved.extracted === 0, "a url for another version is refused",
  `error ${moved.error}`);

const none = await attempt("none", { version: "9.9.9" });
report(none.error?.includes("needs a version, a package url and a SHA-256"), "a pin without a package is refused",
  `error ${none.error}`);

let pinned = null;
try {
  pinned = pinnedPackage(pins);
} catch (err) {
  pinned = err.message;
}
report(typeof pinned === "object" && pinned.version === pins.psscriptanalyzer.version,
  "the repository pin names the gallery package and a SHA-256", String(pinned));

report(modulesDir({ XDG_DATA_HOME: "/x" }).replaceAll("\\", "/") === "/x/powershell/Modules",
  "the module folder follows XDG_DATA_HOME", modulesDir({ XDG_DATA_HOME: "/x" }));
process.exitCode = failed > 0 ? 1 : 0;
