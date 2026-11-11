// @vitest-environment node
import {
  appendFileSync,
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
  cycleStandings,
  expectedCycles,
  postRestoreProblems,
  report,
  settlePostRestore,
  type CycleRow,
} from "./high-contrast-cycles.ts";
import {
  cycleInput,
  fixtureRun,
  fixtureState,
} from "./high-contrast-fixture.ts";

const baseline = fixtureState();

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

const problemsOf = (edit: Record<string, unknown>) =>
  postRestoreProblems(
    { ...cycleInput(0).check, problems: [], ...edit },
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
  it("passes only a fresh browser that reports no forced colours", () => {
    expect(problemsOf({})).toEqual([]);
    expect(problemsOf({ forced: true })).toEqual([
      "forced colours are still active",
    ]);
    for (const forced of [null, undefined, 0, "false"])
      expect(problemsOf({ forced }), String(forced)).toEqual([
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

  it("holds the deadline whatever the browser reported", () => {
    for (const doneMs of [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      30_001,
    ])
      expect(problemsOf({ doneMs }), String(doneMs)).toHaveLength(1);
    expect(problemsOf({ doneMs: 0 })).toEqual([]);
    expect(problemsOf({ doneMs: 30_000 })).toEqual([]);
  });

  it("fails a check error and a cycle that is not its own", () => {
    expect(problemsOf({ error: "timed out" })).toEqual(["timed out"]);
    expect(problemsOf({ error: 1 })).toHaveLength(1);
    expect(problemsOf({ cycle: "hc-chromium/Other" })).toHaveLength(1);
    expect(problemsOf({ engine: "firefox" })).toEqual([
      'engine "firefox", not chromium',
    ]);
    expect(postRestoreProblems(null, baseline)).toHaveLength(1);
  });

  it("never consults the problems an observation carries", () => {
    expect(problemsOf({ forced: true, problems: [] })).toHaveLength(1);
    expect(problemsOf({ problems: ["x"] })).toEqual([]);
  });
});

describe("the writer", () => {
  it("records a verified cycle and writes nothing but the records", () => {
    const fx = fixtureRun(temp());
    expect(fx.errors).toEqual([]);
    expect(fx.rows.map((row) => row.outcome)).toEqual(
      expectedCycles.map(() => "verified"),
    );
    expect(readdirSync(fx.root)).toEqual(["hc-run"]);
    expect(readdirSync(fx.run).sort()).toEqual([
      "baseline.json",
      "cycles.jsonl",
    ]);
    expect(rowsOf(fx.root)).toEqual(fx.rows);
  });

  it("throws on a failed cycle, after keeping its record", () => {
    const fx = fixtureRun(temp(), [false, true]);
    expect(fx.errors).toEqual(["forced colours are still active"]);
    const row = rowAt(fx.rows, 1);
    expect(row.outcome).toBe("failed");
    expect(row.observation.problems).toEqual(fx.errors);
    expect(rowAt(rowsOf(fx.root), 1)).toEqual(row);
    expect(readdirSync(fx.root)).toEqual(["hc-run"]);
  });

  it("fails a cycle whose record cannot be appended, verified or not", () => {
    const refuse = () => {
      throw new Error("read-only");
    };
    expect(() =>
      settlePostRestore({ ...cycleInput(0), append: refuse }),
    ).toThrow("the cycle record was not written: read-only");
    expect(() =>
      settlePostRestore({ ...cycleInput(0, true), append: refuse }),
    ).toThrow(
      "the cycle record was not written: read-only; forced colours are still active",
    );
  });
});

describe("the six cycles", () => {
  it("finds six distinct verified cycles complete", () => {
    const fx = fixtureRun(temp());
    expect(completenessProblems(fx.root)).toEqual([]);
    expect(cycleStandings(fx.root)).toMatchObject({
      verified: 6,
      failed: 0,
      incomplete: 0,
      problems: [],
    });
  });

  it("counts a cycle with no record as incomplete and a failed one as failed", () => {
    const fx = fixtureRun(temp(), [false, true, false, false]);
    expect(cycleStandings(fx.root)).toMatchObject({
      verified: 3,
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
    const fx = fixtureRun(temp(), [false]);
    writeRows(
      fx.root,
      expectedCycles.map(() => fx.rows[0]),
    );
    const standings = cycleStandings(fx.root);
    expect(standings).toMatchObject({ verified: 0, failed: 1, incomplete: 5 });
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

  it("does not count a record as verified unless it shows no forced colours and no problem", () => {
    for (const edit of [
      (row: CycleRow) => {
        row.outcome = "failed";
      },
      (row: CycleRow) => {
        row.observation.forced = true;
      },
      (row: CycleRow) => {
        row.observation.forced = null;
      },
      (row: CycleRow) => {
        row.observation.problems = ["x"];
      },
      (row: CycleRow) => {
        row.version = 1;
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
  it("passes only a successful step with six verified cycles", () => {
    const fx = fixtureRun(temp());
    expect(reported(fx.root, "success")).toEqual({
      status: 0,
      lines: [
        "Post-restore: 6/6 cycles completed; 6 verified, 0 failed, 0 incomplete; high-contrast step: success.",
      ],
    });
  });

  it("keeps the step's failure whatever the records say", () => {
    const fx = fixtureRun(temp());
    for (const outcome of ["failure", "cancelled", "skipped", undefined]) {
      const result = reported(fx.root, outcome);
      expect(result.status).toBe(1);
      expect(result.lines[0]).toBe(
        `Post-restore: 6/6 cycles completed; 6 verified, 0 failed, 0 incomplete; high-contrast step: ${outcome ?? "not reported"}.`,
      );
    }
  });

  it("fails a successful step whose records are short, failed or unreadable", () => {
    const short = fixtureRun(temp(), [false, false, false, true]);
    const result = reported(short.root, "success");
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe(
      "Post-restore: 4/6 cycles completed; 3 verified, 1 failed, 2 incomplete; high-contrast step: success.",
    );
    const broken = fixtureRun(temp());
    appendFileSync(ledger(broken.root), "not json\n");
    expect(reported(broken.root, "success")).toEqual({
      status: 1,
      lines: [
        "Post-restore: 6/6 cycles completed; 6 verified, 0 failed, 0 incomplete; high-contrast step: success.",
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
      expect(text).toContain(`- ${cycle}: verified\n`);
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
