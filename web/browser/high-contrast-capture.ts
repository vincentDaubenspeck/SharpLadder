// The one way a page is opened for the real high-contrast run, used by the global setup before
// any change and by the spec during each scheme and after each restore.
import { chromium, type Browser, type Page } from "@playwright/test";
import { viewportAt } from "./group-d.ts";
import { settle, specimenUrl } from "./probe.ts";

// No emulated media, so the page sees only what the OS reports.
const unEmulated = {
  forcedColors: null,
  colorScheme: null,
  reducedMotion: null,
  contrast: null,
} as const;
const desktop = viewportAt(1920);

export async function open(browser: Browser) {
  const context = await browser.newContext({
    ...unEmulated,
    viewport: desktop,
    screen: desktop,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(specimenUrl);
  await page.locator('[data-spec="rung"]').waitFor({ state: "visible" });
  await settle(page);
  return page;
}

export const forced = (page: Page) =>
  page.evaluate(() => matchMedia("(forced-colors: active)").matches);

/**
 * A fresh headless full-Chromium launch, always closed, with the opened page handed to body. An
 * abort closes the browser at once, so a step still waiting on it fails instead of hanging.
 */
export async function fullChromium<T>(
  body: (page: Page) => Promise<T>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
  });
  const close = () => {
    void browser.close();
  };
  signal?.addEventListener("abort", close, { once: true });
  try {
    signal?.throwIfAborted();
    return await body(await open(browser));
  } finally {
    signal?.removeEventListener("abort", close);
    await browser.close();
  }
}
