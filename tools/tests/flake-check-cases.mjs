// Flake check cases for tools/flake-check.mjs: real git on small repositories, stand-in build and Playwright.
// Usage: node tools/tests/flake-check-cases.mjs <work dir>
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  flakeCheck,
  gitRunner,
  isExecutionInput,
  projects,
  repeatEach,
} from "../flake-check.mjs";

const work = process.argv[2];
if (!work)
  throw new Error("usage: node tools/tests/flake-check-cases.mjs <work dir>");
const logs = join(work, "logs");
mkdirSync(logs, { recursive: true });

let failed = 0;
function report(label, ok, detail = "") {
  console.log(
    `${ok ? "PASS" : "FAIL"} flake: ${label}${ok ? "" : ` (${String(detail).slice(0, 400)})`}`,
  );
  if (!ok) failed++;
}

const gitIn = (dir, ...args) => {
  const identity = [
    "-c",
    "user.name=case",
    "-c",
    "user.email=case@example.invalid",
  ];
  const r = spawnSync(
    "git",
    [
      ...identity,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    {
      cwd: dir,
      encoding: "utf8",
    },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, file, text) => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const commitAll = (dir, message, amend = false) => {
  gitIn(dir, "add", "-A");
  gitIn(
    dir,
    "commit",
    "-q",
    ...(amend ? ["--amend", "--no-edit"] : ["-m", message]),
  );
  return gitIn(dir, "rev-parse", "HEAD");
};

// A root commit, a parent and a candidate that changes one spec.
let fixtures = 0;
function fixture(candidateFile = "web/browser/a.pw.ts") {
  fixtures += 1;
  const dir = join(work, `repo-${String(fixtures)}`);
  mkdirSync(dir, { recursive: true });
  gitIn(dir, "init", "-q", "-b", "main");
  put(dir, "README", "root\n");
  const root = commitAll(dir, "root");
  for (const f of [
    "web/playwright.config.ts",
    "web/browser/a.pw.ts",
    "web/browser/helper.ts",
    "web/browser/serve.mjs",
    "web/vite.config.ts",
    "web/package.json",
    "web/package-lock.json",
    "web/build-guard/build.mjs",
  ])
    put(dir, f, `${f} 1\n`);
  const parent = commitAll(dir, "parent");
  put(dir, candidateFile, `${candidateFile} 2\n`);
  const candidate = commitAll(dir, "candidate");
  return { dir, root, parent, candidate };
}

// Shaped like Playwright's JSON report: one spec per entry, one test per project and repeat.
function makeReport(specs, repeat, list, outcome) {
  const counts = { expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
  const suites = specs.map(([file, title], i) => ({
    title: file,
    file,
    line: 0,
    column: 0,
    specs: [
      {
        title,
        ok: true,
        tags: [],
        id: `spec${String(i)}`,
        file,
        line: 3 + i,
        column: 5,
        tests: projects.flatMap((projectName) =>
          Array.from({ length: repeat }, (_, n) => {
            const o = list ? {} : outcome({ projectName, file, title, n });
            const expectedStatus = o.expectedStatus ?? "passed";
            const results = list
              ? []
              : (o.results ?? [{ status: o.status ?? "passed", retry: 0 }]);
            const status =
              o.outcome ??
              (results.length === 0 || results[0].status === "skipped"
                ? "skipped"
                : results[0].status === expectedStatus
                  ? "expected"
                  : "unexpected");
            counts[status] += 1;
            return {
              projectName,
              projectId: projectName,
              expectedStatus,
              status,
              results,
              annotations: [],
            };
          }),
        ),
      },
    ],
  }));
  return {
    config: {
      projects: projects.map((name) => ({
        name,
        repeatEach: repeat,
        retries: 0,
      })),
    },
    suites,
    errors: [],
    stats: counts,
  };
}

function stubPlaywright(o = {}) {
  const specs = o.specs ?? [["a.pw.ts", "renders"]];
  const calls = [];
  const fn = (args, env, fd) => {
    calls.push({ args, env });
    const list = args.includes("--list");
    const repeat = list
      ? 1
      : Number(/--repeat-each=(\d+)/u.exec(args.join(" "))?.[1] ?? 1);
    writeSync(fd, `stand-in playwright ${list ? "list" : "run"}\n`);
    const r = makeReport(specs, repeat, list, o.outcome ?? (() => ({})));
    const edited = list
      ? (o.listEdit ?? ((x) => x))(r)
      : (o.runEdit ?? ((x) => x))(r);
    if (edited !== null)
      writeFileSync(env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(edited));
    if (!list) o.onRun?.();
    return list ? (o.listCode ?? 0) : (o.runCode ?? 0);
  };
  fn.calls = calls;
  return fn;
}

let runs = 0;
function screen(fx, argv, o = {}) {
  runs += 1;
  const log = o.log ?? join(logs, `run-${String(runs)}.log`);
  const printed = [];
  const order = [];
  const playwright = o.playwright ?? stubPlaywright();
  const code = flakeCheck(o.raw ? argv : ["--log", log, ...argv], {
    repo: fx.dir,
    env: o.env ?? {},
    git: o.git ?? gitRunner(fx.dir),
    build: (fd) => {
      order.push("build");
      writeSync(fd, "stand-in build\n");
      return (o.build ?? (() => 0))();
    },
    playwright: (args, env, fd) => {
      order.push(args.includes("--list") ? "list" : "run");
      return playwright(args, env, fd);
    },
    print: (line) => printed.push(line),
  });
  const summaryPath = `${log}.summary.json`;
  let summary = null;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch {
    summary = null;
  }
  return {
    code,
    out: printed.join("\n"),
    summary,
    summaryPath,
    log,
    calls: playwright.calls,
    order,
  };
}

function refused(label, r, text) {
  const ok = r.code !== 0 && r.out.includes(text) && !r.order.includes("run");
  report(label, ok, ok ? "" : `exit ${String(r.code)}; ${r.out.slice(0, 400)}`);
}
function failedRun(label, r, text) {
  const ok =
    r.code !== 0 && r.summary?.result === "fail" && r.out.includes(text);
  report(label, ok, ok ? "" : `exit ${String(r.code)}; ${r.out.slice(0, 400)}`);
}
const only = (r, base) =>
  r.calls.every((c) => c.args.includes(`--only-changed=${base}`));
const noOnly = (r) =>
  r.calls.every((c) => !c.args.some((a) => a.startsWith("--only-changed")));

// Arguments and evidence paths.
const fx = fixture();
refused("no --ref is refused", screen(fx, []), "--ref is required");
refused(
  "no --log is refused",
  screen(fx, ["--ref", "HEAD^"], { raw: true }),
  "--log is required",
);
refused(
  "an unknown argument is refused",
  screen(fx, ["--ref", "HEAD^", "--repeat", "5"]),
  "unknown argument --repeat",
);
refused(
  "a log inside the repository is refused",
  screen(fx, ["--ref", "HEAD^"], { log: join(fx.dir, "web", "flake.log") }),
  "inside the repository",
);
refused(
  "a log in a missing folder is refused",
  screen(fx, ["--ref", "HEAD^"], { log: join(logs, "absent", "x.log") }),
  "does not exist",
);
const kept = join(logs, "kept.log");
writeFileSync(`${kept}.summary.json`, "earlier evidence\n");
const keptRun = screen(fx, ["--ref", "HEAD^"], { log: kept });
refused(
  "an existing summary beside the log is refused",
  keptRun,
  "already exists",
);
report(
  "earlier evidence is left untouched",
  readFileSync(`${kept}.summary.json`, "utf8") === "earlier evidence\n" &&
    !existsSync(kept),
);

// Environment.
for (const value of ["1", "0"]) {
  const r = screen(fx, ["--ref", "HEAD^"], {
    env: { SHARPLADDER_REAL_HIGH_CONTRAST: value },
  });
  refused(
    `the real high-contrast mode (${value}) is refused`,
    r,
    "SHARPLADDER_REAL_HIGH_CONTRAST",
  );
  report(
    `the refusal (${value}) is recorded without a build`,
    r.summary?.result === "refused" && r.order.length === 0,
  );
}

// Ref resolution.
refused(
  "a missing ref is refused",
  screen(fx, ["--ref", "no-such-ref"]),
  "git rev-parse --verify no-such-ref^{commit} failed",
);
refused(
  "an option-like ref is refused",
  screen(fx, ["--ref", "--all"]),
  "looks like an option",
);
refused(
  "an unrelated ref without --prior is refused",
  screen(fx, ["--ref", fx.root]),
  "only a same-parent amend",
);
refused(
  "HEAD without --prior is refused",
  screen(fx, ["--ref", "HEAD"]),
  "only a same-parent amend",
);
const stray = join(logs, "stray.json");
writeFileSync(stray, "{}\n");
refused(
  "--prior with HEAD^ is refused",
  screen(fx, ["--ref", "HEAD^", "--prior", stray]),
  "--prior is only for",
);
const failing = (word) => (args) =>
  args[0] === word
    ? { code: 128, stdout: "", stderr: "fatal: stand-in failure" }
    : gitRunner(fx.dir)(args);
refused(
  "a failing git status never counts as clean",
  screen(fx, ["--ref", "HEAD^"], { git: failing("status") }),
  "git status --porcelain --untracked-files=all failed",
);
refused(
  "a failing rev-parse is refused",
  screen(fx, ["--ref", "HEAD^"], { git: failing("rev-parse") }),
  "failed (exit 128)",
);

// Cleanliness.
const dirty = [
  ["an unstaged change", (d) => put(d, "web/browser/a.pw.ts", "edited\n")],
  [
    "a staged change",
    (d) => {
      put(d, "web/browser/a.pw.ts", "staged\n");
      gitIn(d, "add", "web/browser/a.pw.ts");
    },
  ],
  [
    "an untracked file despite status.showUntrackedFiles=no",
    (d) => {
      gitIn(d, "config", "status.showUntrackedFiles", "no");
      put(d, "web/browser/new/deep.pw.ts", "new\n");
    },
  ],
  [
    "an assume-unchanged edit",
    (d) => {
      gitIn(d, "update-index", "--assume-unchanged", "web/browser/a.pw.ts");
      put(d, "web/browser/a.pw.ts", "hidden\n");
    },
  ],
];
for (const [label, make] of dirty) {
  const d = fixture();
  make(d.dir);
  const r = screen(d, ["--ref", "HEAD^"]);
  refused(
    `${label} is refused`,
    r,
    label.startsWith("an assume")
      ? "hidden from status"
      : "not clean before the screen",
  );
}

// A parent-based screen.
const pass = screen(fx, ["--ref", "HEAD^"]);
const s1 = pass.summary;
report(
  "a parent-based screen passes",
  pass.code === 0 && s1?.result === "pass" && s1.complete === true,
  pass.out,
);
report(
  "the summary records the commits and selection",
  s1?.candidate === fx.candidate &&
    s1.parent === fx.parent &&
    s1.ref === fx.parent &&
    s1.mode === "parent" &&
    s1.base === fx.parent &&
    s1.selection === "changed" &&
    s1.platform === process.platform &&
    s1.changedFiles.join() === "web/browser/a.pw.ts",
  JSON.stringify(s1),
);
report(
  "the counts are the project-qualified list times the repeats",
  s1?.counts.listed === projects.length &&
    s1.counts.required === projects.length * repeatEach &&
    s1.counts.completed === projects.length * repeatEach &&
    s1.tests.length === projects.length,
  JSON.stringify(s1?.counts),
);
report(
  "the list runs first, then the build, then the screen",
  pass.order.join() === "list,build,run",
  pass.order.join(),
);
const [listCall, runCall] = pass.calls;
report(
  "the list is machine-readable and names the five projects",
  listCall.args.includes("--list") &&
    listCall.args.includes("--reporter=json") &&
    projects.every((p) => listCall.args.includes(`--project=${p}`)),
  listCall.args.join(" "),
);
report(
  "the screen repeats twenty times without retries on two workers",
  [
    "--repeat-each=20",
    "--retries=0",
    "--workers=2",
    "--reporter=list,json",
  ].every((a) => runCall.args.includes(a)) &&
    projects.every((p) => runCall.args.includes(`--project=${p}`)),
  runCall.args.join(" "),
);
report(
  "a parent-based screen selects changes since the parent",
  only(pass, fx.parent),
);
report(
  "the chain of a parent-based screen is its own root",
  s1?.chain.length === 1 &&
    s1.chain[0].mode === "parent" &&
    s1.chain[0].base === fx.parent,
);
const logText = readFileSync(pass.log, "utf8");
report(
  "the log holds the git, build and Playwright output",
  logText.includes("$ git status --porcelain --untracked-files=all") &&
    logText.includes("stand-in build") &&
    logText.includes("stand-in playwright run"),
);
const strip = screen(fx, ["--ref", "HEAD^"], {
  env: { PLAYWRIGHT_JSON_ONLY_FAILURES: "1" },
});
report(
  "an inherited JSON reporter setting never reaches Playwright",
  strip.code === 0 &&
    strip.calls.every(
      (c) =>
        !("PLAYWRIGHT_JSON_ONLY_FAILURES" in c.env) &&
        c.env.PLAYWRIGHT_JSON_OUTPUT_FILE,
    ),
);

// Narrowed screens of same-parent amends.
const c1 = fx.candidate;
put(fx.dir, "web/browser/a.pw.ts", "amend 2\n");
const c2 = commitAll(fx.dir, "", true);
const n2 = screen(fx, ["--ref", c1, "--prior", pass.summaryPath]);
report(
  "a valid amended ref with --prior passes",
  n2.code === 0 && n2.summary?.mode === "narrowed",
  n2.out,
);
report(
  "a narrowed screen selects changes since the ref",
  only(n2, c1) && n2.summary?.base === c1,
);
report(
  "the narrowed chain extends the prior chain",
  n2.summary?.chain.length === 2 &&
    n2.summary.chain[0].candidate === c2 &&
    n2.summary.chain[1].candidate === c1 &&
    /^[0-9a-f]{64}$/u.test(n2.summary.prior?.sha256 ?? ""),
);
put(fx.dir, "web/browser/a.pw.ts", "amend 3\n");
commitAll(fx.dir, "", true);
const n3 = screen(fx, ["--ref", c2, "--prior", n2.summaryPath]);
report(
  "a chain of two amends passes",
  n3.code === 0 && n3.summary?.chain.length === 3,
  n3.out,
);

// Prior summaries that do not prove a complete screen of the ref.
const base2 = JSON.parse(readFileSync(n2.summaryPath, "utf8"));
const tampered = [
  ["another candidate", (s) => (s.candidate = c1), "is not the ref"],
  ["another platform", (s) => (s.platform = "plan9"), "platform plan9 differs"],
  ["another parent", (s) => (s.parent = fx.root), "is not HEAD^"],
  ["an incomplete run", (s) => (s.complete = false), "not complete"],
  ["fewer completed runs", (s) => (s.counts.completed -= 1), "its counts"],
  [
    "a skip counted as complete",
    (s) => ((s.counts.skipped = 1), (s.counts.expected -= 1)),
    "its counts",
  ],
  ["the earlier format", (s) => (s.format = 1), "not a flake-check summary"],
  ["a failed result", (s) => (s.result = "fail"), "result is fail"],
  [
    "a pass field alone",
    (s) => Object.keys(s).forEach((k) => k !== "result" && delete s[k]),
    "not a flake-check summary",
  ],
  ["no chain", (s) => (s.chain = []), "the chain is missing"],
  [
    "a chain that never reaches a parent-based screen",
    (s) => (s.chain[1].mode = "narrowed"),
    "does not lead back",
  ],
  [
    "a chain with a gap",
    (s) => (s.chain[0].base = fx.root),
    "does not lead back",
  ],
  [
    "a chain link built on another parent",
    (s) => {
      s.chain[1].candidate = fx.parent;
    },
    "is not built on",
  ],
];
for (const [label, edit, text] of tampered) {
  const s = structuredClone(base2);
  edit(s);
  const file = join(logs, `prior-${label.replaceAll(" ", "-")}.json`);
  writeFileSync(file, `${JSON.stringify(s)}\n`);
  refused(
    `a prior summary with ${label} is refused`,
    screen(fx, ["--ref", c2, "--prior", file]),
    text,
  );
}
const notJson = join(logs, "prior-not-json.json");
writeFileSync(notJson, "pass\n");
refused(
  "a prior summary that is not JSON is refused",
  screen(fx, ["--ref", c2, "--prior", notJson]),
  "is not JSON",
);
gitIn(fx.dir, "branch", "side", fx.root);
gitIn(fx.dir, "checkout", "-q", "side");
put(fx.dir, "web/browser/a.pw.ts", "side\n");
const side = commitAll(fx.dir, "side");
gitIn(fx.dir, "checkout", "-q", "main");
const forged = structuredClone(base2);
forged.candidate = side;
const forgedFile = join(logs, "prior-forged.json");
writeFileSync(forgedFile, `${JSON.stringify(forged)}\n`);
refused(
  "a ref on another parent is refused even with a prior",
  screen(fx, ["--ref", side, "--prior", forgedFile]),
  "a rebase screens against the new parent",
);

// Selection.
const cfg = fixture("web/playwright.config.ts");
const full = screen(cfg, ["--ref", "HEAD^"]);
report(
  "a config change runs every spec",
  full.code === 0 &&
    noOnly(full) &&
    full.summary?.selection === "all" &&
    full.summary.configChanged === true,
  full.out,
);
const helper = fixture("web/browser/helper.ts");
const h1 = screen(helper, ["--ref", "HEAD^"]);
report(
  "a changed helper selects through the import graph",
  h1.code === 0 && only(h1, helper.parent),
);
put(helper.dir, "web/build-guard/build.mjs", "guard 2\n");
commitAll(helper.dir, "", true);
const fb = screen(helper, [
  "--ref",
  helper.candidate,
  "--prior",
  h1.summaryPath,
]);
report(
  "an execution input change falls back to a parent-based screen",
  fb.code === 0 &&
    only(fb, helper.parent) &&
    fb.summary?.mode === "parent" &&
    fb.summary.chain.length === 1 &&
    fb.summary.fallback?.includes("web/build-guard/build.mjs") &&
    fb.summary.selection === "changed",
  fb.out,
);
const narrowCfg = fixture("web/browser/helper.ts");
const nc1 = screen(narrowCfg, ["--ref", "HEAD^"]);
put(narrowCfg.dir, "web/playwright.config.ts", "config 2\n");
commitAll(narrowCfg.dir, "", true);
const nc2 = screen(narrowCfg, [
  "--ref",
  narrowCfg.candidate,
  "--prior",
  nc1.summaryPath,
]);
report(
  "a config change since the ref runs every spec",
  nc2.code === 0 &&
    noOnly(nc2) &&
    nc2.summary?.selection === "all" &&
    nc2.summary.mode === "narrowed",
  nc2.out,
);
const inputs = [
  ["web/browser/serve.mjs", true],
  ["web/browser/sub/x.mjs", false],
  ["web/browser/a.pw.ts", false],
  ["web/browser/helper.ts", false],
  ["web/vite.config.ts", true],
  ["web/package.json", true],
  ["web/package-lock.json", true],
  ["web/build-guard/deep/x.mjs", true],
  ["web/build-guardian.mjs", false],
  ["web/playwright.config.ts", false],
];
for (const [path, want] of inputs)
  report(
    `${path} ${want ? "is" : "is not"} an execution input`,
    isExecutionInput(path) === want,
  );

// Listing, build and verdict.
const v = fixture();
const zero = screen(v, ["--ref", "HEAD^"], {
  playwright: stubPlaywright({ specs: [] }),
});
refused(
  "zero selected tests are refused before the build",
  zero,
  "no browser test is selected",
);
report("zero selected tests never build", !zero.order.includes("build"));
refused(
  "a failed list is refused",
  screen(v, ["--ref", "HEAD^"], {
    playwright: stubPlaywright({ listCode: 1 }),
  }),
  "the list exited 1",
);
refused(
  "a list with errors is refused",
  screen(v, ["--ref", "HEAD^"], {
    playwright: stubPlaywright({
      listEdit: (r) => ({ ...r, errors: [{ message: "config error" }] }),
    }),
  }),
  "config error",
);
refused(
  "a list without a report is refused",
  screen(v, ["--ref", "HEAD^"], {
    playwright: stubPlaywright({ listEdit: () => null }),
  }),
  "no machine-readable list",
);
refused(
  "a list holding another project is refused",
  screen(v, ["--ref", "HEAD^"], {
    playwright: stubPlaywright({
      listEdit: (r) => {
        r.suites[0].specs[0].tests[0].projectName = "hc-chromium";
        return r;
      },
    }),
  }),
  "another project",
);
const buildFailure = screen(v, ["--ref", "HEAD^"], { build: () => 1 });
refused(
  "a failed build is refused",
  buildFailure,
  "guarded production build failed (exit 1)",
);
report(
  "a failed build is recorded",
  buildFailure.summary?.buildExitCode === 1 &&
    buildFailure.summary.result === "refused",
);
refused(
  "a build that leaves a file behind is refused",
  screen(fixture(), ["--ref", "HEAD^"], {
    build: () => {
      put(join(work, `repo-${String(fixtures)}`), "web/leftover.txt", "x\n");
      return 0;
    },
  }),
  "not clean after the build",
);
const moving = fixture();
refused(
  "a build that moves HEAD is refused",
  screen(moving, ["--ref", "HEAD^"], {
    build: () => {
      gitIn(moving.dir, "commit", "-q", "--allow-empty", "-m", "moved");
      return 0;
    },
  }),
  "HEAD moved",
);
const outcomeCase = (label, outcome, text, extra = {}) =>
  failedRun(
    label,
    screen(v, ["--ref", "HEAD^"], {
      playwright: stubPlaywright({ outcome, ...extra }),
    }),
    text,
  );
const firstOf = (fn) => (t) =>
  t.projectName === "desktop-webkit" && t.n === 7 ? fn() : {};
outcomeCase(
  "a failed test fails the screen",
  firstOf(() => ({ status: "failed" })),
  "1 failed",
);
outcomeCase(
  "a flaky test fails the screen",
  firstOf(() => ({
    outcome: "flaky",
    results: [{ status: "failed" }, { status: "passed" }],
  })),
  "1 flaky",
);
outcomeCase(
  "an interrupted test fails the screen",
  firstOf(() => ({ status: "interrupted" })),
  "1 interrupted",
);
outcomeCase(
  "an unexpectedly skipped test fails the screen",
  firstOf(() => ({ results: [] })),
  "1 didNotRun",
);
outcomeCase(
  "a skip at run time without an expected skip fails",
  firstOf(() => ({ status: "skipped" })),
  "1 skipped",
);
outcomeCase(
  "an expected skip fails the screen",
  firstOf(() => ({ status: "skipped", expectedStatus: "skipped" })),
  "1 skipped",
);
outcomeCase(
  "a timed-out test fails the screen",
  firstOf(() => ({ status: "timedOut" })),
  "1 failed",
);
// test.fail() makes a failure the expected outcome, which must never pass the screen.
const expectedFailure = firstOf(() => ({
  expectedStatus: "failed",
  status: "failed",
}));
outcomeCase(
  "an expected failure fails the screen",
  expectedFailure,
  "1 not expected to pass",
);
outcomeCase(
  "an expected failure counts as failed",
  expectedFailure,
  "1 failed",
);
outcomeCase(
  "a retried result fails the screen",
  firstOf(() => ({ results: [{ status: "passed", retry: 1 }] })),
  "1 retried",
);
outcomeCase(
  "a non-zero exit fails a clean report",
  () => ({}),
  "the run exited 1",
  { runCode: 1 },
);
outcomeCase(
  "partial results fail the screen",
  () => ({}),
  "ran 19 of 20 times",
  { runEdit: (r) => (r.suites[0].specs[0].tests.pop(), r) },
);
outcomeCase(
  "a test that was not listed fails the screen",
  () => ({}),
  "ran but was not listed",
  {
    runEdit: (r) => (
      r.suites[0].specs[0].tests.push({
        ...r.suites[0].specs[0].tests[0],
        projectName: "stray",
      }),
      r
    ),
  },
);
outcomeCase(
  "missing results fail the screen",
  () => ({}),
  "no machine-readable results",
  { runEdit: () => null },
);
outcomeCase(
  "a run with another repeat count fails the screen",
  () => ({}),
  "did not run with 20 repeats",
  { runEdit: (r) => ((r.config.projects[0].repeatEach = 1), r) },
);
outcomeCase(
  "a run with top-level errors fails the screen",
  () => ({}),
  "the run reported 1 errors",
  { runEdit: (r) => ((r.errors = [{ message: "global setup failed" }]), r) },
);
const totals = [
  ["skipped tests", (s) => (s.skipped = 1), "own totals show"],
  ["no skipped tally", (s) => delete s.skipped, "own totals show"],
  ["another tally", (s) => (s.interrupted = 1), "own totals show"],
  ["fewer passes", (s) => (s.expected -= 1), "own totals count 99 passes"],
];
for (const [label, edit, text] of totals)
  outcomeCase(`run totals with ${label} fail the screen`, () => ({}), text, {
    runEdit: (r) => (edit(r.stats), r),
  });
const shapes = [
  [
    "specs that are not a list",
    (r) => (r.suites[0].specs = "x"),
    "malformed suite",
  ],
  [
    "child suites that are not a list",
    (r) => (r.suites[0].suites = {}),
    "malformed suite",
  ],
  [
    "an empty suite",
    (r) =>
      r.suites.push({
        title: "e.pw.ts",
        file: "e.pw.ts",
        line: 0,
        column: 0,
        specs: [],
      }),
    "empty suite",
  ],
  [
    "tests that are not a list",
    (r) => (r.suites[0].specs[0].tests = "x"),
    "malformed spec",
  ],
  [
    "a spec without tests",
    (r) =>
      r.suites[0].specs.push({
        ...r.suites[0].specs[0],
        title: "t",
        tests: [],
      }),
    "malformed spec",
  ],
  [
    "a test that is not an object",
    (r) => (r.suites[0].specs[0].tests[0] = null),
    "malformed test",
  ],
];
for (const [label, edit, text] of shapes)
  outcomeCase(`results with ${label} fail the screen`, () => ({}), text, {
    runEdit: (r) => (edit(r), r),
  });
refused(
  "a list naming one test twice is refused",
  screen(v, ["--ref", "HEAD^"], {
    playwright: stubPlaywright({
      listEdit: (r) => {
        const { tests } = r.suites[0].specs[0];
        tests.push({ ...tests[0] });
        return r;
      },
    }),
  }),
  "names desktop-chromium",
);
const after = fixture();
failedRun(
  "a screen that leaves a file behind fails",
  screen(after, ["--ref", "HEAD^"], {
    playwright: stubPlaywright({
      onRun: () => put(after.dir, "web/browser/trace.txt", "x\n"),
    }),
  }),
  "not clean after the screen",
);

process.exitCode = failed > 0 ? 1 : 0;
