// The pinned engines the browser tests may run: checked before any project is defined.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const repo = join(import.meta.dirname, "..", "..");

type Kind = "dist" | "specimen" | "harness";
type Engine = "chromium" | "firefox" | "webkit";
interface Build {
  dir: string;
  executable: string;
  browserVersion: string;
}
interface Pins {
  version: string;
  windows: { browsersPath: string; builds: Record<Engine, Build> };
  image: { browsersPath: string };
}

/** The read-only servers: the release dist, the specimen build and the content harness. */
export const ports: Readonly<Record<Kind, number>> = {
  dist: 4173,
  specimen: 4174,
  harness: 4175,
};

/** The server command, run by the pinned Node that runs the tests; any other Node fails. */
export function serverCommand(kind: Kind): string {
  const pinned = readFileSync(join(repo, "web", ".nvmrc"), "utf8").trim();
  if (process.version !== `v${pinned}`)
    throw new Error(
      `browser pins: Node ${process.version} runs the tests, ${pinned} is pinned`,
    );
  return `"${process.execPath}" browser/serve.mjs ${kind} ${String(ports[kind])}`;
}

const real = (p: string): string => {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
};
const fold = (p: string): string =>
  process.platform === "win32" ? real(p).toLowerCase() : real(p);

const fail = (message: string): never => {
  throw new Error(`browser pins: ${message}`);
};

/**
 * Fails unless Playwright runs with downloads off and the browsers path set to the provisioned
 * pinned tree, the installed package is the pinned version and each engine's pinned build is
 * present. Returns the pinned browser version per engine.
 */
export function pinnedEngines(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): Record<Engine, string> {
  const pins = (
    JSON.parse(readFileSync(join(repo, "tools", "tool-pins.json"), "utf8")) as {
      playwright?: Pins;
    }
  ).playwright;
  if (pins === undefined)
    return fail("tools/tool-pins.json has no playwright entry");
  if (env["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] !== "1")
    fail("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD must be 1");
  const web = createRequire(join(repo, "web", "package.json"));
  const installed = JSON.parse(
    readFileSync(web.resolve("@playwright/test/package.json"), "utf8"),
  ) as { version: string };
  if (installed.version !== pins.version)
    fail(
      `@playwright/test ${installed.version} is installed, ${pins.version} is pinned`,
    );
  const set = env["PLAYWRIGHT_BROWSERS_PATH"];
  if (set === undefined || set === "")
    return fail("PLAYWRIGHT_BROWSERS_PATH is not set");
  const { builds } = pins.windows;
  if (platform === "win32") {
    const path = join(repo, pins.windows.browsersPath);
    if (fold(set) !== fold(path))
      fail(`PLAYWRIGHT_BROWSERS_PATH ${set} is not the pinned tree`);
    for (const name of ["chromium", "firefox", "webkit"] as const) {
      const exe = join(path, builds[name].dir, builds[name].executable);
      if (!existsSync(exe))
        fail(
          `${builds[name].dir}/${builds[name].executable} is not provisioned`,
        );
    }
  } else if (platform === "linux") {
    // Inside the pinned image the tree is the image's own, verified by its digest.
    if (set !== pins.image.browsersPath)
      fail(
        `PLAYWRIGHT_BROWSERS_PATH ${set} is not the image path ${pins.image.browsersPath}`,
      );
  } else fail(`no pinned browsers for ${platform}`);
  return {
    chromium: builds.chromium.browserVersion,
    firefox: builds.firefox.browserVersion,
    webkit: builds.webkit.browserVersion,
  };
}
