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
import {
  applicationSource,
  exactUnits,
  typedSource,
  untypedSource,
} from "./eslint-rules/application-source.js";
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

// A static key: a plain name, or a string or substitution-free template in brackets. A plain
// name needs computed=false, so obj[fonts] reads as a variable, not as the key "fonts".
const keyed = (prefixes, key, name) =>
  `:matches(${prefixes
    .flatMap((at) => [
      `[${at}computed=false][${at}${key}.name="${name}"]`,
      `[${at}${key}.value="${name}"]`,
      `[${at}${key}.expressions.length=0][${at}${key}.quasis.0.value.cooked="${name}"]`,
    ])
    .join(", ")})`;
// The expression form sees through one wrapper: an optional chain in brackets, ! or a cast.
const fontsAt = (field) =>
  keyed([`${field}.`, `${field}.expression.`], "property", "fonts");
const keyIs = (name) => keyed([""], "key", name);
const memberIs = (name) => keyed([""], "property", name);

// An entry names its subject node type so an exemption can spare that node. A helper exemption
// is lexical, so a function nested inside the helper is exempt too. Not caught: an alias
// (const f = document.fonts; f.ready), a second wrapper level
// ((document.fonts! as FontFaceSet).ready), a defaulted nested pattern
// (const { fonts: { ready } = {} } = document), a viewport set through newContext, test.use or
// CDP, and string-form evaluate.
const fontsReady = [
  [
    "MemberExpression",
    `MemberExpression${memberIs("ready")}${fontsAt("object")}`,
  ],
  [
    "Property",
    `VariableDeclarator${fontsAt("init")} > ObjectPattern > Property${keyIs("ready")}`,
  ],
  [
    "Property",
    `AssignmentExpression${fontsAt("right")} > ObjectPattern > Property${keyIs("ready")}`,
  ],
  [
    "Property",
    `Property${keyIs("fonts")} > ObjectPattern > Property${keyIs("ready")}`,
  ],
];
const anyObject = (name) => [
  ["MemberExpression", `MemberExpression${memberIs(name)}`],
  ["Property", `ObjectPattern > Property${keyIs(name)}`],
];
const bans = {
  fontsReady: {
    entries: fontsReady,
    message:
      "Wait for fonts through settle(page) in probe.ts, never a bare document.fonts.ready (Project-Standards section 12).",
  },
  viewport: {
    entries: anyObject("setViewportSize"),
    message:
      "Change the viewport through resize() in indicators.ts, which waits for the change to apply (Project-Standards section 12).",
  },
  sleep: {
    entries: anyObject("waitForTimeout"),
    message:
      "A fixed sleep is never a readiness point; wait for the state itself (Project-Standards section 12).",
  },
};

/** Every ban; an exempted ban still applies everywhere outside its helper function. */
function browserTiming(exempt = {}) {
  return [
    "error",
    ...Object.entries(bans).flatMap(([ban, { entries, message }]) =>
      entries.map(([subject, selector]) => ({
        selector:
          exempt[ban] === undefined
            ? selector
            : `${selector}:not(FunctionDeclaration[id.name="${exempt[ban]}"] ${subject})`,
        message,
      })),
    ),
  ];
}

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
  // A later matching block replaces rule options whole, so each block repeats every ban.
  {
    files: ["browser/**/*.{ts,mjs}"],
    rules: { "no-restricted-syntax": browserTiming() },
  },
  {
    files: ["browser/probe.ts"],
    rules: { "no-restricted-syntax": browserTiming({ fontsReady: "settle" }) },
  },
  {
    files: ["browser/indicators.ts"],
    rules: { "no-restricted-syntax": browserTiming({ viewport: "resize" }) },
  },
  // A file must not choose which checks it meets, so no comment in application source can
  // disable or reconfigure any lint rule. The blocks below select a file by where the shared
  // mapper places it, so another spelling of the same file meets the same policy, and a name the
  // mapper cannot place meets it too; directives outside src keep their effect.
  {
    files: [applicationSource],
    linterOptions: { noInlineConfig: true },
    rules: {
      "no-eval": "error",
      "no-new-func": "error",
      "sharpladder/app-capabilities": "error",
    },
  },
  // The type emitter's grammar admits only type aliases, so it never emits an interface. An
  // exemption names the exact files on disk, so no other name or letter case shares it.
  {
    files: [exactUnits("generated/body.ts", "generated/content.ts")],
    rules: { "@typescript-eslint/consistent-type-definitions": "off" },
  },
  // A browser may drop the list semantics of an ol whose markers the theme hides.
  {
    files: [exactUnits("content/WalkStepper.tsx", "content/Blocks.tsx")],
    rules: { "jsx-a11y-x/no-redundant-roles": ["error", { ol: ["list"] }] },
  },
  // A default that calls assertNever is kept, but never counts as covering a missing case.
  {
    files: [typedSource],
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
  // Any other script name, a capital extension included, would skip the type-aware lint, so it
  // is parsed with the TypeScript parser, without type information, only to be rejected.
  {
    files: [untypedSource],
    languageOptions: {
      parser: tseslint.parser,
      // The root is named, since the parser cannot choose one when two projects share a process.
      parserOptions: {
        ecmaFeatures: { jsx: true },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { "sharpladder/source-extension": "error" },
  },
  // Last, so formatting is Prettier's alone.
  prettier,
]);
