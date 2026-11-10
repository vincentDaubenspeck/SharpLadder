import { compileCss } from "./knip/css-modules.js";

export default {
  entry: [
    "lint-comments.js",
    "eslint.comments.config.js",
    "stylelint/extract/extract-mockup.mjs",
    "stylelint/extract/mockup-tokens.mjs",
    "source-check/install-acceptance.js",
    // Types for the plugin import in vite.config.ts; knip resolves that import to the .js file.
    "build-guard/index.d.ts",
  ],
  // Loaded by path in fonts/convert.js, so its version and WASM bytes are checked before use.
  ignoreDependencies: ["fonteditor-core"],
  project: ["**/*.{js,mjs,ts,tsx}", "**/*.module.css"],
  vite: true,
  vitest: true,
  compilers: { css: compileCss },
};
