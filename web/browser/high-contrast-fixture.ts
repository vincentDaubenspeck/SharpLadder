// Test fixtures for the post-restore check: real PNGs, a complete baseline state, and runs written
// by the real writer.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  expectedCycles,
  recordCycle,
  settlePostRestore,
  type CycleRow,
  type WriterIo,
} from "./high-contrast-cycles.ts";
import {
  sysColorCount,
  type HighContrastState,
} from "./high-contrast-state.ts";
import { pixelDiff } from "./high-contrast.ts";

interface Encoder {
  PNG: new (size: { width: number; height: number }) => {
    data: Buffer;
  };
}
const bundle = createRequire(import.meta.url)(
  "playwright-core/lib/utilsBundle",
) as Encoder & {
  PNG: { sync: { write: (png: { data: Buffer }) => Buffer } };
};

/** RGBA pixels as a real, complete PNG. */
export function encodePng(width: number, height: number, data: Uint8Array) {
  const png = new bundle.PNG({ width, height });
  png.data.set(data);
  return bundle.PNG.sync.write(png);
}

/** A width by height grey image with the first n pixels made white. */
export function pixels(width: number, height: number, changed = 0) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1)
    data.set(i < changed ? [255, 255, 255, 255] : [40, 80, 120, 255], i * 4);
  return data;
}

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

/** The writer's input for cycle i of a run whose baseline is baselinePng. */
export function cycleInput(
  i: number,
  changed: number,
  size: { width: number; height: number },
  baselinePng: Buffer,
) {
  const cycle = expectedCycles[i];
  if (cycle === undefined) throw new Error("at most six cycles");
  const base = pixels(size.width, size.height);
  const shot = pixels(size.width, size.height, changed);
  const found = pixelDiff({ ...size, data: base }, { ...size, data: shot });
  return {
    check: {
      ...cycle,
      captureMs: 100,
      doneMs: 200,
      ...size,
      devicePixelRatio: 1,
      forced: false as boolean | null,
      changed: changed as number | null,
      diagnostic: changed === 0 ? null : found.count,
      box: found.box,
      state: fixtureState() as unknown,
      activeElement: { tag: "BODY", id: "" },
      hasFocus: true as boolean | null,
      error: null as string | null,
    },
    images: {
      baseline: baselinePng as Uint8Array | null,
      capture: encodePng(size.width, size.height, shot) as Uint8Array | null,
      diff: (changed === 0
        ? null
        : encodePng(size.width, size.height, found.mask)) as Uint8Array | null,
    },
    baseline: { state: fixtureState(), ...size },
  };
}

export interface FixtureRun {
  root: string;
  run: string;
  baselinePng: Buffer;
  rows: CycleRow[];
  errors: string[];
}

/**
 * Writes a run under root: the baseline, then one cycle per entry of changes, in the expected
 * order, through the real writer. Only a count of 0 is exact.
 */
export function fixtureRun(
  root: string,
  changes: readonly number[] = [0, 0, 0, 0, 0, 0],
  size = { width: 16, height: 8 },
  io: Partial<WriterIo> = {},
): FixtureRun {
  const run = join(root, "hc-run");
  mkdirSync(run, { recursive: true });
  const baselinePng = encodePng(
    size.width,
    size.height,
    pixels(size.width, size.height),
  );
  writeFileSync(
    join(run, "baseline.json"),
    `${JSON.stringify(fixtureState(), null, 2)}\n`,
  );
  writeFileSync(join(run, "baseline.png"), baselinePng);
  const rows: CycleRow[] = [];
  const errors: string[] = [];
  changes.forEach((changed, i) => {
    try {
      settlePostRestore({
        ...cycleInput(i, changed, size, baselinePng),
        root,
        append: (row) => {
          recordCycle(root, row);
          rows.push(row);
        },
        io,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  return { root, run, baselinePng, rows, errors };
}
