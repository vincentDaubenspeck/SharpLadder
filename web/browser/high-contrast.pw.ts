// Real Windows high contrast, turned on through SPI on the hosted runner only (brief section 6).
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { base64, host } from "./fonts.ts";
import {
  postRestoreDeadlineMs,
  recordCycle,
  settlePostRestore,
} from "./high-contrast-cycles.ts";
import { groupDCells, viewportAt } from "./group-d.ts";
import { forced, fullChromium, open } from "./high-contrast-capture.ts";
import {
  beforeDeadline,
  capability,
  channels,
  enableProblems,
  engineNamed,
  hostedProblems,
  loadBaseline,
  notRunCells,
  readLastEnabled,
  realClock,
  recordLastEnabled,
  recorder,
  registryEvidence,
  restoredProblems,
  runVariable,
  schemes,
  spi,
  tally,
  unsupportedCells,
  verdictOf,
  withRestore,
  type Scheme,
  type Verdict,
} from "./high-contrast.ts";
import { indicators, judge, resize, setTheme } from "./indicators.ts";
import { settle, shot } from "./probe.ts";

/** The engine's resolved system colours, recorded as its own forced-colours palette. */
const palette = (page: Page) =>
  page.evaluate(() => {
    const names = [
      "Canvas",
      "CanvasText",
      "LinkText",
      "Highlight",
      "HighlightText",
      "ButtonFace",
      "ButtonText",
      "GrayText",
    ];
    return Object.fromEntries(
      names.map((name) => {
        const probe = document.createElement("span");
        probe.style.color = name;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return [name, value];
      }),
    );
  });

/** The rendered colour of a page-background swatch, read from the engine's own screenshot. */
async function swatch(page: Page): Promise<[number, number, number]> {
  // Test-only swatch; under forced colours its background is the system Canvas colour.
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.setAttribute("data-hc-swatch", "");
    box.style.cssText =
      "position:fixed;right:0;bottom:0;width:16px;height:16px;background-color:var(--bg)";
    document.body.append(box);
  });
  let measurementFailed = false;
  let measurementError: unknown;
  let colour: [number, number, number] = [-1, -1, -1];
  try {
    await settle(page);
    // Client size, so a classic scrollbar is never the sampled pixel.
    const corner = await page.evaluate(() => {
      const root = document.documentElement;
      return { x: root.clientWidth - 8, y: root.clientHeight - 8 };
    });
    const bytes = await shot(page, { ...corner, width: 1, height: 1 });
    colour = await page.evaluate(async (data) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const image = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context");
      context.drawImage(image, 0, 0);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return [r ?? -1, g ?? -1, b ?? -1] as [number, number, number];
    }, base64(bytes));
  } catch (error: unknown) {
    measurementFailed = true;
    measurementError = error;
  }
  // Removed so the swatch never covers a specimen the next cell measures.
  try {
    await page.evaluate(() => {
      document.querySelector("[data-hc-swatch]")?.remove();
    });
    await settle(page);
  } catch (cleanupError: unknown) {
    if (!measurementFailed) throw cleanupError;
    throw new AggregateError(
      [measurementError, cleanupError],
      "the swatch measurement and its cleanup both failed",
      { cause: cleanupError },
    );
  }
  if (measurementFailed) throw measurementError;
  return colour;
}

interface CellRow {
  scheme: string;
  key: string;
  width: number;
  theme: string;
  verdict: Verdict;
  [evidence: string]: unknown;
}

const readJson = (path: string): unknown =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : null;

test("real Windows high contrast: Group D matrix per scheme, theme and width, then a full restore", async ({
  playwright,
}, info) => {
  // Fails, never skips: this file is selected only when the run opted in to the real setting.
  expect(hostedProblems(process.env, process.platform)).toEqual([]);
  const engine = engineNamed(info.project.metadata["engine"]);
  const pins = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "tools", "tool-pins.json"),
      "utf8",
    ),
  ) as {
    playwright: { windows: { builds: Record<string, { sha256: string }> } };
  };
  const baseline = loadBaseline(process.env[runVariable]);
  const record = {
    project: info.project.name,
    engine,
    host: host(),
    imageVersion: baseline.state.imageVersion,
    osBuild: baseline.state.osBuild,
    archiveSha256: {
      [engine]: pins.playwright.windows.builds[engine]?.sha256 ?? null,
      chromium: pins.playwright.windows.builds["chromium"]?.sha256 ?? null,
    },
    baseline: { state: baseline.state, digests: baseline.run },
    beforeChange: [] as unknown[],
    transitions: [] as unknown[],
    schemes: [] as unknown[],
    registryEvidence: [] as unknown[],
    postRestore: [] as unknown[],
    cells: notRunCells() as CellRow[],
    errors: [] as string[],
    summary: tally(notRunCells()),
  };
  const file = info.outputPath("high-contrast.json");
  const write = recorder(file, record);
  const save = () => {
    record.summary = tally(record.cells, record.errors);
    write();
  };

  // One run of the script; its polling evidence is kept whether it passed or not.
  const transition = (
    action: "enable" | "restore",
    scheme: Scheme,
    lastEnabled: Scheme | null,
  ) => {
    const evidence = info.outputPath(
      `hc-${action}-${scheme.replaceAll(" ", "-")}.json`,
    );
    try {
      return spi(action, {
        scheme,
        baseline: baseline.path,
        lastEnabled,
        evidence,
      });
    } finally {
      record.transitions.push({ action, scheme, evidence: readJson(evidence) });
      save();
    }
  };

  for (const scheme of schemes) {
    const previous = readLastEnabled(baseline.run.dir);
    const live = spi("read");
    const drift = restoredProblems(baseline.state, live, previous);
    record.beforeChange.push({ scheme, previous, live, problems: drift });
    if (drift.length > 0) {
      const message = `${scheme}: the live state differs from the baseline before the change: ${drift.join("; ")}`;
      record.errors.push(message);
      save();
      throw new Error(message);
    }
    save();
    recordLastEnabled(baseline.run.dir, scheme);
    await withRestore({
      change: async () => {
        const on = transition("enable", scheme, previous);
        const unready = enableProblems(baseline.state, on, scheme);
        if (unready.length > 0)
          throw new Error(`${scheme}: enable: ${unready.join("; ")}`);
        // Launched after the change, so the engine starts under the OS setting.
        const browser = await playwright[engine].launch({
          headless: true,
          ...(info.project.use.channel === undefined
            ? {}
            : { channel: info.project.use.channel }),
        });
        try {
          const page = await open(browser);
          const detected = await forced(page);
          record.schemes.push({
            scheme,
            detected,
            window: on.colours["window"],
            windowText: on.colours["windowText"],
            prefersDark: await page.evaluate(
              () => matchMedia("(prefers-color-scheme: dark)").matches,
            ),
            palette: detected ? await palette(page) : null,
          });
          save();
          if (detected !== capability[engine].detects)
            throw new Error(
              `${scheme}: ${engine} detects forced colours ${String(detected)}, recorded ${String(capability[engine].detects)}`,
            );
          const place = (row: { key: string }) =>
            record.cells.findIndex(
              (c) => c.scheme === scheme && c.key === row.key,
            );
          if (!detected) {
            for (const row of unsupportedCells(engine, scheme))
              record.cells[place(row)] = row;
            info.annotations.push({
              type: "unsupported",
              description: `${engine} does not detect real high contrast (${scheme}); ${String(groupDCells().length)} Group D cells unsupported, not a pass`,
            });
            save();
          } else
            for (const cell of groupDCells()) {
              await resize(page, viewportAt(cell.width));
              await setTheme(page, cell.theme);
              const measured = await indicators(page);
              const pixel = await swatch(page);
              const fails = judge(measured);
              // Compared with the palette read back in this run, never with fixed constants.
              const want = channels(on.colours["window"] ?? "");
              if (
                capability[engine].followsOs &&
                pixel.join(",") !== want.join(",")
              )
                fails.push(
                  `Canvas pixel ${pixel.join(",")} is not the OS window colour ${want.join(",")}`,
                );
              record.cells[place(cell)] = {
                scheme,
                key: cell.key,
                width: cell.width,
                theme: cell.theme ?? "absent",
                verdict: verdictOf(engine, detected, fails),
                indicators: measured,
                pixel,
                fails,
              };
              save();
            }
        } finally {
          await browser.close();
        }
      },
      restore: async () => {
        const restored = transition("restore", scheme, scheme);
        record.registryEvidence.push({
          scheme,
          fields: registryEvidence(baseline.state, restored),
        });
        const left = restoredProblems(baseline.state, restored, scheme);
        if (left.length > 0)
          throw new Error(`${scheme}: restored state: ${left.join("; ")}`);
        const accepted = realClock.now();
        const since = () => Math.round(realClock.now() - accepted);
        const cycle = `${info.project.name}/${scheme}`;
        const check = {
          cycle,
          engine,
          scheme,
          project: info.project.name,
          doneMs: null as number | null,
          forced: null as boolean | null,
          state: restored,
          error: null as string | null,
        };
        const stop = new AbortController();
        try {
          await beforeDeadline(
            () =>
              fullChromium(async (page) => {
                check.forced = await forced(page);
              }, stop.signal),
            {
              start: accepted,
              ms: postRestoreDeadlineMs,
              clock: realClock,
              stop: () => {
                stop.abort();
              },
            },
          );
        } catch (error) {
          check.error = error instanceof Error ? error.message : String(error);
        }
        check.doneMs = since();
        const root = dirname(baseline.run.dir);
        try {
          settlePostRestore({
            check,
            baseline: baseline.state,
            append: (row) => {
              record.postRestore.push(row);
              save();
              recordCycle(root, row);
            },
          });
        } catch (error) {
          throw new Error(
            `${scheme}: full Chromium after restore: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      },
      note: (errors) => {
        record.errors.push(...errors);
        save();
      },
    });
  }

  await info.attach("high-contrast.json", {
    path: file,
    contentType: "application/json",
  });
  expect(record.cells, "one row per scheme and cell").toHaveLength(
    schemes.length * groupDCells().length,
  );
  expect(record.summary.failed, "Group D under real high contrast").toEqual([]);
  expect(record.summary.passed, "a complete matrix with no failed cell").toBe(
    true,
  );
});
