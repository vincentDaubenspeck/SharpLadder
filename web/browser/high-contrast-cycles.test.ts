// @vitest-environment node
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  completenessProblems,
  cycleFolder,
  cycleStandings,
  expectedCycles,
  postRestoreProblems,
  report,
  settlePostRestore,
  type CycleRow,
} from "./high-contrast-cycles.ts";
import {
  cycleInput,
  encodePng,
  fixtureRun,
  fixtureState,
  pixels,
} from "./high-contrast-fixture.ts";

const size = { width: 16, height: 8 };
const baselinePng = encodePng(size.width, size.height, pixels(16, 8));
const baseline = { state: fixtureState(), ...size };

const made: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-cycles-"));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const input = (changed = 0, i = 0) => cycleInput(i, changed, size, baselinePng);
const problemsOf = (edit: Record<string, unknown>, changed = 0) =>
  postRestoreProblems(
    { ...input(changed).check, problems: [], ...edit },
    baseline,
  );
const ledger = (root: string) => join(root, "hc-run", "cycles.jsonl");
const rowsOf = (root: string) =>
  readFileSync(ledger(root), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as CycleRow);
const rowAt = (rows: CycleRow[], i: number) => {
  const row = rows[i];
  if (row === undefined) throw new Error("no such row");
  return row;
};
const writeRows = (root: string, rows: unknown[]) => {
  writeFileSync(
    ledger(root),
    rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
};
const reported = (root: string | undefined, outcome: string | undefined) => {
  const lines: string[] = [];
  const status = report({
    dir: root,
    outcome,
    env: {},
    log: (line) => lines.push(line),
  });
  return { status, lines };
};

describe("post-restore judgement", () => {
  it("passes only zero differing pixels", () => {
    expect(problemsOf({})).toEqual([]);
    for (const changed of [1, 20, 64, 65])
      expect(problemsOf({}, changed)).toEqual([
        `${String(changed)} pixels differ from the baseline after restore`,
      ]);
  });

  it("fails a count that is missing or is not a non-negative integer", () => {
    for (const changed of [null, undefined, Number.NaN, 0.5, -2, "0", -1])
      expect(problemsOf({ changed }), String(changed)).toHaveLength(1);
    expect(problemsOf({ changed: -1 })).toEqual([
      "the capture size differs from the baseline",
    ]);
  });

  it("fails a second count that disagrees with the first", () => {
    expect(problemsOf({ diagnostic: 19 }, 20)).toHaveLength(2);
  });

  it("fails a capture of another size", () => {
    expect(problemsOf({ width: 15 })).toEqual([
      "the capture is 15x8, the baseline 16x8",
    ]);
    expect(problemsOf({ height: null })).toHaveLength(1);
  });

  it("fails forced colours that are still active or were not read", () => {
    expect(problemsOf({ forced: true })).toEqual([
      "forced colours are still active",
    ]);
    expect(problemsOf({ forced: null })).toEqual([
      "forced colours were not read",
    ]);
  });

  it("fails a restored state that differs from the baseline", () => {
    const drifted = { ...fixtureState(), flags: 127 };
    expect(problemsOf({ state: drifted }).join("; ")).toContain(
      "restored state:",
    );
    expect(problemsOf({ state: null }).join("; ")).toContain("restored state:");
  });

  it("holds the timing rule with zero differing pixels", () => {
    const failing: [unknown, unknown][] = [
      [null, 200],
      [100, null],
      [Number.NaN, 200],
      [100, Number.POSITIVE_INFINITY],
      [-1, 200],
      [201, 200],
      [100, 30_001],
    ];
    for (const [captureMs, doneMs] of failing)
      expect(
        problemsOf({ captureMs, doneMs }),
        `${String(captureMs)}, ${String(doneMs)}`,
      ).toHaveLength(1);
    expect(problemsOf({ captureMs: 0, doneMs: 0 })).toEqual([]);
    expect(problemsOf({ captureMs: 30_000, doneMs: 30_000 })).toEqual([]);
  });

  it("fails a capture error, an unread page and a cycle that is not its own", () => {
    expect(problemsOf({ error: "timed out" })).toEqual(["timed out"]);
    expect(problemsOf({ error: 1 })).toHaveLength(1);
    expect(problemsOf({ hasFocus: null })).toHaveLength(1);
    expect(problemsOf({ devicePixelRatio: 0 })).toHaveLength(1);
    expect(problemsOf({ cycle: "hc-chromium/Other" })).toHaveLength(1);
    expect(problemsOf({ engine: "firefox" })).toEqual([
      'engine "firefox", not chromium',
    ]);
    expect(postRestoreProblems(null, baseline)).toHaveLength(1);
  });

  it("never consults the problems an observation carries", () => {
    expect(problemsOf({ problems: [] }, 20)).toHaveLength(1);
    expect(problemsOf({ problems: ["x"] })).toEqual([]);
  });
});

describe("the writer", () => {
  it("records an exact cycle and writes no diagnostics", () => {
    const fx = fixtureRun(temp());
    expect(fx.errors).toEqual([]);
    expect(fx.rows.map((row) => row.outcome)).toEqual(
      expectedCycles.map(() => "exact"),
    );
    expect(existsSync(join(fx.root, "post-restore"))).toBe(false);
    expect(rowsOf(fx.root)).toEqual(fx.rows);
  });

  it("throws on any difference, after keeping the three images and the observation", () => {
    for (const changed of [1, 20, 64, 65]) {
      const fx = fixtureRun(temp(), [0, changed]);
      expect(fx.errors).toEqual([
        `${String(changed)} pixels differ from the baseline after restore`,
      ]);
      const row = fx.rows[1];
      expect(row?.outcome).toBe("failed");
      const folder = cycleFolder("hc-chromium", "High Contrast White");
      expect(row?.files).toEqual(
        ["baseline.png", "capture.png", "diff.png", "observation.json"].map(
          (name) => `${folder}/${name}`,
        ),
      );
      const at = (name: string) =>
        readFileSync(join(fx.root, ...folder.split("/"), name));
      const images = input(changed, 1).images;
      expect(at("baseline.png").equals(fx.baselinePng)).toBe(true);
      expect(at("capture.png").equals(Buffer.from(images.capture ?? []))).toBe(
        true,
      );
      expect(at("diff.png").equals(Buffer.from(images.diff ?? []))).toBe(true);
      expect(at("capture.png").equals(fx.baselinePng)).toBe(false);
      expect(JSON.parse(at("observation.json").toString("utf8"))).toEqual(
        row?.observation,
      );
    }
  });

  it("keeps what a failed cycle has when an image is missing", () => {
    const root = temp();
    fixtureRun(root, []);
    const failing = input(0);
    failing.check.error = "no page";
    failing.check.changed = null;
    failing.images.capture = null;
    const rows: CycleRow[] = [];
    expect(() =>
      settlePostRestore({ ...failing, root, append: (row) => rows.push(row) }),
    ).toThrow("no page");
    const folder = cycleFolder("hc-chromium", "High Contrast Black");
    expect(readdirSync(join(root, ...folder.split("/"))).sort()).toEqual([
      "baseline.png",
      "observation.json",
    ]);
    expect(rows[0]?.outcome).toBe("failed");
  });

  it("stays failed, and says so, when the diagnostics cannot be written", () => {
    for (const io of [
      {
        makeFolder: () => {
          throw new Error("disk full");
        },
      },
      {
        create: () => {
          throw new Error("disk full");
        },
      },
    ]) {
      const fx = fixtureRun(temp(), [20], size, io);
      expect(fx.errors).toEqual([
        "20 pixels differ from the baseline after restore; diagnostics were not written: disk full",
      ]);
      expect(fx.rows[0]?.outcome).toBe("failed");
      expect(rowsOf(fx.root)[0]?.outcome).toBe("failed");
    }
  });

  it("fails a cycle whose record cannot be appended, exact or not", () => {
    const root = temp();
    const refuse = () => {
      throw new Error("read-only");
    };
    expect(() =>
      settlePostRestore({ ...input(0), root, append: refuse }),
    ).toThrow("the cycle record was not written: read-only");
    expect(() =>
      settlePostRestore({ ...input(20), root, append: refuse }),
    ).toThrow(
      "the cycle record was not written: read-only; 20 pixels differ from the baseline after restore",
    );
  });

  it("does not replace the diagnostics of an earlier cycle", () => {
    const root = temp();
    fixtureRun(root, [20]);
    const again = input(20);
    const rows: CycleRow[] = [];
    expect(() =>
      settlePostRestore({ ...again, root, append: (row) => rows.push(row) }),
    ).toThrow("diagnostics were not written");
  });
});

describe("the six cycles", () => {
  it("finds six distinct exact cycles complete", () => {
    const fx = fixtureRun(temp());
    expect(completenessProblems(fx.root)).toEqual([]);
    expect(cycleStandings(fx.root)).toMatchObject({
      exact: 6,
      failed: 0,
      incomplete: 0,
      problems: [],
    });
  });

  it("counts a cycle with no record as incomplete and a failed one as failed", () => {
    const fx = fixtureRun(temp(), [0, 20, 0, 0]);
    expect(cycleStandings(fx.root)).toMatchObject({
      exact: 3,
      failed: 1,
      incomplete: 2,
    });
    expect(completenessProblems(fx.root)).toEqual([
      "hc-chromium/High Contrast White: failed",
      "hc-webkit/High Contrast Black: incomplete",
      "hc-webkit/High Contrast White: incomplete",
    ]);
  });

  it("does not take one cycle recorded six times for six cycles", () => {
    const fx = fixtureRun(temp(), [0]);
    writeRows(
      fx.root,
      expectedCycles.map(() => fx.rows[0]),
    );
    const standings = cycleStandings(fx.root);
    expect(standings).toMatchObject({ exact: 0, failed: 1, incomplete: 5 });
    expect(standings.problems).toEqual([
      "hc-chromium/High Contrast Black recorded 6 times",
    ]);
    expect(completenessProblems(fx.root)).toHaveLength(7);
  });

  it("reports records it cannot read or place, never as zero failures", () => {
    const unknown = fixtureRun(temp());
    const rows = rowsOf(unknown.root);
    rowAt(rows, 5).observation.cycle = "hc-webkit/Other";
    writeRows(unknown.root, rows);
    expect(completenessProblems(unknown.root)).toEqual([
      "record 6 names no expected cycle",
      "hc-webkit/High Contrast White: incomplete",
    ]);

    const torn = fixtureRun(temp());
    appendFileSync(ledger(torn.root), '{"version":');
    expect(completenessProblems(torn.root)).toEqual([
      "the last cycle record is not ended",
    ]);

    const broken = fixtureRun(temp());
    appendFileSync(ledger(broken.root), "not json\n[]\n");
    expect(completenessProblems(broken.root)).toEqual([
      "record 7 cannot be read",
      "record 8 names no expected cycle",
    ]);

    const none = temp();
    expect(completenessProblems(none)).toEqual([
      "no cycle records were written",
      ...expectedCycles.map((c) => `${c.cycle}: incomplete`),
    ]);
  });

  it("does not count a record as exact unless it shows zero pixels and no problem", () => {
    for (const edit of [
      (row: CycleRow) => {
        row.outcome = "failed";
      },
      (row: CycleRow) => {
        row.observation.changed = 20;
      },
      (row: CycleRow) => {
        row.observation.problems = ["x"];
      },
      (row: CycleRow) => {
        row.version = 2;
      },
    ]) {
      const fx = fixtureRun(temp());
      const rows = rowsOf(fx.root);
      edit(rowAt(rows, 2));
      writeRows(fx.root, rows);
      expect(completenessProblems(fx.root)).toEqual([
        "hc-firefox/High Contrast Black: failed",
      ]);
    }
  });
});

describe("the summary", () => {
  it("passes only a successful step with six exact cycles", () => {
    const fx = fixtureRun(temp());
    expect(reported(fx.root, "success")).toEqual({
      status: 0,
      lines: [
        "Post-restore: 6/6 cycles completed; 6 exact, 0 failed, 0 incomplete; high-contrast step: success.",
      ],
    });
  });

  it("keeps the step's failure whatever the records say", () => {
    const fx = fixtureRun(temp());
    for (const outcome of ["failure", "cancelled", "skipped", undefined]) {
      const result = reported(fx.root, outcome);
      expect(result.status).toBe(1);
      expect(result.lines[0]).toBe(
        `Post-restore: 6/6 cycles completed; 6 exact, 0 failed, 0 incomplete; high-contrast step: ${outcome ?? "not reported"}.`,
      );
    }
  });

  it("fails a successful step whose records are short, failed or unreadable", () => {
    const short = fixtureRun(temp(), [0, 0, 0, 20]);
    const result = reported(short.root, "success");
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe(
      "Post-restore: 4/6 cycles completed; 3 exact, 1 failed, 2 incomplete; high-contrast step: success.",
    );
    const broken = fixtureRun(temp());
    appendFileSync(ledger(broken.root), "not json\n");
    expect(reported(broken.root, "success")).toEqual({
      status: 1,
      lines: [
        "Post-restore: 6/6 cycles completed; 6 exact, 0 failed, 0 incomplete; high-contrast step: success.",
        "failed record 7 cannot be read",
      ],
    });
  });

  it("says the records are unavailable when there are none", () => {
    const result = reported(temp(), "success");
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe(
      "Post-restore: records unavailable; high-contrast step: success.",
    );
    expect(reported(undefined, "success").status).toBe(1);
  });

  it("writes the job summary, and fails on a hosted run that has none", () => {
    const fx = fixtureRun(temp());
    const target = join(fx.root, "summary.md");
    const lines: string[] = [];
    const run = (env: Record<string, string>) =>
      report({
        dir: fx.root,
        outcome: "success",
        env,
        log: (line) => lines.push(line),
      });
    expect(run({ GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: target })).toBe(
      0,
    );
    const text = readFileSync(target, "utf8");
    expect(text.startsWith("Post-restore: 6/6 cycles completed;")).toBe(true);
    for (const { cycle } of expectedCycles)
      expect(text).toContain(`- ${cycle}: exact\n`);
    expect(run({ GITHUB_ACTIONS: "true" })).toBe(1);
    expect(lines.at(-1)).toContain("::error::high contrast summary:");
  });
});

describe("where the verdict is given", () => {
  const read = (name: string) =>
    readFileSync(join(import.meta.dirname, name), "utf8");

  it("throws from the spec itself, with the record written before the throw", () => {
    const spec = read("high-contrast.pw.ts");
    expect(spec.match(/settlePostRestore\(\{/gu)).toHaveLength(1);
    expect(spec).toMatch(
      /append: \(row\) => \{\s*record\.postRestore\.push\(row\);\s*save\(\);\s*recordCycle\(root, row\);\s*\},\s*\}\);\s*\} catch \(error\) \{\s*throw new Error\(/u,
    );
    expect(spec).not.toMatch(/completenessProblems|cycleStandings/u);
  });

  it("has the launcher fail a clean exit that does not show all six cycles", () => {
    const launcher = read("run.mjs");
    expect(launcher).toContain(
      'if (status === 0 && env["SHARPLADDER_REAL_HIGH_CONTRAST"] === "1") {',
    );
    expect(launcher).toContain("if (problems.length > 0) status = 1;");
    expect(launcher).toMatch(/process\.exit\(status\);\s*$/u);
    // The check can only fail a run: nothing sets the status back to zero.
    expect(launcher).not.toMatch(/status = 0/u);
  });
});
