// Suppression-reason policy. Run alone with inline config off (npm run lint:comments),
// so no file can switch it off; eslint.config.js applies the same rules to npm run lint.
import comments from "@eslint-community/eslint-plugin-eslint-comments";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import directiveSingleLine from "./eslint-rules/directive-single-line.js";

export const commentPolicy = {
  plugins: {
    "@eslint-community/eslint-comments": comments,
    local: { rules: { "directive-single-line": directiveSingleLine } },
  },
  rules: {
    "@eslint-community/eslint-comments/require-description": [
      "error",
      { ignore: [] },
    ],
    "local/directive-single-line": "error",
  },
};

export default defineConfig([
  globalIgnores(["**/dist", "**/coverage", ".tools"]),
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    // Directives are inert in this pass, so the unused-directive reports belong to npm run lint.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
      reportUnusedInlineConfigs: "off",
    },
    ...commentPolicy,
  },
]);
