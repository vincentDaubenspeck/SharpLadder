// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";
import { afterAll, describe, expect, it, vi } from "vitest";
import { composedConfig } from "./config.js";
import {
  fixtureConfig,
  inModule,
  lintRoot,
  makeRoot,
  removeRoots,
  write,
} from "./harness.js";
import {
  discoverStylesheets,
  lintProduction,
  notApplicable,
} from "./lint-production.js";
import { fixtureRegistry, productionRegistry } from "./registry.js";

const fixture = (options) =>
  composedConfig({ ...options, registry: "fixture" });
const run = (paths, registry = fixtureRegistry) =>
  lintRoot(paths, registry, fixture);

afterAll(removeRoots);

// Suites timed at 30_000 run the real Stylelint, in-process or by spawn; it loads cold.

describe("stylesheet discovery", () => {
  it("A68 zero stylesheets is not applicable and exits zero, never PASS", async () => {
    const src = mkdtempSync(join(tmpdir(), "sl-empty-"));
    expect(await run({ src })).toEqual({
      state: "not-applicable",
      lines: [notApplicable],
    });
  });

  it("the production lint passes the shipped stylesheets through the CLI", () => {
    const cli = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("lint-production.js", import.meta.url))],
      { encoding: "utf8", timeout: 30_000 },
    );
    // The test timer cannot interrupt spawnSync, so a hung lint is killed here.
    if (cli.error) throw cli.error;
    if (cli.signal) throw new Error(`the lint was killed by ${cli.signal}.`);
    expect(cli.status).toBe(0);
    expect(cli.stdout.trim()).toBe("");
  });

  it("A69 a discovery error fails", async () => {
    const missing = join(tmpdir(), "sl-missing-src-does-not-exist");
    const result = await run({ src: missing });
    expect(result.state).toBe("fail");
    const src = mkdtempSync(join(tmpdir(), "sl-dir-"));
    mkdirSync(join(src, "odd.css"));
    expect(() => discoverStylesheets(src)).toThrow();
  });

  it("A70 a nested upper-case extension counts as exactly one file", () => {
    const src = mkdtempSync(join(tmpdir(), "sl-nested-"));
    write(
      join(src, "a", "b", "Panel.module.CSS"),
      inModule("color: var(--text);"),
    );
    write(join(src, "a", "notes.txt"), "x\n");
    expect(discoverStylesheets(src)).toEqual([
      join(src, "a", "b", "Panel.module.CSS"),
    ]);
  });
}, 30_000);

describe("production lint with stylesheets", () => {
  it("fails when the registry is incomplete", async () => {
    const { paths } = makeRoot();
    const result = await run(paths, () => ({ missing: ["radius"] }));
    expect(result.state).toBe("fail");
    expect(result.lines.join()).toContain("radius");
  });

  it("fails when tokens.css is missing", async () => {
    const { paths } = makeRoot();
    const result = await run({
      ...paths,
      tokensFile: join(paths.src, "absent.css"),
    });
    expect(result).toEqual({
      state: "fail",
      lines: ["tokens.css is missing or unreadable"],
    });
  });

  it("fails on malformed input", async () => {
    const { paths } = makeRoot();
    write(
      join(paths.src, "Bad.module.css"),
      "@layer components {\n  .x {\n    color: rgb(\n",
    );
    expect((await run(paths)).state).toBe("fail");
  });

  it("passes a clean module and fails on a token error (A29 release path)", async () => {
    const { paths } = makeRoot();
    const panel = join(paths.src, "Panel.module.css");
    write(panel, inModule("color: var(--text);"));
    expect(await run(paths)).toEqual({ state: "pass", lines: [] });
    write(panel, inModule("background: #0000;"));
    expect((await run(paths)).state).toBe("fail");
    expect(fixtureConfig(paths).rules["sharpladder/tokens"][1].registry).toBe(
      "fixture",
    );
  });

  it("fails a disabled module carrying @import, a named colour and px", async () => {
    const { paths } = makeRoot();
    write(
      join(paths.src, "Panel.module.css"),
      '/* stylelint-disable */\n@import "./external.css";\n@layer components {\n  .x {\n    color: red !important;\n    padding: 999px;\n  }\n}\n',
    );
    const result = await run(paths);
    expect(result.state).toBe("fail");
    const text = result.lines.join("\n");
    expect(text).toContain("@import is not allowed");
    expect(text).toContain("Disallowed !important");
    expect(text).toContain("padding takes registry tokens only");
  });

  it("the production configuration ignores disable comments", async () => {
    const { default: production } = await import("../stylelint.config.js");
    expect(production.ignoreDisables).toBe(true);
    expect(fixture({}).ignoreDisables).toBe(true);
  });

  it("A29 the release build runs the stylesheet lint first", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(pkg.scripts.build.startsWith("npm run lint:css && ")).toBe(true);
  });
}, 30_000);

describe("production glob root", () => {
  it("is web, the lint:css directory, and gives the results of stylelint's default cwd", async () => {
    const web = realpathSync.native(
      fileURLToPath(new URL("..", import.meta.url)),
    );
    const lint = vi.spyOn(stylelint, "lint");
    try {
      expect(await lintProduction()).toEqual({ state: "pass", lines: [] });
      expect(lint).toHaveBeenCalledTimes(1);
      const [[options]] = lint.mock.calls;
      expect(realpathSync.native(options.cwd)).toBe(web);
      // npm runs lint:css from web, and the acceptance run starts Vitest there too.
      expect(realpathSync.native(process.cwd())).toBe(web);
      const view = ({ results }) =>
        results
          .map((r) => [r.source, r.warnings, r.invalidOptionWarnings])
          .sort(([a], [b]) => (a < b ? -1 : 1));
      const rooted = view(await lint.mock.results[0].value);
      const plain = view(await stylelint.lint({ ...options, cwd: undefined }));
      expect(rooted.map(([source]) => source)).toEqual(
        discoverStylesheets(fileURLToPath(new URL("../src", import.meta.url))),
      );
      expect(plain).toEqual(rooted);
    } finally {
      lint.mockRestore();
    }
  });
}, 30_000);

describe("production registry", () => {
  it("loads every registry part", () => {
    expect(productionRegistry().missing).toEqual([]);
  });

  it("fixes the eight radius names with exact values", () => {
    const radius = [...productionRegistry().tokens].filter(
      ([, t]) => t.category === "radius",
    );
    expect(Object.fromEntries(radius.map(([n, t]) => [n, t.value]))).toEqual({
      "--r": "0.625rem",
      "--r-sm": "0.5rem",
      "--r-2": "0.125rem",
      "--r-3": "0.1875rem",
      "--r-4": "0.25rem",
      "--r-6": "0.375rem",
      "--r-9": "0.5625rem",
      "--r-pill": "62.4375rem",
    });
  });

  it("names 186 declared tokens and the one runtime-only --split", () => {
    const tokens = [...productionRegistry().tokens];
    const runtime = tokens.filter(([, t]) => t.runtime === true);
    expect(runtime.map(([n]) => n)).toEqual(["--split"]);
    expect(runtime[0][1].value).toBeUndefined();
    expect(tokens).toHaveLength(187);
  });
});
