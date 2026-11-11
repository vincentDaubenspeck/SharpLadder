// @vitest-environment node
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  exclusionViolations,
  harnessMarker,
  harnessOutput,
  overlapping,
} from "./exclusion.js";
import { cleanUp, fixture, releaseRoot } from "./fixture.js";
import { walkDist } from "./output.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const files = (entries) =>
  new Map(entries.map(([path, text]) => [path, { bytes: Buffer.from(text) }]));

describe("production exclusion: output files", () => {
  it("admits output that neither names the harness nor holds its marker", () => {
    expect(
      exclusionViolations(
        files([
          ["index.html", "<!doctype html>"],
          ["assets/index-a1.js", 'console.log("content");'],
        ]),
      ),
    ).toEqual([]);
  });

  it.each([
    ["assets/harness-a1.js", "x", "assets/harness-a1.js names the harness"],
    ["Harness/index.html", "x", "Harness/index.html names the harness"],
    [
      "assets/index-a1.js",
      `const m = "${harnessMarker}";`,
      "assets/index-a1.js holds the harness marker",
    ],
  ])("refuses %s", (path, text, problem) => {
    expect(exclusionViolations(files([[path, text]]))).toEqual([problem]);
  });

  it("is the marker the harness page and its entry carry", () => {
    for (const file of ["index.html", "main.tsx"])
      expect(
        readFileSync(join(web, "harness", "content", file), "utf8"),
      ).toContain(harnessMarker);
  });
});

describe("production exclusion: output roots", () => {
  const base = fixture({}, { modules: false }).base;

  it.each([
    ["the same folder", "a", "a", true],
    ["a folder inside the other", "a/b", "a", true],
    ["the containing folder", "a", "a/b/c", true],
    ["a sibling sharing a prefix", "dist", "dist2", false],
    ["two unrelated folders", "a/x", "b/x", false],
  ])("judges %s", (_, a, b, expected) => {
    expect(overlapping(join(base, a), join(base, b))).toBe(expected);
  });

  it("resolves a folder that exists through its real path", () => {
    mkdirSync(join(base, "real"), { recursive: true });
    expect(
      overlapping(join(base, "real", "..", "real"), join(base, "real")),
    ).toBe(true);
  });

  it("puts the harness output outside dist", () => {
    expect(overlapping(harnessOutput(web), join(web, "dist"))).toBe(false);
  });
});

const main = (code) => ({ "src/main.tsx": `${code}\n` });

describe("production exclusion: the release build", () => {
  it(
    "passes a release whose output is clean",
    { timeout: 30_000 },
    async () => {
      const built = await releaseRoot(
        fixture(main('console.log("plain");')).root,
      );
      expect(exclusionViolations(walkDist(built.outDir))).toEqual([]);
    },
  );

  it(
    "fails a release whose bundle holds the marker",
    { timeout: 30_000 },
    async () => {
      await expect(
        releaseRoot(fixture(main(`console.log("${harnessMarker}");`)).root),
      ).rejects.toThrow(/production exclusion: .*holds the harness marker/u);
    },
  );

  it(
    "fails a release written into the harness output",
    { timeout: 30_000 },
    async () => {
      const { root } = fixture(main('console.log("plain");'));
      await expect(
        releaseRoot(root, { build: { outDir: harnessOutput(root) } }),
      ).rejects.toThrow(/production exclusion: .*overlaps the harness output/u);
    },
  );
});
