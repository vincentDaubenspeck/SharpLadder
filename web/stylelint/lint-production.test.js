// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composedConfig } from "./config.js";
import { fixtureConfig, inModule, makeRoot, write } from "./harness.js";
import {
  discoverStylesheets,
  lintProduction,
  notApplicable,
} from "./lint-production.js";
import { fixtureRegistry, productionRegistry } from "./registry.js";

const fixture = (options) =>
  composedConfig({ ...options, registry: "fixture" });
const run = (paths, registry = fixtureRegistry) =>
  lintProduction(paths, registry, fixture);

describe("stylesheet discovery", () => {
  it("A68 zero stylesheets is not applicable and exits zero, never PASS", async () => {
    const src = mkdtempSync(join(tmpdir(), "sl-empty-"));
    expect(await run({ src })).toEqual({
      state: "not-applicable",
      lines: [notApplicable],
    });
    const cli = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("lint-production.js", import.meta.url))],
      {
        encoding: "utf8",
      },
    );
    expect(cli.status).toBe(0);
    expect(cli.stdout.trim()).toBe(notApplicable);
    expect(cli.stdout).not.toContain("PASS");
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
});

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
});

describe("production registry", () => {
  it("loads the extracted inventory and catalogue and lacks only radius", () => {
    expect(productionRegistry().missing).toEqual(["radius"]);
  });
});
