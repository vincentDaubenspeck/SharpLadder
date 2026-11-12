import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import stylelint from "stylelint";
import { composedConfig } from "./config.js";
import { productionPaths, ruleOptions } from "./paths.js";
import { productionRegistry } from "./registry.js";

export const notApplicable = "NOT APPLICABLE — no source stylesheets";

/** A read error throws rather than shrinking the list, and FOO.CSS counts as a stylesheet. */
export function discoverStylesheets(dir) {
  const found = [];
  for (const entry of readdirSync(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.name.toLowerCase().endsWith(".css")) continue;
    if (!entry.isFile()) throw new Error(`${entry.name} is not a regular file`);
    found.push(join(entry.parentPath, entry.name));
  }
  return found.sort();
}

export async function lintProduction(
  paths = productionPaths,
  registry = productionRegistry,
  config = composedConfig,
) {
  let files;
  try {
    files = discoverStylesheets(paths.src);
  } catch (error) {
    return {
      state: "fail",
      lines: [`stylesheet discovery failed: ${error.message}`],
    };
  }
  // Nothing to lint is not evidence of a clean lint, so it is never reported as a pass.
  if (files.length === 0)
    return { state: "not-applicable", lines: [notApplicable] };

  const lines = [];
  const { missing } = registry();
  if (missing.length > 0)
    lines.push(`production token registry incomplete: ${missing.join(", ")}`);
  try {
    readFileSync(paths.tokensFile, "utf8");
  } catch {
    lines.push("tokens.css is missing or unreadable");
  }
  if (lines.length > 0) return { state: "fail", lines };

  const { results } = await stylelint.lint({
    files,
    // Stylelint globs from cwd, so cwd is this tree's web folder; production already runs from there.
    cwd: join(paths.repoRoot, "web"),
    config: config({ registry: "production", ...ruleOptions(paths) }),
    configBasedir: fileURLToPath(new URL("..", import.meta.url)),
    disableDefaultIgnores: true,
  });
  for (const r of results) {
    for (const w of r.warnings) {
      lines.push(`${r.source}:${String(w.line)}:${String(w.column)} ${w.text}`);
    }
    if (r.invalidOptionWarnings.length > 0)
      lines.push(`${r.source}: invalid rule options`);
  }
  return { state: lines.length === 0 ? "pass" : "fail", lines };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { state, lines } = await lintProduction();
  for (const line of lines) console.log(line);
  process.exitCode = state === "fail" ? 1 : 0;
}
