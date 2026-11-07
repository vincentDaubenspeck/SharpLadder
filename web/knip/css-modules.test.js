// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { compileCss, compileCssModule } from "./css-modules.js";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const knipBin = join(web, "node_modules", "knip", "bin", "knip.js");
const compiler = pathToFileURL(join(web, "knip", "css-modules.js")).href;

// The fixture imports the compiler by URL, which knip would otherwise list as a
// package named "file".
const knip = (files) => {
  const root = mkdtempSync(join(tmpdir(), "sl-knip-"));
  const all = {
    "package.json": '{ "name": "fixture", "private": true, "type": "module" }',
    "knip.config.js": [
      `import { compileCss } from ${JSON.stringify(compiler)};`,
      "export default {",
      '  entry: ["src/main.js"],',
      '  project: ["src/**/*.{js,css}"],',
      "  compilers: { css: compileCss },",
      '  ignoreDependencies: ["file"],',
      "};",
    ].join("\n"),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${text}\n`);
  }
  const result = spawnSync(
    process.execPath,
    [knipBin, "--directory", root, "--no-progress", "--reporter", "json"],
    { encoding: "utf8", env: { ...process.env, JITI_FS_CACHE: "false" } },
  );
  expect(result.stderr).toBe("");
  const { issues } = JSON.parse(result.stdout);
  const unused = {};
  for (const issue of issues) {
    expect(issue.unlisted).toEqual([]);
    expect(issue.unresolved).toEqual([]);
    expect(issue.exports).toEqual([]);
    const names = issue.enumMembers.map(({ name }) => name).sort();
    if (names.length > 0) unused[issue.file] = names;
    if (issue.files.length > 0) unused[issue.file] = "file";
  }
  return { status: result.status, unused };
};

describe("knip CSS module compiler", () => {
  it("exports every local name from the Lightning CSS map", () => {
    const out = compileCssModule(
      ".app-header { color: red } #main { color: blue } @keyframes spin {}",
      "/x/Card.module.css",
    );
    expect(out).toContain(
      'export enum Locals { "app-header" = "", "main" = "", "spin" = "" }',
    );
    expect(out).toContain(
      'import { Locals as self } from "./Card.module.css";',
    );
  });

  it("leaves global stylesheets without exports", () => {
    expect(compileCss(".x { color: red }", "/x/index.css")).toBe("");
  });

  it("fails on CSS that Lightning CSS cannot parse", () => {
    expect(() => compileCssModule("}}}", "/x/a.module.css")).toThrow();
  });

  it("flags only the classes a default import never reads", () => {
    const { status, unused } = knip({
      "src/main.js": [
        'import styles from "./Card.module.css";',
        'console.log(styles.title, styles["app-header"]);',
      ].join("\n"),
      "src/Card.module.css": [
        ".title { color: red }",
        ".app-header { color: green }",
        ".app-footer { color: blue }",
        ".spare { color: gray }",
      ].join("\n"),
    });
    expect(unused).toEqual({ "src/Card.module.css": ["app-footer", "spare"] });
    expect(status).toBe(1);
  });

  it("credits classes read by destructuring and expression-free templates", () => {
    const { status, unused } = knip({
      "src/main.js": [
        'import styles from "./Card.module.css";',
        "const { title, body: text } = styles;",
        "console.log(title, text, styles[`app-header`]);",
      ].join("\n"),
      "src/Card.module.css": [
        ".title { color: red }",
        ".body { color: green }",
        ".app-header { color: blue }",
        ".spare { color: gray }",
      ].join("\n"),
    });
    expect(unused).toEqual({ "src/Card.module.css": ["spare"] });
    expect(status).toBe(1);
  });

  it("counts composed classes as used, here and in the imported module", () => {
    const { status, unused } = knip({
      "src/main.js": [
        'import styles from "./Button.module.css";',
        "console.log(styles.button);",
      ].join("\n"),
      "src/Button.module.css": [
        '.button { composes: base from "./base.module.css"; composes: round }',
        ".round { border-radius: 4px }",
      ].join("\n"),
      "src/base.module.css": [
        ".base { color: red }",
        ".unrelated { color: blue }",
      ].join("\n"),
    });
    expect(unused).toEqual({ "src/base.module.css": ["unrelated"] });
    expect(status).toBe(1);
  });

  // Regression fixture of knip's own behaviour, not the acceptance case: the
  // ESLint rule css-module-access is what rejects a computed read.
  it("records that knip credits no class read through a computed key", () => {
    const { status, unused } = knip({
      "src/main.js": [
        'import styles from "./Tone.module.css";',
        "const tone = String(Date.now());",
        "console.log(styles[tone]);",
      ].join("\n"),
      "src/Tone.module.css": [
        ".calm { color: blue }",
        ".loud { color: red }",
      ].join("\n"),
    });
    expect(unused).toEqual({ "src/Tone.module.css": ["calm", "loud"] });
    expect(status).toBe(1);
  });

  it("passes when every class is read", () => {
    const { status, unused } = knip({
      "src/main.js": [
        'import styles from "./All.module.css";',
        "console.log(styles.one, styles.two);",
      ].join("\n"),
      "src/All.module.css": ".one { color: red } .two { color: blue }",
    });
    expect(unused).toEqual({});
    expect(status).toBe(0);
  });
});
