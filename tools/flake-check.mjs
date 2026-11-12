// Screens the changed browser tests and helpers twenty times over on a fresh guarded build.
// Usage: node tools/flake-check.mjs --ref <commit> --log <path> [--prior <summary.json>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { exec } from "./checks/lib.mjs";

export const usage =
  "usage: node tools/flake-check.mjs --ref <commit> --log <path> [--prior <summary.json>]";
export const projects = [
  "desktop-chromium",
  "desktop-firefox",
  "desktop-webkit",
  "phone-chromium",
  "phone-webkit",
];
export const repeatEach = 20;
const format = 2;
const configFile = "web/playwright.config.ts";
const highContrast = "SHARPLADDER_REAL_HIGH_CONTRAST";
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const maxChain = 64;

class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};
const isObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

// These reach a run without passing through the spec import graph, so a change voids narrowed reuse.
export function isExecutionInput(path) {
  return (
    /^web\/browser\/[^/]+\.mjs$/u.test(path) ||
    path === "web/vite.config.ts" ||
    path === "web/package.json" ||
    path === "web/package-lock.json" ||
    path.startsWith("web/build-guard/")
  );
}

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = /^--(ref|log|prior)$/u.exec(argv[i])?.[1];
    if (name === undefined) refuse(`unknown argument ${argv[i]}`);
    if (Object.hasOwn(opts, name)) refuse(`--${name} is given twice`);
    const value = argv[i + 1];
    if (value === undefined || value === "") refuse(`--${name} needs a value`);
    opts[name] = value;
  }
  if (opts.ref === undefined) refuse("--ref is required");
  if (opts.log === undefined) refuse("--log is required");
  return opts;
}

// Case folding may only refuse: a folded match counts as inside the repository.
function inside(path, root) {
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = relative(fold(root), fold(path));
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

const exists = (p) => lstatSync(p, { throwIfNoEntry: false }) !== undefined;

function evidencePaths(log, repo) {
  const file = resolve(log);
  let folder;
  try {
    folder = realpathSync.native(dirname(file));
  } catch {
    refuse(`the log folder ${dirname(file)} does not exist`);
  }
  const root = realpathSync.native(repo);
  if (inside(file, root) || inside(join(folder, basename(file)), root))
    refuse(`the log ${file} is inside the repository`);
  const paths = {
    log: file,
    summary: `${file}.summary.json`,
    list: `${file}.list.json`,
    results: `${file}.results.json`,
  };
  for (const p of Object.values(paths))
    if (exists(p))
      refuse(`${p} already exists; earlier evidence is never overwritten`);
  return paths;
}

export function gitRunner(repo) {
  return (args) => {
    const r = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (r.error) return { code: null, stdout: "", stderr: r.error.message };
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
}

function gitOf(deps, log) {
  const git = (args) => {
    const r = deps.git(args);
    log(`$ git ${args.join(" ")} (exit ${String(r.code)})`);
    if (r.stdout) log(r.stdout.replaceAll("\0", "\n").trimEnd());
    if (r.stderr) log(r.stderr.trimEnd());
    if (r.code !== 0)
      refuse(`git ${args.join(" ")} failed (exit ${String(r.code)})`);
    return r.stdout;
  };
  const commit = (ref) => {
    if (ref.startsWith("-")) refuse(`the ref ${ref} looks like an option`);
    const out = git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
    if (!sha.test(out)) refuse(`git rev-parse gave ${out} for ${ref}`);
    return out;
  };
  const onlyParent = (commitSha) => {
    const parts = git(["rev-list", "--parents", "-n", "1", commitSha])
      .trim()
      .split(" ");
    if (parts.length !== 2 || parts[0] !== commitSha)
      refuse(`${commitSha} must have exactly one parent`);
    return parts[1];
  };
  const changed = (from, to) =>
    git(["diff", "--name-only", "--no-renames", "-z", from, to, "--"])
      .split("\0")
      .filter((p) => p !== "");
  const assertClean = (candidate, when) => {
    const head = commit("HEAD");
    if (head !== candidate)
      refuse(`HEAD moved from ${candidate} to ${head} ${when}`);
    // The explicit mode overrides status.showUntrackedFiles, so no config can hide a new file.
    if (git(["status", "--porcelain", "--untracked-files=all"]) !== "")
      refuse(`the working tree is not clean ${when}`);
    // Assume-unchanged and skip-worktree entries hide edits from status.
    const hidden = git(["ls-files", "-v", "-z"])
      .split("\0")
      .filter((e) => /^(?:[a-z]|S) /u.test(e));
    if (hidden.length > 0)
      refuse(
        `${String(hidden.length)} tracked files are hidden from status ${when}`,
      );
  };
  return { git, commit, onlyParent, changed, assertClean };
}

function chainProblems(g, prior, parent) {
  const chain = prior.chain;
  if (!Array.isArray(chain) || chain.length === 0 || chain.length > maxChain)
    return ["the chain is missing, empty or too long"];
  const problems = [];
  const first = chain[0];
  if (
    !isObject(first) ||
    first.candidate !== prior.candidate ||
    first.mode !== prior.mode ||
    first.base !== prior.base
  )
    problems.push("the chain does not start at the summary's own screen");
  const seen = new Set();
  chain.forEach((link, i) => {
    if (
      !isObject(link) ||
      typeof link.candidate !== "string" ||
      !sha.test(link.candidate)
    ) {
      problems.push(`chain link ${String(i)} is malformed`);
      return;
    }
    if (seen.has(link.candidate))
      problems.push(`chain link ${String(i)} repeats a candidate`);
    seen.add(link.candidate);
    if (link.platform !== process.platform || link.parent !== parent)
      problems.push(`chain link ${String(i)} has another platform or parent`);
    const last = i === chain.length - 1;
    const leads = last
      ? link.mode === "parent" && link.base === parent
      : link.mode === "narrowed" && link.base === chain[i + 1]?.candidate;
    if (!leads)
      problems.push(
        `chain link ${String(i)} does not lead back to a parent-based screen`,
      );
    // A link is evidence for this parent only when git agrees the candidate was built on it.
    try {
      if (g.onlyParent(link.candidate) !== parent)
        problems.push(`chain link ${String(i)} is not built on ${parent}`);
    } catch (err) {
      problems.push(`chain link ${String(i)}: ${err.message}`);
    }
  });
  return problems;
}

// A pass field alone proves nothing, so every count and the chain must agree with a full run.
function priorProblems(g, prior, ref, parent) {
  if (!isObject(prior)) return ["not a JSON object"];
  const problems = [];
  const want = (ok, problem) => {
    if (!ok) problems.push(problem);
  };
  want(
    prior.tool === "flake-check" && prior.format === format,
    "not a flake-check summary",
  );
  want(prior.result === "pass", `result is ${String(prior.result)}`);
  want(prior.complete === true, "the run was not complete");
  want(
    Array.isArray(prior.reasons) && prior.reasons.length === 0,
    "it records failures",
  );
  want(prior.exitCode === 0, `the run exited ${String(prior.exitCode)}`);
  want(
    prior.candidate === ref,
    `its candidate ${String(prior.candidate)} is not the ref ${ref}`,
  );
  want(
    prior.platform === process.platform,
    `platform ${String(prior.platform)} differs`,
  );
  want(
    prior.parent === parent,
    `parent ${String(prior.parent)} is not HEAD^ ${parent}`,
  );
  want(
    Array.isArray(prior.projects) &&
      prior.projects.join("\n") === projects.join("\n"),
    "it screened other projects",
  );
  want(
    prior.repeatEach === repeatEach,
    `repeat count ${String(prior.repeatEach)}`,
  );
  want(
    (prior.mode === "parent" && prior.base === parent) ||
      (prior.mode === "narrowed" &&
        typeof prior.base === "string" &&
        sha.test(prior.base)),
    "its mode and base disagree",
  );
  const c = prior.counts;
  const counted =
    isObject(c) &&
    [c.listed, c.required, c.completed, c.expected, c.skipped].every(isCount) &&
    c.listed > 0 &&
    c.required === c.listed * repeatEach &&
    c.completed === c.required &&
    c.expected === c.completed &&
    [c.failed, c.flaky, c.interrupted, c.skipped, c.didNotRun].every(
      (n) => n === 0,
    ) &&
    Array.isArray(prior.tests) &&
    prior.tests.length === c.listed;
  want(
    counted,
    "its counts do not show every listed test completing every repeat",
  );
  return [...problems, ...chainProblems(g, prior, parent)];
}

function testsOf(report, what) {
  if (
    !isObject(report) ||
    !Array.isArray(report.suites) ||
    !Array.isArray(report.errors)
  )
    refuse(`no machine-readable ${what}`);
  const out = [];
  // Anything the walk cannot read could hide a test from both the list and the run.
  const walk = (suite, titles) => {
    if (
      !isObject(suite) ||
      !Array.isArray(suite.specs) ||
      !(suite.suites === undefined || Array.isArray(suite.suites))
    )
      refuse(`a malformed suite in the ${what}`);
    if (suite.specs.length === 0 && (suite.suites ?? []).length === 0)
      refuse(`an empty suite in the ${what}`);
    for (const spec of suite.specs) {
      if (
        !isObject(spec) ||
        !Array.isArray(spec.tests) ||
        spec.tests.length === 0
      )
        refuse(`a malformed spec in the ${what}`);
      for (const test of spec.tests) {
        if (!isObject(test)) refuse(`a malformed test in the ${what}`);
        const name = [...titles, spec.title].join(" › ");
        const key = `${String(test.projectName)} › ${spec.file}:${String(spec.line)}:${String(spec.column)} › ${name}`;
        out.push({ key, test });
      }
    }
    for (const child of suite.suites ?? [])
      walk(child, [...titles, child.title]);
  };
  for (const file of report.suites) walk(file, []);
  return out;
}

function listedTests(report) {
  const tests = testsOf(report, "list");
  if (report.errors.length > 0)
    refuse(
      `the list reported errors: ${report.errors.map((e) => e.message).join("; ")}`,
    );
  const strays = tests.filter(
    ({ test }) => !projects.includes(test.projectName),
  );
  if (strays.length > 0)
    refuse(`the list holds another project: ${strays[0].key}`);
  const keys = tests.map(({ key }) => key);
  const twice = keys.find((key, i) => keys.indexOf(key) !== i);
  if (twice !== undefined) refuse(`the list names ${twice} twice`);
  return keys;
}

function judge(listed, report) {
  const problems = [];
  const required = listed.length * repeatEach;
  const counts = {
    listed: listed.length,
    required,
    completed: 0,
    expected: 0,
    skipped: 0,
    failed: 0,
    flaky: 0,
    interrupted: 0,
    didNotRun: 0,
  };
  let tests;
  try {
    tests = testsOf(report, "results");
  } catch (err) {
    return { counts, problems: [err.message] };
  }
  if (report.errors.length > 0)
    problems.push(`the run reported ${String(report.errors.length)} errors`);
  for (const name of projects) {
    const p = (report.config?.projects ?? []).find((q) => q?.name === name);
    if (p?.repeatEach !== repeatEach || p?.retries !== 0)
      problems.push(
        `project ${name} did not run with ${String(repeatEach)} repeats and no retries`,
      );
  }
  const stats = isObject(report.stats) ? report.stats : {};
  const tallies = Object.keys(stats).filter(
    (k) => !["startTime", "duration", "expected"].includes(k),
  );
  if (
    ["unexpected", "flaky", "skipped"].some((k) => stats[k] !== 0) ||
    tallies.some((k) => stats[k] !== 0)
  )
    problems.push("the run's own totals show tests that did not pass");
  const want = new Map();
  for (const key of listed) want.set(key, (want.get(key) ?? 0) + repeatEach);
  const got = new Map();
  const strays = new Set();
  let notMeantToPass = 0;
  let retried = 0;
  for (const { key, test } of tests) {
    if (!want.has(key)) strays.add(key);
    got.set(key, (got.get(key) ?? 0) + 1);
    // test.fail() and its kin turn a failure into the expected outcome.
    if (test.expectedStatus !== "passed") notMeantToPass += 1;
    const results = Array.isArray(test.results) ? test.results : [];
    if (results.some((r) => !isObject(r) || r.retry !== 0)) retried += 1;
    const status = results[0]?.status;
    if (results.length === 0) counts.didNotRun += 1;
    else if (results.length > 1 || test.status === "flaky") counts.flaky += 1;
    else if (status === "interrupted") counts.interrupted += 1;
    else if (status === "skipped") counts.skipped += 1;
    else {
      counts.completed += 1;
      if (status === "passed" && test.status === "expected")
        counts.expected += 1;
      else counts.failed += 1;
    }
  }
  if (stats.expected !== counts.expected)
    problems.push(
      `the run's own totals count ${String(stats.expected)} passes, not ${String(counts.expected)}`,
    );
  if (notMeantToPass > 0)
    problems.push(`${String(notMeantToPass)} not expected to pass`);
  if (retried > 0) problems.push(`${String(retried)} retried`);
  for (const key of strays) problems.push(`${key} ran but was not listed`);
  for (const [key, n] of want) {
    if (got.get(key) !== n)
      problems.push(
        `${key} ran ${String(got.get(key) ?? 0)} of ${String(n)} times`,
      );
  }
  for (const k of ["failed", "flaky", "interrupted", "skipped", "didNotRun"])
    if (counts[k] > 0) problems.push(`${String(counts[k])} ${k}`);
  if (counts.completed !== required)
    problems.push(
      `${String(counts.completed)} of ${String(required)} runs completed`,
    );
  return { counts, problems };
}

function playwrightJson(deps, file, args, fd, log) {
  // Reserved before the child starts, so only this run's own report can fill it.
  writeFileSync(file, "", { flag: "wx" });
  const env = Object.fromEntries(
    Object.entries(deps.env).filter(([k]) => !/^PLAYWRIGHT_JSON_/iu.test(k)),
  );
  env.PLAYWRIGHT_JSON_OUTPUT_FILE = file;
  log(`$ node web/browser/run.mjs ${args.join(" ")}`);
  const code = deps.playwright(args, env, fd);
  log(`exit ${String(code)}`);
  let report = null;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    report = null;
  }
  return { code, report };
}

function screen(opts, paths, deps, summary, fd, log, say) {
  if (Object.keys(deps.env).some((k) => k.toUpperCase() === highContrast))
    refuse(
      `${highContrast} is set; the real high-contrast run is never screened here`,
    );
  const g = gitOf(deps, log);
  const top = g.git(["rev-parse", "--show-toplevel"]).trim();
  if (
    !inside(realpathSync.native(top), realpathSync.native(deps.repo)) ||
    !inside(realpathSync.native(deps.repo), realpathSync.native(top))
  )
    refuse(`the repository top level ${top} is not this checkout`);
  const candidate = g.commit("HEAD");
  const parent = g.onlyParent(candidate);
  Object.assign(summary, { candidate, parent });
  g.assertClean(candidate, "before the screen");
  const ref = g.commit(opts.ref);
  summary.ref = ref;

  let mode = "parent";
  let prior = null;
  if (ref === parent) {
    if (opts.prior !== undefined)
      refuse("--prior is only for a ref other than HEAD^");
  } else {
    if (opts.prior === undefined)
      refuse(
        `the ref ${ref} is not HEAD^ ${parent}; only a same-parent amend with --prior narrows`,
      );
    if (g.onlyParent(ref) !== parent)
      refuse(
        `the ref ${ref} is not built on HEAD^ ${parent}; a rebase screens against the new parent`,
      );
    const bytes = readFileSync(opts.prior);
    try {
      prior = JSON.parse(bytes.toString("utf8"));
    } catch {
      refuse(`the prior summary ${opts.prior} is not JSON`);
    }
    const problems = priorProblems(g, prior, ref, parent);
    if (problems.length > 0)
      refuse(`the prior summary is refused: ${problems.join("; ")}`);
    summary.prior = {
      path: resolve(opts.prior),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    mode = "narrowed";
  }

  let base = mode === "parent" ? parent : ref;
  let changed = g.changed(base, candidate);
  const inputs = mode === "narrowed" ? changed.filter(isExecutionInput) : [];
  if (inputs.length > 0) {
    // The fallback is exactly the parent-based screen, so it can root a later chain.
    summary.fallback = `execution inputs changed since ${ref}: ${inputs.join(", ")}`;
    say(`fallback to a parent-based screen: ${summary.fallback}`);
    mode = "parent";
    base = parent;
    changed = g.changed(base, candidate);
  }
  const all = changed.includes(configFile);
  const link = { candidate, parent, platform: process.platform, mode, base };
  Object.assign(summary, {
    mode,
    base,
    selection: all ? "all" : "changed",
    configChanged: all,
    changedFiles: changed,
    chain:
      mode === "narrowed"
        ? [{ ...link, prior: summary.prior.sha256 }, ...prior.chain]
        : [link],
  });

  const select = [
    ...projects.map((p) => `--project=${p}`),
    ...(all ? [] : [`--only-changed=${base}`]),
  ];
  const listArgs = ["--list", "--reporter=json", ...select];
  summary.listCommand = ["node", "web/browser/run.mjs", ...listArgs];
  const list = playwrightJson(deps, paths.list, listArgs, fd, log);
  summary.listExitCode = list.code;
  if (list.code !== 0) refuse(`the list exited ${String(list.code)}`);
  const listed = listedTests(list.report);
  summary.tests = listed;
  if (listed.length === 0)
    refuse("no browser test is selected, so the screen would prove nothing");
  say(
    `${String(listed.length)} project-qualified tests selected (${summary.selection})`,
  );

  const built = deps.build(fd);
  summary.buildExitCode = built;
  if (built !== 0)
    refuse(`the guarded production build failed (exit ${String(built)})`);
  g.assertClean(candidate, "after the build");

  const runArgs = [
    `--repeat-each=${String(repeatEach)}`,
    "--retries=0",
    "--workers=2",
    "--reporter=list,json",
    ...select,
  ];
  summary.command = ["node", "web/browser/run.mjs", ...runArgs];
  summary.result = "fail";
  const run = playwrightJson(deps, paths.results, runArgs, fd, log);
  summary.exitCode = run.code;
  const verdict = judge(listed, run.report);
  summary.counts = verdict.counts;
  summary.complete =
    run.report !== null && verdict.counts.completed === verdict.counts.required;
  if (run.code !== 0)
    verdict.problems.push(`the run exited ${String(run.code)}`);
  summary.reasons.push(...verdict.problems);
  g.assertClean(candidate, "after the screen");
  if (summary.reasons.length === 0) summary.result = "pass";
}

export function flakeCheck(argv, deps) {
  let opts;
  let paths;
  try {
    opts = parseArgs(argv);
    paths = evidencePaths(opts.log, deps.repo);
  } catch (err) {
    deps.print(`flake-check: refused: ${err.message}`);
    deps.print(usage);
    return 1;
  }
  let fd;
  try {
    fd = openSync(paths.log, "wx");
  } catch (err) {
    deps.print(`flake-check: refused: ${err.message}`);
    return 1;
  }
  const log = (text) => writeSync(fd, `${text}\n`);
  const say = (text) => {
    log(text);
    deps.print(`flake-check: ${text}`);
  };
  const summary = {
    tool: "flake-check",
    format,
    result: "refused",
    complete: false,
    reasons: [],
    platform: process.platform,
    node: process.version,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    argv,
    candidate: null,
    parent: null,
    ref: null,
    mode: null,
    base: null,
    selection: null,
    fallback: null,
    configChanged: null,
    changedFiles: [],
    projects,
    repeatEach,
    prior: null,
    chain: [],
    listCommand: null,
    listExitCode: null,
    buildExitCode: null,
    command: null,
    exitCode: null,
    tests: [],
    counts: null,
    evidence: paths,
  };
  try {
    log(`$ node tools/flake-check.mjs ${argv.join(" ")}`);
    screen(opts, paths, deps, summary, fd, log, say);
  } catch (err) {
    summary.reasons.push(err.message);
  }
  summary.finishedAt = new Date().toISOString();
  for (const reason of summary.reasons) say(`${summary.result}: ${reason}`);
  say(`${summary.result.toUpperCase()} flake check; summary ${paths.summary}`);
  let code = summary.result === "pass" ? 0 : 1;
  try {
    writeFileSync(paths.summary, `${JSON.stringify(summary, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (err) {
    say(`the summary could not be written: ${err.message}`);
    code = 1;
  }
  closeSync(fd);
  return code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repo = join(import.meta.dirname, "..");
  const web = join(repo, "web");
  const into = (fd) => ({ cwd: web, stdio: ["ignore", fd, fd] });
  process.exitCode = flakeCheck(process.argv.slice(2), {
    repo,
    env: { ...process.env },
    git: gitRunner(repo),
    // The same guarded script CI runs: lint, typecheck, then the guarded vite build.
    build: (fd) => exec("npm", ["run", "build"], into(fd)).code,
    playwright: (args, env, fd) =>
      exec(process.execPath, [join(web, "browser", "run.mjs"), ...args], {
        ...into(fd),
        env,
      }).code,
    print: (line) => {
      console.log(line);
    },
  });
}
