// Runs the suppression-reason policy through the ESLint API.
// Usage: node web/lint-comments.js [paths...]   (paths relative to the current directory)
// The API takes no inline config and reads no suppressions file, so neither can mute the policy.
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: fileURLToPath(
    new URL("eslint.comments.config.js", import.meta.url),
  ),
  allowInlineConfig: false,
  warnIgnored: false,
});
const paths = process.argv.slice(2);
const results = await eslint.lintFiles(paths.length > 0 ? paths : ["."]);
const formatter = await eslint.loadFormatter("stylish");
const text = await formatter.format(results);
if (text) console.log(text);
const problems = results.reduce((n, r) => n + r.errorCount + r.warningCount, 0);
process.exitCode = problems === 0 ? 0 : 1;
