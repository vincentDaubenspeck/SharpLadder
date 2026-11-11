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
import appCapabilities from "./eslint-rules/app-capabilities.js";
import cssModuleAccess from "./eslint-rules/css-module-access.js";
import sourceExtension from "./eslint-rules/source-extension.js";

// The repository phrase list is the one source of banned comment markers.
const markers = readFileSync(
  new URL("../tools/forbidden-phrases.txt", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => line.startsWith("~"))
  .map((line) => line.slice(1).trim());

export default defineConfig([
  globalIgnores(["dist", "coverage", ".cache"]),
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
    plugins: {
      sharpladder: {
        rules: {
          "app-capabilities": appCapabilities,
          "css-module-access": cssModuleAccess,
          "source-extension": sourceExtension,
        },
      },
    },
    rules: { "sharpladder/css-module-access": "error" },
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
  // The project service finds only tsconfig.json, so the browser tooling and the Vite config,
  // which need Node types, name their own program.
  {
    files: [
      "playwright.config.ts",
      "vite.config.ts",
      "build-guard/index.d.ts",
      "browser/**/*.ts",
      "content-check/**/*.ts",
      "stylelint/registry.d.ts",
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.browser.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...["type-tests", "harness"].map((name) => ({
    files: [`${name}/**/*.{ts,tsx}`],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: `./tsconfig.${name}.json`,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/**"],
    rules: {
      "no-eval": "error",
      "no-new-func": "error",
      "sharpladder/app-capabilities": "error",
    },
  },
  // The type emitter's grammar admits only type aliases, so it never emits an interface.
  {
    files: ["src/generated/body.ts", "src/generated/content.ts"],
    rules: { "@typescript-eslint/consistent-type-definitions": "off" },
  },
  // A default that calls assertNever is kept, but never counts as covering a missing case.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          allowDefaultCaseForExhaustiveSwitch: true,
          considerDefaultExhaustiveForUnions: false,
        },
      ],
    },
  },
  // Any other code extension in src would skip the type-aware lint, so it is
  // parsed without type information only to be rejected.
  {
    files: ["src/**/*.{js,jsx,mjs,cjs,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { "sharpladder/source-extension": "error" },
  },
  // Last, so formatting is Prettier's alone.
  prettier,
]);
