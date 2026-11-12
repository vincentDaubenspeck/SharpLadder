// The release build; a bare `vite build` still runs the in-plugin checks but skips the disk steps.
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { transform } from "lightningcss";
import { parse as parseHtml } from "parse5";
import { build, parseAst } from "vite";
import { assetAdmission } from "../asset-licence-check.js";
import { GuardError } from "./classify.js";
import {
  exclusionViolations,
  harnessOutput,
  overlapping,
} from "./exclusion.js";
import { sameInventory, takeInventory, walkDist } from "./output.js";
import {
  canonical,
  collect,
  moduleViolations,
  parseSheet,
  sameEntries,
} from "./provenance.js";
// Every export admits the process before anything else, argument defaults included, so no work
// runs in a process that could abort at exit.
import { admitStartup } from "./startup.js";

const web = join(import.meta.dirname, "..");

/** Owner-approved limits: gzip bytes per stylesheet, raw bytes across every shipped font. */
export const limits = { cssGzip: 30000, fontTotal: 1600000 };

const fail = (message) => {
  throw new GuardError(`build guard: ${message}`);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Measures verified bytes in memory; nothing is written beside them in dist. */
export function measure(files, ceiling = limits) {
  admitStartup();
  const { cssGzip, fontTotal } = ceiling;
  const css = [];
  const fonts = [];
  for (const [path, { bytes }] of files) {
    if (path.endsWith(".css"))
      css.push({ path, gzip: gzipSync(bytes, { level: 9 }).length });
    else if (path.endsWith(".woff2")) fonts.push({ path, bytes: bytes.length });
  }
  const total = fonts.reduce((sum, font) => sum + font.bytes, 0);
  const problems = [];
  for (const sheet of css) {
    if (sheet.gzip > cssGzip)
      problems.push(
        `${sheet.path} is ${sheet.gzip} gzip bytes, over the ${cssGzip} budget`,
      );
  }
  if (total > fontTotal)
    problems.push(
      `shipped fonts total ${total} bytes, over the ${fontTotal} ceiling`,
    );
  return { css, fonts, fontTotal: total, problems };
}

// A string literal counts as CSS when Lightning CSS parses it to a rule that carries something.
function isCss(text) {
  let rules = [];
  try {
    transform({
      filename: "string.css",
      code: Buffer.from(text),
      errorRecovery: false,
      visitor: {
        StyleSheet(sheet) {
          rules = sheet.rules;
        },
      },
    });
  } catch {
    return false;
  }
  return rules.some(
    ({ type, value }) =>
      type !== "unknown" &&
      type !== "ignored" &&
      !(
        type === "style" &&
        value.rules.length === 0 &&
        value.declarations.declarations.length === 0 &&
        value.declarations.importantDeclarations.length === 0
      ),
  );
}

function scriptStrings(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) scriptStrings(item, found);
  } else if (node !== null && typeof node === "object") {
    if (node.type === "Literal" && typeof node.value === "string")
      found.push(node.value);
    if (node.type === "TemplateElement")
      found.push(node.value.cooked ?? node.value.raw);
    for (const [key, child] of Object.entries(node))
      if (key !== "type") scriptStrings(child, found);
  }
  return found;
}

/** T 4.6 routes: every stylesheet link resolves to a shipped sheet; no other CSS route exists. */
export function routeViolations(terminal) {
  admitStartup();
  const problems = [];
  const sheets = new Set(
    [...terminal.keys()].filter((p) => p.endsWith(".css")),
  );
  for (const [path, { bytes }] of terminal) {
    if (path.endsWith(".html")) {
      const visit = (node) => {
        if (node.tagName === "style")
          problems.push(`${path} has a <style> element`);
        for (const { name, value } of node.attrs ?? []) {
          if (name === "style") problems.push(`${path} has a style attribute`);
          const rel = (node.attrs ?? []).find((a) => a.name === "rel");
          if (
            node.tagName === "link" &&
            name === "href" &&
            rel?.value.toLowerCase().split(/\s+/u).includes("stylesheet")
          ) {
            const target = value.startsWith("/")
              ? value.slice(1)
              : posix.join(posix.dirname(path), value);
            if (/^[a-z][\w+.-]*:|^\/\//iu.test(value) || !sheets.has(target))
              problems.push(
                `${path} links the stylesheet ${JSON.stringify(value)}, which is no shipped sheet`,
              );
          }
        }
        for (const child of node.childNodes ?? []) visit(child);
      };
      visit(parseHtml(bytes.toString("utf8")));
    } else if (path.endsWith(".js")) {
      let program;
      try {
        program = parseAst(bytes.toString("utf8"));
      } catch (error) {
        problems.push(`cannot parse ${path}: ${error.message}`);
        continue;
      }
      if (scriptStrings(program).some(isCss))
        problems.push(`${path} carries a stylesheet as a string`);
    }
  }
  return problems;
}

/** C3: the colour sequence on disk equals the expected transformed manifest, in order. */
export function terminalProvenance(terminal, manifest) {
  admitStartup();
  if (manifest === null || manifest === undefined)
    fail("the build published no token manifest");
  const routes = routeViolations(terminal);
  if (routes.length > 0) fail(routes.join("; "));
  const sheets = [...terminal].filter(([path]) => path.endsWith(".css"));
  if (sheets.length !== 1)
    fail(`expected one stylesheet at C3, found ${sheets.length}`);
  for (const [path, { bytes }] of sheets) {
    const where = `${path} at C3`;
    let found;
    try {
      found = collect(parseSheet(bytes.toString("utf8"), { filename: path }));
    } catch (error) {
      fail(`cannot parse ${where}: ${error.message}`);
    }
    const problems = moduleViolations(found, { tokens: true, where });
    if (problems.length > 0) fail(problems.join("; "));
    sameEntries(manifest.stage2, found.entries, where);
    return {
      path,
      occurrences: found.entries.length,
      exceptions: found.exceptions,
    };
  }
  return null;
}

/**
 * The guard's admission repeated over the bytes on disk, from a fresh inventory read; the
 * owned hashes are the snapshot's. Returns the admitted font slice.
 */
export async function terminalAdmission(record, terminal) {
  admitStartup();
  const admission = await assetAdmission({ root: join(record.root, "..") });
  if (admission.problems.length > 0)
    fail(`assets: ${admission.problems.join("; ")}`);
  const actual = new Map([...terminal].map(([path, f]) => [path, f.bytes]));
  const owned = new Map(
    [...record.files]
      .filter(([path]) => !record.assets.has(path))
      .map(([path, f]) => [path, f.sha256]),
  );
  const { problems, slice } = admission.admit(actual, owned);
  if (problems.length > 0)
    fail(`terminal asset admission: ${problems.join("; ")}`);
  return slice;
}

/** After the terminal step any added, removed or changed file fails the release. */
export function releaseRecheck(outDir, terminal) {
  admitStartup();
  sameInventory(terminal, walkDist(outDir), `${outDir} after verification`);
}

/** Evidence lives outside dist and is bound to the verified inventory by its hashes. */
function writeEvidence(record, terminal, report, provenance, fontSlice) {
  const evidence = {
    manifest: {
      sha256: sha256(canonical(record.manifest)),
      ...record.manifest,
    },
    provenance,
    fontSlice,
    files: Object.fromEntries(
      [...terminal].map(([path, { sha256: hash }]) => [path, hash]),
    ),
    ledger: record.ledger,
    css: report.css,
    fonts: report.fonts,
    fontTotal: report.fontTotal,
    limits,
  };
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const dir = join(record.root, ".cache", "build-evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "provenance.json"), text);
  return sha256(text);
}

// Builds with the real config, then verifies dist on disk; nothing may change after that.
export async function releaseBuild(inline, options) {
  admitStartup();
  const { ceiling = limits } = options ?? {};
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
  const terminal = walkDist(record.outDir);
  sameInventory(
    record.files,
    terminal,
    `${record.outDir} at the terminal step`,
  );
  const fontSlice = await terminalAdmission(record, terminal);
  const provenance = terminalProvenance(terminal, record.manifest);
  const report = measure(terminal, ceiling);
  if (report.problems.length > 0) fail(report.problems.join("; "));
  const excluded = exclusionViolations(terminal);
  for (const harness of new Set([
    harnessOutput(record.root),
    harnessOutput(web),
  ]))
    if (overlapping(record.outDir, harness))
      excluded.push(`${record.outDir} overlaps the harness output ${harness}`);
  if (excluded.length > 0) fail(`production exclusion: ${excluded.join("; ")}`);
  const evidence = writeEvidence(
    record,
    terminal,
    report,
    provenance,
    fontSlice,
  );
  releaseRecheck(record.outDir, terminal);
  return {
    ...record,
    report,
    evidence,
    provenance,
    fontSlice,
    manifestSha256: sha256(canonical(record.manifest)),
  };
}

const invoked =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));

if (invoked) {
  try {
    const { report, evidence, provenance, fontSlice, manifestSha256 } =
      await releaseBuild();
    console.log(`token manifest sha256: ${manifestSha256}`);
    console.log(
      `${provenance.path}: ${provenance.occurrences} colour occurrences verified, ${provenance.exceptions} exception-only`,
    );
    if (fontSlice !== null)
      console.log(
        `${fontSlice.path}: font faces at [${fontSlice.start}, ${fontSlice.end}), ${fontSlice.byteLength} bytes, sha256 ${fontSlice.sha256}`,
      );
    for (const sheet of report.css)
      console.log(
        `${sheet.path}: ${sheet.gzip} gzip bytes (budget ${limits.cssGzip})`,
      );
    for (const font of report.fonts)
      console.log(`${font.path}: ${font.bytes} bytes`);
    console.log(
      `fonts total: ${report.fontTotal} bytes (ceiling ${limits.fontTotal})`,
    );
    console.log(`build evidence sha256: ${evidence}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
