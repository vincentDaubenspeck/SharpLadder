// @vitest-environment node
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  fontsSheet,
  inModule,
  lintComposed,
  lintRoot,
  makeRoot,
  removeRoots,
  write,
} from "./harness.js";

afterAll(removeRoots);

// Timed at 30_000 because the first lint loads Stylelint cold.
describe("fixture root cleanup", () => {
  it("a composed lint removes its root once the lint has read it", async () => {
    let repo = "";
    const result = await lintComposed((p) => {
      repo = p.repoRoot;
      return p.fontsFile;
    }, fontsSheet());
    expect(result).toEqual({ state: "pass", lines: [] });
    expect(repo).toMatch(/sl-tokens-/);
    expect(existsSync(repo)).toBe(false);
  });

  it("a composed lint removes its root when its setup throws", async () => {
    let repo = "";
    await expect(
      lintComposed((p) => {
        repo = p.repoRoot;
        throw new Error("setup failed");
      }, ""),
    ).rejects.toThrow("setup failed");
    expect(repo).toMatch(/sl-tokens-/);
    expect(existsSync(repo)).toBe(false);
  });

  it("removal waits for a lint still reading the root", async () => {
    const { paths } = makeRoot();
    write(join(paths.src, "Panel.module.css"), inModule("color: var(--text);"));
    const lint = lintRoot(paths);
    const removed = removeRoots();
    expect(await lint).toEqual({ state: "pass", lines: [] });
    await removed;
    expect(existsSync(paths.repoRoot)).toBe(false);
  });

  it("removal leaves a root this module did not make", async () => {
    const foreign = realpathSync.native(
      mkdtempSync(join(tmpdir(), "sl-tokens-")),
    );
    try {
      const { paths } = makeRoot();
      await removeRoots();
      expect(existsSync(paths.repoRoot)).toBe(false);
      expect(existsSync(foreign)).toBe(true);
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  let failed = "";
  describe("a suite whose test fails", () => {
    afterAll(removeRoots);
    it.fails("its assertion throws while its root exists", () => {
      failed = makeRoot().paths.repoRoot;
      expect(existsSync(failed)).toBe(false);
    });
  });

  it("the failed suite's afterAll removed its root", () => {
    expect(failed).toMatch(/sl-tokens-/);
    expect(existsSync(failed)).toBe(false);
  });
}, 30_000);
