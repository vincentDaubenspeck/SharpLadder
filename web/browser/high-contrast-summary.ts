// Run by the browser-windows job after the real high-contrast step, whatever its result: writes the
// post-restore line to the log and the job summary and keeps the step's failure.
// Usage: node browser/high-contrast-summary.ts <output dir>, with HIGH_CONTRAST_OUTCOME set.
import { report } from "./high-contrast-cycles.ts";

process.exitCode = report({
  dir: process.argv[2],
  outcome: process.env["HIGH_CONTRAST_OUTCOME"],
  env: process.env,
  log: (line) => {
    console.log(line);
  },
});
