// Global setup for the real high-contrast run only: one baseline state, read before any project
// changes the OS and never written again, from a session where no browser sees forced colours.
import type { FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { forced, fullChromium } from "./high-contrast-capture.ts";
import {
  baselineProblems,
  encodeRun,
  hostedProblems,
  runVariable,
  spi,
  writeBaseline,
} from "./high-contrast.ts";

export default async function setup(config: FullConfig) {
  const problems = hostedProblems(process.env, process.platform);
  if (problems.length > 0)
    throw new Error(`high contrast: refused: ${problems.join("; ")}`);
  const output = config.projects[0]?.outputDir;
  if (output === undefined) throw new Error("high contrast: no project");
  // The output folder was emptied before this setup, so the run folder is new to this run.
  mkdirSync(output, { recursive: true });
  const dir = join(output, "hc-run");
  mkdirSync(dir);
  const state = spi("read");
  const issues = baselineProblems(state);
  if (issues.length > 0)
    throw new Error(`high contrast baseline: ${issues.join("; ")}`);
  await fullChromium(async (page) => {
    if (await forced(page))
      throw new Error("high contrast baseline: forced colours are active");
  });
  process.env[runVariable] = encodeRun(writeBaseline(dir, state));
}
