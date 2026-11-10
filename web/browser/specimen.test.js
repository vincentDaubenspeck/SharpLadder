// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { sameInventory, walkDist } from "../build-guard/output.js";
import {
  contexts,
  expectedTokens,
  luminance,
  ratio,
  tokenProbes,
} from "./catalogue.ts";
import {
  buildSpecimen,
  cleanUp,
  lintSpecimen,
  specimenFiles,
} from "./specimen.mjs";

const slow = { timeout: 180_000 };
const replaced = (css) => ({
  ...specimenFiles(),
  "src/specimen/iso-a.module.css": css,
});

afterEach(() => cleanUp());

describe("theme specimen sheets", () => {
  it("pass the production lint", slow, async () => {
    expect(await lintSpecimen()).toEqual({ state: "pass", lines: [] });
  });

  it("reject an unlayered rule", slow, async () => {
    const result = await lintSpecimen(
      replaced(".box {\n  color: var(--accent);\n}\n"),
    );
    expect(result.state).toBe("fail");
    expect(result.lines.join("\n")).toMatch(/unlayered rule/u);
  });

  it("reject !important", slow, async () => {
    const result = await lintSpecimen(
      replaced(
        "@layer components {\n  .box {\n    color: var(--accent) !important;\n  }\n}\n",
      ),
    );
    expect(result.state).toBe("fail");
    expect(result.lines.join("\n")).toMatch(/Disallowed !important/u);
  });

  it(
    "build through the release guard with distinct local classes",
    slow,
    async () => {
      const { built } = await buildSpecimen();
      // The record holds hashes only, so the bytes come from the directory it verifies.
      const files = walkDist(built.outDir);
      sameInventory(built.files, files, "specimen build");
      const sheets = [...files.keys()].filter((p) => p.endsWith(".css"));
      expect(sheets).toHaveLength(1);
      const css = files.get(sheets[0]).bytes.toString("utf8");
      const boxes = new Set(css.match(/\.[\w-]+_box\b/gu));
      expect(boxes.size).toBe(2);
    },
  );

  it(
    "fail the build on a bare element selector in a module",
    slow,
    async () => {
      // Lint passes it; pure mode in the build is what refuses it.
      const files = replaced(
        "@layer components {\n  code {\n    color: var(--accent);\n  }\n}\n",
      );
      expect((await lintSpecimen(files)).state).toBe("pass");
      await expect(buildSpecimen(files)).rejects.toThrow(/iso-a\.module\.css/u);
    },
  );
});

describe("token catalogue", () => {
  const sets = contexts();

  it("measures all 186 declared names", () => {
    expect(tokenProbes()).toHaveLength(186);
  });

  it("applies data-theme over the scheme and print over both", () => {
    const at = (theme, scheme, print, work = false) =>
      expectedTokens({ theme, scheme, print, work }, sets)["--surface"];
    expect(at(null, "light", false)).toBe(sets.light["--surface"]);
    expect(at(null, "dark", false)).toBe(sets["system-dark"]["--surface"]);
    expect(at("light", "dark", false)).toBe(sets.light["--surface"]);
    expect(at("dark", "light", false)).toBe(sets.dark["--surface"]);
    expect(at("dark", "light", false, true)).toBe(
      sets["dark-work"]["--surface"],
    );
    for (const theme of [null, "light", "dark"])
      expect(at(theme, "dark", true, true)).toBe(sets.print["--surface"]);
  });

  it("fails a sheet whose print block omits a dark name", () => {
    const cut = (css) =>
      css.replace(/(@media print[^{]*\{[^{]*\{[^}]*?)--ed-bg:[^;]*;/su, "$1");
    expect(() => contexts(cut(readTokens()))).toThrow(
      /print does not restate --ed-bg/u,
    );
  });

  it("holds the threshold exactly and refuses a translucent colour", () => {
    expect(ratio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 10);
    expect(ratio("rgb(118, 118, 118)", "rgb(255, 255, 255)")).toBeGreaterThan(
      4.5,
    );
    expect(ratio("rgb(119, 119, 119)", "rgb(255, 255, 255)")).toBeLessThan(4.5);
    expect(() => luminance("rgba(16, 24, 40, 0.12)")).toThrow(/translucent/u);
    expect(() => luminance("color(srgb 1 0 0)")).toThrow(/not an rgb/u);
  });
});

function readTokens() {
  return specimenFiles()["src/theme/tokens.css"];
}
