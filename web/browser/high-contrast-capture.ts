// The one way a page is opened and captured for the real high-contrast run, used by the global
// setup for the baseline and by the spec after each restore, so both captures match exactly.
import { chromium, type Browser, type Page } from "@playwright/test";
import { base64 } from "./fonts.ts";
import { viewportAt } from "./group-d.ts";
import { settle, shot, specimenUrl } from "./probe.ts";

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

/** The client area with scrollbars hidden, so a fading scrollbar is never in either capture. */
export async function capture(page: Page) {
  await page.addStyleTag({
    content: "html, body { scrollbar-width: none; }",
  });
  await settle(page);
  const client = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  return shot(page, { x: 0, y: 0, ...client });
}

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

/** What the page reports about focus and scale at the moment of the check. */
export const focusOf = (page: Page) =>
  page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    activeElement:
      document.activeElement === null
        ? null
        : {
            tag: document.activeElement.tagName,
            id: document.activeElement.id,
          },
    hasFocus: document.hasFocus(),
  }));

/** The PNG decoded by the engine's own canvas, the same decode the comparison uses. */
export async function rgbaOf(page: Page, png: Uint8Array) {
  const decoded = await page.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const image = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let text = "";
    // Chunked, since spreading millions of bytes overflows the argument limit.
    for (let i = 0; i < pixels.length; i += 0x8000)
      text += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
    return { width: image.width, height: image.height, data: btoa(text) };
  }, base64(png));
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8Array(Buffer.from(decoded.data, "base64")),
  };
}

/** RGBA pixels encoded as a PNG by the engine's canvas. */
export async function pngOf(
  page: Page,
  image: { width: number; height: number; data: Uint8Array },
) {
  const url = await page.evaluate(
    ({ width, height, data }) => {
      const bytes = Uint8ClampedArray.from(atob(data), (c) => c.charCodeAt(0));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context");
      context.putImageData(new ImageData(bytes, width, height), 0, 0);
      return canvas.toDataURL("image/png");
    },
    { width: image.width, height: image.height, data: base64(image.data) },
  );
  return new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
}
