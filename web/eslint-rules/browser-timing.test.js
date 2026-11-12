// @vitest-environment node
import { ESLint } from "eslint";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { web } from "./production-eslint.js";

// The real configuration; .ts cases borrow existing browser paths so the typed program accepts them.
const eslint = new ESLint({
  cwd: web,
  // The override makes lintText lint the supplied text, not the on-disk file.
  overrideConfig: {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        disallowAutomaticSingleRunInference: true,
      },
    },
  },
});
const ts = "browser/fonts.pw.ts";
const mjs = "browser/lint-case.mjs";

/** The 1-based lines a timing ban reports; a parse error fails, so a broken case cannot pass. */
async function banned(lines, filePath) {
  const [result] = await eslint.lintText(`${lines.join("\n")}\n`, {
    filePath,
  });
  expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  const at = result.messages
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => m.line);
  return [...new Set(at)].sort((a, b) => a - b);
}

const every = (lines) => lines.map((_, i) => i + 1);

const readyForms = [
  "document.fonts.ready;",
  'document.fonts["ready"];',
  'document["fonts"].ready;',
  'document["fonts"]["ready"];',
  "document.fonts[`ready`];",
  "document[`fonts`].ready;",
  "document?.fonts?.ready;",
  'document.fonts?.["ready"];',
  '(document?.["fonts"]).ready;',
  "const { ready } = document.fonts;",
  'const { ready: r1 } = document["fonts"];',
  'const { "ready": r2 } = document?.fonts;',
  "({ ready: globalThis.slot } = document.fonts);",
  "const { fonts: { ready: r3 } } = document;",
];

const methodForms = (name) => [
  `page.${name}(1);`,
  `page["${name}"](1);`,
  `page[\`${name}\`](1);`,
  `page?.${name}(1);`,
  `page?.["${name}"](1);`,
  `const { ${name} } = page;`,
  `const { "${name}": m1 } = page;`,
];

const allowed = [
  "document.fonts.status;",
  "document.fonts.add(face);",
  'document.fonts.check("12px x");',
  'document.fonts.load("12px x");',
  'new FontFace("x", data).load();',
  "Array.from(document.fonts);",
  "const { status } = document.fonts;",
  "document[fonts][ready];",
  "document.fonts[ready];",
  "server.ready;",
  "const { ready } = server;",
  "page.viewportSize();",
  "page[setViewportSize](1);",
  "page.clock.runFor(1);",
];

describe("browser timing bans in the real configuration", () => {
  it.each([ts, mjs])("every fonts.ready form fires in %s", async (file) => {
    expect(await banned(readyForms, file)).toEqual(every(readyForms));
  });

  it("the TypeScript wrappers around document.fonts fire", async () => {
    const forms = [
      "document.fonts!.ready;",
      "(document.fonts as FontFaceSet).ready;",
      "(document.fonts satisfies FontFaceSet).ready;",
    ];
    expect(await banned(forms, ts)).toEqual(every(forms));
  });

  it.each([
    [ts, "setViewportSize"],
    [mjs, "setViewportSize"],
    [ts, "waitForTimeout"],
    [mjs, "waitForTimeout"],
  ])("in %s every form of %s fires", async (file, name) => {
    const forms = methodForms(name);
    expect(await banned(forms, file)).toEqual(every(forms));
  });

  it.each([ts, mjs])(
    "FontFace use and other keys stay allowed in %s",
    async (file) => {
      expect(await banned(allowed, file)).toEqual([]);
    },
  );

  it("only settle in probe.ts may wait on fonts.ready, nested functions included", async () => {
    const code = [
      "export async function settle(page) {",
      "  await page.evaluate(async () => {",
      "    await document.fonts.ready;",
      '    const { ready } = document["fonts"];',
      "  });",
      "  await page.setViewportSize(1);",
      "  await page.waitForTimeout(1);",
      "}",
      "async function other() {",
      "  await document.fonts.ready;",
      "}",
    ];
    expect(await banned(code, "browser/probe.ts")).toEqual([6, 7, 10]);
  });

  it("only resize in indicators.ts may set the viewport", async () => {
    const code = [
      "export async function resize(page) {",
      "  await page.setViewportSize(1);",
      '  const run = () => page?.["setViewportSize"](1);',
      "  await document.fonts.ready;",
      "  await page.waitForTimeout(1);",
      "}",
      "async function other(page) {",
      "  await page.setViewportSize(1);",
      "}",
    ];
    expect(await banned(code, "browser/indicators.ts")).toEqual([4, 5, 8]);
  });

  it.each([ts, mjs])(
    "a same-named helper in %s is not exempt",
    async (file) => {
      const code = [
        "async function settle(page) {",
        "  await document.fonts.ready;",
        "}",
        "async function resize(page) {",
        "  await page.setViewportSize(1);",
        "}",
      ];
      expect(await banned(code, file)).toEqual([2, 5]);
    },
  );

  it("the shipped helpers lint clean while they hold the only uses", async () => {
    const files = ["browser/probe.ts", "browser/indicators.ts"];
    const texts = files.map((f) => readFileSync(join(web, f), "utf8"));
    expect(texts[0]).toContain("document.fonts.ready");
    expect(texts[1]).toContain("setViewportSize");
    const results = await eslint.lintFiles(files);
    expect(
      results.flatMap((r) =>
        r.messages.filter((m) => m.ruleId === "no-restricted-syntax"),
      ),
    ).toEqual([]);
  });
}, 60_000);
