import { compileCss } from "./knip/css-modules.js";

export default {
  entry: [
    "lint-comments.js",
    "eslint.comments.config.js",
    "stylelint/extract/extract-mockup.mjs",
    "source-check/install-acceptance.js",
    // Types for the plugin import in vite.config.ts; knip resolves that import to the .js file.
    "build-guard/index.d.ts",
  ],
  project: ["**/*.{js,mjs,ts,tsx}", "**/*.module.css"],
  vite: true,
  vitest: true,
  compilers: { css: compileCss },
};
