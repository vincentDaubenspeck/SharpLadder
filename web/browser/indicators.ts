// Group D indicator measurements and thresholds, shared by the emulated and the real high-contrast specs.
import { expect, type Locator, type Page } from "@playwright/test";
import type { Theme } from "./group-d.ts";
import { differing, paintOf, shot } from "./probe.ts";

export const spec = (page: Page, name: string) =>
  page.locator(`[data-spec="${name}"]`);

export async function setTheme(page: Page, theme: Theme) {
  await page.evaluate((t) => {
    if (t === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }, theme);
}

// Desktop WebKit can return pre-resize box geometry until its next rendering update, so one is awaited.
export async function resize(
  page: Page,
  size: { width: number; height: number },
) {
  await page.setViewportSize(size);
  // Mobile Chromium keeps a pinch scale across a resize, which moves the visual viewport off the shots.
  if (page.context().browser()?.browserType().name() === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await session.detach();
  }
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );
  expect(
    await page.evaluate(() => visualViewport?.scale),
    "the visual viewport is unscaled",
  ).toBe(1);
}

/** Focuses a specimen by keyboard, so :focus-visible applies as it would for a user. */
export async function tabTo(page: Page, name: string) {
  await page.locator("body").focus();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    if (await spec(page, name).evaluate((el) => el === document.activeElement))
      return;
  }
  throw new Error(`Tab never reached ${name}`);
}

export const perimeter = (
  box: { width: number; height: number },
  gap: number,
  width: number,
) => 2 * (box.width + 2 * gap + box.height + 2 * gap) * width;

/**
 * Pixels that differ between the bottom border strip and the padding strip just above it; zero
 * means a rest-state border paints nothing distinguishable from what it sits on.
 */
async function restStroke(page: Page, target: Locator) {
  // A taller font environment can push the tab past the phone viewport, where a strip would be clipped.
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("no rest-border box");
  const strip = (y: number) => ({ x: box.x, y, width: box.width, height: 2 });
  const [border, padding] = [
    await shot(page, strip(box.y + box.height - 2)),
    await shot(page, strip(box.y + box.height - 6)),
  ];
  return differing(page, border, padding);
}

/** Every TH4 and Group D assertion for one state, as measured paint in CSS pixels. */
const measured = [
  "focusOutline",
  "nestedFocus",
  "nestedRing",
  "clippedFocus",
  "rungRing",
  "readLines",
  "readRing",
  "stroke",
  "restBorder",
  "sourceVsDestination",
] as const;
export type Indicators = Record<(typeof measured)[number], number>;

export async function indicators(page: Page): Promise<Indicators> {
  const out = Object.fromEntries(
    measured.map((k) => [k, Number.NaN]),
  ) as Indicators;
  const focus = spec(page, "focus");
  await tabTo(page, "focus");
  const focusBox = await focus.boundingBox();
  if (focusBox === null) throw new Error("no focus box");
  out.focusOutline =
    (await paintOf(page, focus, { "outline-style": "none" })) /
    perimeter(focusBox, 2, 2);
  await tabTo(page, "nested");
  const nested = spec(page, "nested");
  const nestedBox = await nested.boundingBox();
  if (nestedBox === null) throw new Error("no nested box");
  out.nestedFocus =
    (await paintOf(page, nested, { "outline-style": "none" })) /
    perimeter(nestedBox, 2, 2);
  out.nestedRing = await paintOf(page, spec(page, "nest"), {
    "outline-style": "none",
  });
  await tabTo(page, "clipped");
  const clipped = spec(page, "clipped");
  const clippedBox = await clipped.boundingBox();
  if (clippedBox === null) throw new Error("no clipped box");
  out.clippedFocus =
    (await paintOf(page, clipped, { "outline-style": "none" })) /
    perimeter(clippedBox, 2, 2);
  await page.locator("body").focus();
  const rung = spec(page, "rung");
  const rungBox = await rung.boundingBox();
  if (rungBox === null) throw new Error("no rung box");
  out.rungRing =
    (await paintOf(page, rung, { "outline-style": "none" })) /
    perimeter(rungBox, 0, 4);
  const read = spec(page, "read");
  const lines = await read.evaluate((el) => el.getClientRects().length);
  out.readLines = lines;
  out.readRing = await paintOf(page, read, { "outline-style": "none" });
  out.stroke =
    (await paintOf(page, spec(page, "stroke"), {
      "border-inline-start-style": "none",
    })) / 48;
  out.restBorder = await restStroke(page, spec(page, "tab"));
  out.sourceVsDestination = await paintOf(
    page,
    spec(page, "dst"),
    { "border-style": "solid" },
    0,
  );
  return out;
}

/** The thresholds each measurement must meet; a control proves each can fail. */
export function judge(m: Indicators) {
  const fails: string[] = [];
  const atLeast = (k: keyof Indicators, min: number) => {
    if (!(m[k] >= min)) fails.push(`${k}=${String(m[k])} < ${String(min)}`);
  };
  atLeast("focusOutline", 0.6);
  // The ancestor ring crosses the nested focus ring, so less of it is exposed than alone.
  atLeast("nestedFocus", 0.4);
  atLeast("nestedRing", 40);
  atLeast("clippedFocus", 0.6);
  atLeast("rungRing", 0.5);
  atLeast("readLines", 2);
  atLeast("readRing", 40);
  atLeast("stroke", 0.8);
  atLeast("sourceVsDestination", 20);
  if (m.restBorder !== 0)
    fails.push(`restBorder=${String(m.restBorder)} paints`);
  return fails;
}
