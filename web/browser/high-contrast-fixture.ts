// Test fixtures for the post-restore check: a complete baseline state, and runs written by the
// real writer.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectedCycles,
  recordCycle,
  settlePostRestore,
  type CycleRow,
} from "./high-contrast-cycles.ts";
import {
  sysColorCount,
  type HighContrastState,
} from "./high-contrast-state.ts";

export const fixtureState = (): HighContrastState => ({
  flags: 126,
  on: false,
  available: true,
  scheme: "",
  colours: {
    window: "#FFFFFF",
    windowText: "#000000",
    highlight: "#0078D4",
    highlightText: "#FFFFFF",
    buttonFace: "#F0F0F0",
    buttonText: "#000000",
    grayText: "#6D6D6D",
    hotlight: "#0066CC",
  },
  registry: {
    Flags: "126",
    "High Contrast Scheme": "",
    "Previous High Contrast Scheme MUI Value": "",
  },
  theme: "aero.theme",
  osBuild: "26100.33674",
  imageVersion: "20261103.298.1",
  fontSmoothing: { smoothing: 1, type: 2, contrast: 1200, orientation: 1 },
  sysColors: Array.from(
    { length: sysColorCount },
    (_, i) => (i * 0x050403) & 0xffffff,
  ),
});

/** The writer's input for cycle i; forced is what the fresh browser reported after the restore. */
export function cycleInput(i: number, forced: boolean | null = false) {
  const cycle = expectedCycles[i];
  if (cycle === undefined) throw new Error("at most six cycles");
  return {
    check: {
      ...cycle,
      doneMs: 200 as number | null,
      forced,
      state: fixtureState() as unknown,
      error: null as string | null,
    },
    baseline: fixtureState(),
  };
}

export interface FixtureRun {
  root: string;
  run: string;
  rows: CycleRow[];
  errors: string[];
}

/**
 * Writes a run under root: the baseline, then one cycle per entry of forced, in the expected
 * order, through the real writer. Only false is verified.
 */
export function fixtureRun(
  root: string,
  forced: readonly (boolean | null)[] = expectedCycles.map(() => false),
): FixtureRun {
  const run = join(root, "hc-run");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "baseline.json"),
    `${JSON.stringify(fixtureState(), null, 2)}\n`,
  );
  const rows: CycleRow[] = [];
  const errors: string[] = [];
  forced.forEach((seen, i) => {
    try {
      settlePostRestore({
        ...cycleInput(i, seen),
        append: (row) => {
          recordCycle(root, row);
          rows.push(row);
        },
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  return { root, run, rows, errors };
}
