import { defineConfig, type Project } from "@playwright/test";
import { pinnedEngines, ports, serverCommand } from "./browser/pins.ts";

// Fails before any project exists unless the provisioned pinned builds are the ones in use.
const versions = pinnedEngines();

const desktop = { width: 1920, height: 1080 };
const phone = { width: 390, height: 844 };

// Full Chromium, not the headless shell, so forced colours and the HC route see the same build.
const engines = {
  chromium: { browserName: "chromium", channel: "chromium" },
  firefox: { browserName: "firefox" },
  webkit: { browserName: "webkit" },
} as const;

// The real OS high-contrast run is opt-in and alone; the spec's own guard then demands a hosted runner.
const realHighContrast = process.env["SHARPLADDER_REAL_HIGH_CONTRAST"] === "1";
const highContrastSpec = /high-contrast\.pw\.ts$/u;

function project(
  name: string,
  engine: keyof typeof engines,
  size: typeof desktop,
  mobile: boolean,
): Project {
  return {
    name,
    metadata: { engine, version: versions[engine] },
    testIgnore: highContrastSpec,
    use: {
      ...engines[engine],
      viewport: size,
      screen: size,
      deviceScaleFactor: mobile ? 3 : 1,
      isMobile: mobile,
      hasTouch: mobile,
      locale: "en-GB",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "no-preference",
      forcedColors: "none",
    },
  };
}

export default defineConfig({
  testDir: "browser",
  testMatch: "*.pw.ts",
  outputDir: ".cache/playwright/results",
  // A retry would hide a failure, and only a reviewed change may write a baseline.
  retries: 0,
  updateSnapshots: "none",
  forbidOnly: true,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 5_000 },
  // The OS setting is session-wide, so the real high-contrast run never overlaps another test.
  ...(realHighContrast ? { workers: 1 } : {}),
  // One baseline for the whole real high-contrast run, captured before any project changes the OS.
  ...(realHighContrast
    ? { globalSetup: "./browser/high-contrast.setup.ts" }
    : {}),
  // These are phone-emulated projects, not evidence from Android or iOS devices.
  projects: realHighContrast
    ? (["chromium", "firefox", "webkit"] as const).map((engine) => ({
        name: `hc-${engine}`,
        metadata: { engine, version: versions[engine] },
        testMatch: highContrastSpec,
        // Four OS transitions, each bounded by a watchdog above its 30 s poll deadline.
        timeout: 240_000,
        use: { ...engines[engine], viewport: desktop, screen: desktop },
      }))
    : [
        project("desktop-chromium", "chromium", desktop, false),
        project("desktop-firefox", "firefox", desktop, false),
        project("desktop-webkit", "webkit", desktop, false),
        project("phone-chromium", "chromium", phone, true),
        project("phone-webkit", "webkit", phone, true),
      ],
  webServer: [
    {
      command: serverCommand("dist"),
      url: `http://127.0.0.1:${String(ports.dist)}/`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
    },
    {
      command: serverCommand("specimen"),
      url: `http://127.0.0.1:${String(ports.specimen)}/`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
    },
    {
      command: serverCommand("harness"),
      url: `http://127.0.0.1:${String(ports.harness)}/`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
    },
  ],
});
