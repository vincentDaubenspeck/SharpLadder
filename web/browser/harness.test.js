// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  exclusionViolations,
  harnessMarker,
} from "../build-guard/exclusion.js";
import { cleanUp as unlink, link } from "../build-guard/fixture.js";
import { runTestRecords } from "../content-check/records.ts";
import { walkDist } from "../build-guard/output.js";
import { buildHarness, preflight } from "./harness.mjs";
import { serve } from "./serve.mjs";

const web = join(import.meta.dirname, "..");
const repository = join(web, "..");
const copied = [
  "content/schema",
  "tools/SharpLadder.Content.Tests/fixtures/content",
  "web/compiled",
  "web/src/generated",
  "web/src/content",
  "web/src/theme",
  "web/harness",
];
const trees = [];
// Safe: the Vitest global setup builds the compiler before any test file of the same run starts.
const records = (roots) =>
  runTestRecords({ ...roots, builtByGlobalSetup: true });

/** A repository-shaped copy of every tree the preflight reads and the harness page builds from. */
function copy(mutate = () => {}) {
  const tree = realpathSync.native(mkdtempSync(join(tmpdir(), "sl-harness-")));
  trees.push(tree);
  for (const path of copied)
    cpSync(join(repository, path), join(tree, path), { recursive: true });
  mutate(tree);
  return tree;
}

const at = (tree, path) => join(tree, ...path.split("/"));
const chapterJson = "web/compiled/chapters/fixture-basics/chapter.json";
const chapterWitness =
  "web/src/generated/witness/chapters/fixture-basics/chapter.ts";
const edit = (tree, path, change) => {
  const file = at(tree, path);
  writeFileSync(file, change(readFileSync(file, "utf8")));
};

afterAll(() => {
  unlink();
  for (const tree of trees) rmSync(tree, { recursive: true, force: true });
});

const refused = /content harness: preflight refused/u;

// Each changes one thing the preflight checks; none touches the compiler or Vite.
const cases = [
  [
    "a changed witness",
    (t) =>
      edit(t, chapterWitness, (s) =>
        s.replace('title: "Fixture Basics"', 'title: "Fixture Basic"'),
      ),
    [
      /witness\/chapters\/fixture-basics\/chapter\.ts: differs from fresh output/u,
    ],
  ],
  [
    "a changed compiled JSON payload",
    (t) =>
      edit(t, chapterJson, (s) =>
        s.replace('"Fixture Basics"', '"Fixture Basic"'),
      ),
    [/compiled\/chapters\/fixture-basics\/chapter\.json: differs/u],
  ],
  [
    "a missing payload",
    (t) => rmSync(at(t, "web/compiled/chapters/fixture-basics/build.json")),
    [/missing/u, /build\.json/u],
  ],
  [
    "an extra payload",
    (t) =>
      cpSync(
        at(t, chapterJson),
        at(t, "web/compiled/chapters/fixture-basics/extra.json"),
      ),
    [/extra/u, /extra\.json/u],
  ],
  [
    "a validator failure",
    (t) =>
      edit(t, "content/schema/content.schema.json", (s) =>
        s.replace(
          '"title": { "type": "string", "minLength": 1 }',
          '"title": { "type": "string", "minLength": 1, "maxLength": 1 }',
        ),
      ),
    [/chapter\.md:1: schema: .*failed validation/u],
  ],
];

describe("content harness preflight", () => {
  beforeAll(() => {
    // Proves the copy itself is sound, so each refusal below comes from its one change.
    expect(preflight(copy(), records)).toBe(preflight(repository, records));
  });

  it.each(cases)(
    "stops the harness build on %s before Vite runs",
    { timeout: 60_000 },
    async (_, mutate, reason) => {
      const tree = copy(mutate);
      const outDir = join(tree, "web", ".cache", "harness-dist");
      const error = await buildHarness({ tree, outDir, records }).then(
        () => null,
        (e) => e,
      );
      expect(error?.message).toMatch(refused);
      for (const pattern of reason) expect(error?.message).toMatch(pattern);
      expect(existsSync(outDir)).toBe(false);
    },
  );

  it(
    "stops the harness server on a changed payload",
    { timeout: 60_000 },
    async () => {
      const tree = copy(cases[1][1]);
      await expect(serve("harness", 0, { tree, records })).rejects.toThrow(
        refused,
      );
      expect(existsSync(join(tree, "web", ".cache"))).toBe(false);
    },
  );

  it(
    "stops the harness command on a changed witness",
    { timeout: 60_000 },
    () => {
      const tree = copy(cases[0][1]);
      const outDir = join(tree, "web", ".cache", "harness-dist");
      const r = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "harness.mjs"), tree, outDir],
        { encoding: "utf8", cwd: web },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(refused);
      expect(existsSync(outDir)).toBe(false);
    },
  );
});

// The preflight's own path, given an envelope the compiler did not write.
function altered(change) {
  const run = records({ repository });
  const parsed = JSON.parse(new TextDecoder().decode(run.stdout));
  change(parsed.records);
  const stdout = new TextEncoder().encode(JSON.stringify(parsed));
  return () => ({ stdout, stderr: "", exit: 0 });
}

describe("content harness preflight record set", () => {
  const membership = /records are not exactly the \d+ compiled payload files/u;

  it.each([
    [
      "a missing record",
      (r) => {
        r.shift();
      },
    ],
    [
      "an extra record",
      (r) => {
        r.push({ path: "compiled/zz.json", text: "{}" });
      },
    ],
    [
      "a same-count wrong path",
      (r) => {
        r.splice(-1, 1, { path: "compiled/zz.json", text: "{}" });
      },
    ],
  ])("refuses %s", { timeout: 60_000 }, (_, change) => {
    expect(() => preflight(repository, altered(change))).toThrow(membership);
  });

  it(
    "accepts the compiler's own envelope through the same path",
    { timeout: 60_000 },
    () => {
      expect(
        preflight(
          repository,
          altered(() => {}),
        ),
      ).toBe(preflight(repository, records));
    },
  );

  it(
    "refuses when the inventory of the checked tree fails",
    { timeout: 60_000 },
    () => {
      const tree = copy((t) => {
        writeFileSync(at(t, "web/compiled/notes.txt"), "");
      });
      expect(() =>
        preflight(
          tree,
          altered(() => {}),
        ),
      ).toThrow(
        /preflight refused: .*compiled inventory refused: .*compiled\/notes\.txt/u,
      );
    },
  );
});

describe("content harness output", () => {
  it.each([
    ["dist itself", (w) => join(w, "dist")],
    ["a folder inside dist", (w) => join(w, "dist", "harness")],
    ["a folder holding dist", (w) => w],
  ])("refuses %s as its output before any preflight", async (_, out) => {
    await expect(buildHarness({ outDir: out(web) })).rejects.toThrow(
      /content harness: output .* overlaps the production output/u,
    );
  });

  it(
    "builds a certified page that the production output check refuses",
    { timeout: 120_000 },
    async () => {
      const tree = copy();
      link(join(web, "node_modules"), join(tree, "web", "node_modules"));
      const outDir = join(tree, "web", ".cache", "harness-dist");
      const { certificate } = await buildHarness({
        tree,
        outDir,
        records,
      });
      const built = walkDist(outDir);
      const text = [...built.values()].map((f) => f.bytes.toString("utf8"));
      expect(text.some((t) => t.includes(certificate))).toBe(true);
      expect(text.filter((t) => t.includes(harnessMarker)).length).toBe(2);
      expect(exclusionViolations(built).length).toBeGreaterThan(0);
    },
  );
});
