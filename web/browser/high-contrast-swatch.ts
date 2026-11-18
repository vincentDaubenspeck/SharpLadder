// Apart from the spec, so its failure paths can be checked without a browser.
import type { Page } from "@playwright/test";
import { base64 } from "./fonts.ts";
import { settle, SettleTimeout, shot } from "./probe.ts";

/** The rendered colour of a page-background swatch, read from the engine's own screenshot. */
export async function swatch(page: Page): Promise<[number, number, number]> {
  let measurementFailed = false;
  let measurementError: unknown;
  let colour: [number, number, number] = [-1, -1, -1];
  try {
    // Test-only swatch; under forced colours its background is the system Canvas colour.
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.setAttribute("data-hc-swatch", "");
      box.style.cssText =
        "position:fixed;right:0;bottom:0;width:16px;height:16px;background-color:var(--bg)";
      document.body.append(box);
    });
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
    // A wait that ran out leaves the page unfit for the cleanup below.
    if (error instanceof SettleTimeout) throw error;
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
