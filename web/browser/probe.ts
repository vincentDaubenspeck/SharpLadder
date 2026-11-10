import type { Locator, Page } from "@playwright/test";
import type { PageState } from "./catalogue.ts";
import { sha256, type Environment } from "./fonts.ts";
import { ports } from "./pins.ts";

export const distUrl = `http://127.0.0.1:${String(ports.dist)}/`;
export const specimenUrl = `http://127.0.0.1:${String(ports.specimen)}/`;

/** Puts the page in one theme state: the root attribute plus emulated scheme and media. */
export async function setState(page: Page, state: Omit<PageState, "work">) {
  await page.emulateMedia({
    colorScheme: state.scheme,
    media: state.print ? "print" : "screen",
  });
  await page.evaluate((theme) => {
    const root = document.documentElement;
    if (theme === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, state.theme);
}

export interface Reading {
  name: string;
  actual: string;
  expected: string;
}

/**
 * Each token measured through a typed property on a probe, beside a twin probe holding the
 * catalogue value, so both sides are serialised by the same engine.
 */
export async function readTokens(
  page: Page,
  probes: { name: string; property: string; expected: string }[],
  work: boolean,
): Promise<Reading[]> {
  return page.evaluate(
    ({ probes, work }) => {
      const host = document.createElement("div");
      if (work) host.className = "work";
      document.body.append(host);
      const out = probes.map(({ name, property, expected }) => {
        const a = document.createElement("div");
        const b = document.createElement("div");
        host.append(a, b);
        a.style.setProperty(property, `var(${name})`);
        b.style.setProperty(property, expected);
        const read = (el: HTMLElement) =>
          getComputedStyle(el).getPropertyValue(property);
        return { name, actual: read(a), expected: read(b) };
      });
      host.remove();
      return out;
    },
    { probes, work },
  );
}

/** Computed colours of the named tokens, as the engine resolves them in that scope. */
export async function readColours(
  page: Page,
  names: string[],
  work: boolean,
): Promise<Record<string, string>> {
  return page.evaluate(
    ({ names, work }) => {
      const host = document.createElement("div");
      if (work) host.className = "work";
      document.body.append(host);
      const out: Record<string, string> = {};
      for (const name of names) {
        const el = document.createElement("div");
        host.append(el);
        el.style.setProperty("color", `var(${name})`);
        out[name] = getComputedStyle(el).color;
      }
      host.remove();
      return out;
    },
    { names, work },
  );
}

const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};

/** Pixels that differ between two screenshots, counted by the engine under test. */
export async function differing(page: Page, a: Uint8Array, b: Uint8Array) {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (data: string) => {
        const blob = await (
          await fetch(`data:image/png;base64,${data}`)
        ).blob();
        return createImageBitmap(blob);
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return -1;
      const pixels = (img: ImageBitmap) => {
        // A detached canvas, since WebKit on Windows has no OffscreenCanvas.
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no 2d context");
        context.drawImage(img, 0, 0);
        return context.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = [pixels(x), pixels(y)];
      let count = 0;
      for (let i = 0; i < p.length; i += 4)
        if (
          p[i] !== q[i] ||
          p[i + 1] !== q[i + 1] ||
          p[i + 2] !== q[i + 2] ||
          p[i + 3] !== q[i + 3]
        )
          count += 1;
      return count;
    },
    [base64(a), base64(b)] as const,
  );
}

// Widened from Playwright's Buffer, so callers see the plain byte array they compare.
export const shot = async (
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
) =>
  (await page.screenshot({
    clip,
    animations: "disabled",
    caret: "hide",
  })) as Uint8Array;

/** The element's box grown by a margin, so an outline outside the border box is in the shot. */
async function around(target: Locator, margin: number) {
  const box = await target.boundingBox();
  if (box === null) throw new Error("the specimen element has no box");
  return {
    x: Math.max(0, box.x - margin),
    y: Math.max(0, box.y - margin),
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
}

/**
 * How many CSS pixels change when a style is applied to the target: the paint that style
 * removes or adds, measured in the engine's own screenshot. Inline styles are test-only.
 */
export async function paintOf(
  page: Page,
  target: Locator,
  style: Record<string, string>,
  margin = 8,
) {
  const clip = await around(target, margin);
  const before = await shot(page, clip);
  const previous = await target.evaluate((el, style) => {
    const saved = (el as HTMLElement).style.cssText;
    for (const [k, v] of Object.entries(style))
      (el as HTMLElement).style.setProperty(k, v);
    return saved;
  }, style);
  const after = await shot(page, clip);
  await target.evaluate((el, saved) => {
    (el as HTMLElement).style.cssText = saved;
  }, previous);
  const scale = await page.evaluate(() => window.devicePixelRatio);
  return (await differing(page, before, after)) / (scale * scale);
}

// Readiness only covers loads already started, so layout is forced first and settling repeats until idle.
export async function settle(page: Page) {
  await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      });
    do {
      void document.body.getBoundingClientRect();
      await frame();
      await document.fonts.ready;
      await frame();
    } while (document.fonts.status !== "loaded");
  });
}

/** Every font response the page receives, with the hash of the bytes it actually got. */
export function watchFonts(page: Page) {
  const seen: Promise<{ path: string; sha256: string; bytes: number }>[] = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (
      !pathname.endsWith(".woff2") &&
      !response.headers()["content-type"]?.startsWith("font/")
    )
      return;
    seen.push(
      response.body().then((body) => ({
        path: pathname.slice(1),
        sha256: sha256(body as Uint8Array),
        bytes: (body as Uint8Array).length,
      })),
    );
  });
  return async () =>
    (await Promise.all(seen)).sort((a, b) => a.path.localeCompare(b.path));
}

/** The labelled test-only stack: the shipped stacks with the environment's dropped families removed. */
export async function applyEnvironment(page: Page, env: Environment) {
  return page.evaluate(
    ({ drop, testOnly }) => {
      const root = getComputedStyle(document.documentElement);
      const stacks: Record<string, string> = {};
      let dropped = 0;
      for (const name of ["--font-ui", "--font-display", "--font-code"]) {
        const families = root
          .getPropertyValue(name)
          .split(",")
          .map((family) => family.trim());
        const kept = families.filter(
          (family) => !drop.includes(family.replace(/^"|"$/g, "")),
        );
        dropped += families.length - kept.length;
        stacks[name] = kept.join(", ");
      }
      // A family the shipped stacks no longer name would leave the test-only stack untested.
      if (dropped !== drop.length)
        throw new Error(
          `test-only stack: dropped ${String(dropped)} of ${drop.join(", ")}`,
        );
      if (testOnly) {
        const style = document.createElement("style");
        style.dataset["testOnly"] = "font-environment";
        style.textContent = `:root { ${Object.entries(stacks)
          .map(([name, value]) => `${name}: ${value};`)
          .join(" ")} }`;
        document.head.append(style);
      }
      return stacks;
    },
    { drop: env.drop, testOnly: env.testOnly },
  );
}
