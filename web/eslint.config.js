import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import { readFileSync } from "node:fs";
import tseslint from "typescript-eslint";
import { commentPolicy } from "./eslint.comments.config.js";

// The repository phrase list is the one source of banned comment markers.
const markers = readFileSync(
  new URL("../tools/forbidden-phrases.txt", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => line.startsWith("~"))
  .map((line) => line.slice(1).trim());

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  commentPolicy,
  {
    rules: {
      "no-warning-comments": [
        "error",
        { terms: markers, location: "anywhere" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
      jsxA11y.configs.strict,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  // Last, so formatting is Prettier's alone.
  prettier,
]);
