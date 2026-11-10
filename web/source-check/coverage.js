import { ESLint } from "eslint";
import { discoverStylesheets } from "../stylelint/lint-production.js";
import { shown } from "./paths.js";

/**
 * A file the type-aware block does not match would be linted without type information, or not
 * at all; the parser options must also name the program that file belongs to.
 */
export async function eslintCoverage(
  web,
  files,
  parser = { projectService: true },
) {
  const eslint = new ESLint({ cwd: web });
  const problems = [];
  for (const file of files) {
    const at = shown(web, file);
    let config;
    try {
      // ESLint reports a file no configuration matches as ignored too, so one message covers both.
      config = (await eslint.isPathIgnored(file))
        ? undefined
        : await eslint.calculateConfigForFile(file);
    } catch (error) {
      problems.push(`${at}: ESLint configuration failed: ${error.message}`);
      continue;
    }
    if (!config)
      problems.push(`${at}: ignored by ESLint or matched by no configuration`);
    else if (
      Object.entries(parser).some(
        ([key, value]) =>
          config.languageOptions?.parserOptions?.[key] !== value,
      )
    )
      problems.push(`${at}: not under the type-aware ESLint configuration`);
  }
  return problems;
}

/** The Stylelint stage lints exactly the files its own discovery returns, so the two sets must match. */
export function stylelintCoverage(web, src, files) {
  const linted = new Set(discoverStylesheets(src));
  const admitted = new Set(files);
  const problems = [];
  for (const file of admitted) {
    if (!linted.has(file))
      problems.push(`${shown(web, file)}: not in the Stylelint file set`);
  }
  for (const file of linted) {
    if (!admitted.has(file))
      problems.push(
        `${shown(web, file)}: linted by Stylelint but not admitted`,
      );
  }
  return problems;
}
