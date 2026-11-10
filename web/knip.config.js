import { compileCss } from "./knip/css-modules.js";

export default {
  entry: [
    "lint-comments.js",
    "eslint.comments.config.js",
    "stylelint/extract/extract-mockup.mjs",
    "stylelint/extract/mockup-tokens.mjs",
    "source-check/install-acceptance.js",
    // Started by the Playwright config as a web server command, not imported.
    "browser/serve.mjs",
    // Run by the CI browser jobs after the suite to collect unreviewed font identities.
    "browser/observed.mjs",
    // Run by the browser-windows job after the real high-contrast step to write the summary.
    "browser/high-contrast-summary.ts",
    // Types for the plugin import in vite.config.ts; knip resolves that import to the .js file.
    "build-guard/index.d.ts",
    // Types for the registry import in browser/catalogue.ts, which knip resolves to the .js file.
    "stylelint/registry.d.ts",
  ],
  // Loaded by path in fonts/convert.js, so its version and WASM bytes are checked before use.
  ignoreDependencies: ["fonteditor-core"],
  project: ["**/*.{js,mjs,ts,tsx}", "**/*.module.css"],
  // The config refuses to load outside the pinned browser environment, so the entries are named.
  playwright: {
    config: [],
    entry: [
      "playwright.config.ts",
      "browser/*.pw.ts",
      "browser/high-contrast.setup.ts",
    ],
  },
  vite: true,
  vitest: true,
  compilers: { css: compileCss },
};
