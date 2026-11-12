// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptRun,
  caseKey,
  caseKeys,
  caseLists,
  evidenceProblems,
  hintsFile,
  judges,
  recordSetProblems,
  registryFile,
  roundTripCases,
  roundTripFile,
  roundTripSuite,
  runnerEnv,
  speechFile,
} from "./acceptance.ts";
import type { CaseKey, CaseList, ExpectedRecord } from "./acceptance.ts";
import { acceptEnvelope } from "./envelope.ts";
import type { RecordKind } from "./envelope.ts";
import { recordInventory } from "./inventory.ts";
import { runTestRecords } from "./records.ts";

const web = join(import.meta.dirname, "..");
// The kinds come from the compiler, as in the run itself; the global setup has built it.
const certified = runTestRecords({ builtByGlobalSetup: true });
const all: readonly ExpectedRecord[] = acceptEnvelope(
  certified.stdout,
  certified.exit,
  recordInventory(join(web, "compiled")),
).map(({ path, kind, part }) => ({ path, kind, part }));
const expected = all.filter(
  (r) => r.kind !== "aliases" && r.kind !== "patterns",
);
const scratch = join(web, ".cache");
mkdirSync(scratch, { recursive: true });
const temp = mkdtempSync(join(scratch, "acceptance-test-"));
// Kept outside the project, so a test file written here is never collected by a runner.
const apart = mkdtempSync(join(tmpdir(), "acceptance-apart-"));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
  rmSync(apart, { recursive: true, force: true });
});

interface Case {
  ancestorTitles: string[];
  title: string;
  status: string;
}

const listOf = (file: string): CaseList => {
  const list = caseLists.find((l) => l.file === file);
  if (list === undefined) throw new Error(`no case list for ${file}`);
  return list;
};
const listFor = (kind: CaseKey): CaseList => {
  const lists = caseLists.filter((l) => l.kinds.includes(kind));
  const [list] = lists;
  if (list === undefined || lists.length !== 1)
    throw new Error(`not exactly one case list for ${kind}`);
  return list;
};
const roundTrip = listOf(roundTripFile);
const speech = listOf(speechFile);
const hintLists = caseLists.filter((l) => l.file === hintsFile);
const aliases = listFor("aliases");
const patterns = listFor("patterns");

// The cases a list declares for the records of the kinds it judges.
const cases = (
  records: readonly ExpectedRecord[] = expected,
  list: CaseList = roundTrip,
): Case[] =>
  records
    .filter((r) => judges(list, r))
    .flatMap(({ path }) =>
      list.cases.map((title) => ({
        ancestorTitles: [list.suite + path],
        title,
        status: "passed",
      })),
    );

const registryCases = (records: readonly ExpectedRecord[] = all): Case[] => [
  ...cases(records, aliases),
  ...cases(records, patterns),
];

const hintCases = (records: readonly ExpectedRecord[] = expected): Case[] =>
  hintLists.flatMap((list) => cases(records, list));

// The speech, hints and registry files' results are complete unless a test replaces them.
const report = (
  assertionResults: unknown,
  name = join(web, roundTripFile),
  spoken: unknown = cases(expected, speech),
  registry: unknown = registryCases(),
  hinted: unknown = hintCases(),
) => ({
  success: true,
  testResults: [
    { name: join(web, "src", "App.test.tsx"), assertionResults: [] },
    { name, assertionResults },
    { name: join(web, speechFile), assertionResults: spoken },
    { name: join(web, hintsFile), assertionResults: hinted },
    { name: join(web, registryFile), assertionResults: registry },
  ],
});

const judged = (value: unknown, records: readonly ExpectedRecord[] = all) =>
  evidenceProblems(value, web, records);

// Every rendered record makes the round trip, only those with audio slots have a speech case,
// and hints records have their own cases.
const renderedBacked =
  expected.filter((r) => judges(roundTrip, r)).length * roundTripCases.length +
  expected.filter((r) => judges(speech, r)).length * speech.cases.length;
const recordBacked = renderedBacked + hintCases().length;

const first = expected[0]?.path ?? "";
const firstCase = roundTripCases[0] ?? "";
const gap = (found: string) =>
  `${first}: "${firstCase}" must pass exactly once, found [${found}]`;

describe("the round-trip evidence in a Vitest report", () => {
  it("accepts one passed result for every case of every record", () => {
    expect(expected.length).toBeGreaterThan(0);
    expect(judged(report(cases()))).toEqual([]);
  });

  it("accepts the file under another spelling of its path", () => {
    const name = join(
      web,
      "src",
      "content",
      "..",
      "content",
      "round-trip.test.tsx",
    );
    expect(judged(report(cases(), name))).toEqual([]);
  });

  // Two folders whose names are one text once letter case is folded hold two different files.
  it("refuses the same file name in a folder that only reads the same", () => {
    const rootIn = (name: string) => {
      const root = join(apart, name, "web");
      mkdirSync(join(root, "src", "content"), { recursive: true });
      writeFileSync(join(root, roundTripFile), "");
      return root;
    };
    const one = rootIn("İ");
    const other = rootIn("i̇");
    const named = (root: string) => report(cases(), join(root, roundTripFile));
    const only = [roundTrip];
    const rendered = expected.filter((r) => judges(roundTrip, r));
    expect(evidenceProblems(named(one), one, rendered, only)).toEqual([]);
    expect(evidenceProblems(named(other), one, rendered, only)).toEqual([
      `${roundTripFile} has 0 results in the Vitest report`,
    ]);
  });

  it.each(["skipped", "pending", "failed", "other"])(
    "refuses a %s case",
    (status) => {
      const all = cases();
      if (all[0]) all[0].status = status;
      expect(judged(report(all))).toEqual([gap(status)]);
    },
  );

  it("refuses a missing case, a repeated case and a missing record", () => {
    expect(judged(report(cases().slice(1)))).toEqual([gap("")]);
    expect(judged(report([...cases(), ...cases().slice(0, 1)]))).toEqual([
      gap("passed, passed"),
    ]);
    expect(judged(report(cases(expected.slice(1))))).toHaveLength(
      roundTripCases.length,
    );
  });

  it("refuses a case of an unknown record, an unknown case and a nested case", () => {
    const stray = (change: Partial<Case>) =>
      judged(report([...cases(), { ...cases()[0], ...change }]));
    expect(
      stray({ ancestorTitles: [`${roundTripSuite}compiled/zz/extra.json`] }),
    ).toEqual([
      `${roundTripSuite}compiled/zz/extra.json: unexpected case "${firstCase}"`,
    ]);
    expect(stray({ title: "another case" })).toEqual([
      `${roundTripSuite}${first}: unexpected case "another case"`,
    ]);
    expect(
      stray({ ancestorTitles: [roundTripSuite + first, "inner"] }),
    ).toEqual([`${roundTripSuite}${first}: unexpected case "${firstCase}"`]);
  });

  it("does not count the same titles in another file", () => {
    const elsewhere = join(web, "src", "App.test.tsx");
    expect(judged(report(cases(), elsewhere))).toEqual([
      `${roundTripFile} has 0 results in the Vitest report`,
    ]);
  });

  it("refuses the file reported twice", () => {
    const twice = report(cases());
    twice.testResults.push({
      name: join(web, roundTripFile),
      assertionResults: cases(),
    });
    expect(judged(twice)).toEqual([
      `${roundTripFile} has 2 results in the Vitest report`,
    ]);
  });

  it("refuses an unsuccessful, empty or malformed report", () => {
    expect(judged({ ...report(cases()), success: false })).toEqual([
      "the Vitest report does not record a successful run",
    ]);
    for (const value of [null, [], "text", {}, { success: true }])
      expect(judged(value)).toEqual(["the Vitest report has no test results"]);
    expect(judged(report(null))).toEqual([
      `${roundTripFile} has no case results`,
    ]);
    expect(judged(report([...cases(), { title: 1 }]))).toEqual([
      `${roundTripFile} has a malformed case result`,
    ]);
  });

  it("refuses a record whose speech case is missing, skipped or repeated", () => {
    const title = speech.cases[0] ?? "";
    const found = (results: Case[]) =>
      judged(report(cases(), join(web, roundTripFile), results));
    const all = () => cases(expected, speech);
    const line = (status: string) =>
      `${first}: "${title}" must pass exactly once, found [${status}]`;
    expect(title).not.toBe("");
    expect(found(all().slice(1))).toEqual([line("")]);
    const skipped = all();
    if (skipped[0]) skipped[0].status = "skipped";
    expect(found(skipped)).toEqual([line("skipped")]);
    expect(found([...all(), ...all().slice(0, 1)])).toEqual([
      line("passed, passed"),
    ]);
  });

  it("refuses a report without the speech file, or with only its titles elsewhere", () => {
    const missing = `${speechFile} has 0 results in the Vitest report`;
    const base = report(cases());
    const isSpeech = (r: { name: string }) => r.name === join(web, speechFile);
    const without = {
      ...base,
      testResults: base.testResults.filter((r) => !isSpeech(r)),
    };
    expect(judged(without)).toEqual([missing]);
    const moved = report([...cases(), ...cases(expected, speech)]);
    moved.testResults.splice(moved.testResults.findIndex(isSpeech), 1);
    expect(judged(moved)).toEqual([missing]);
  });

  it("does not let one file's cases stand for the other's", () => {
    const swapped = report(
      cases(expected, speech),
      join(web, roundTripFile),
      cases(),
    );
    expect(judged(swapped)).toHaveLength(renderedBacked);
  });

  it("refuses an empty list of case lists and a list without cases", () => {
    expect(evidenceProblems(report(cases()), web, expected, [])).toEqual([
      "no case list is given",
    ]);
    const empty = evidenceProblems(report(cases()), web, expected, [
      { ...roundTrip, cases: [] },
    ]);
    expect(empty).toEqual(
      expected.map(
        (r) =>
          `${r.path}: no case list judges the kind ${r.kind}${r.part === null ? "" : ` with the part kind ${r.part}`}`,
      ),
    );
  });

  it("refuses a record whose kind no list judges", () => {
    const stray = {
      path: "compiled/zz.json",
      kind: "registry" as RecordKind,
      part: null,
    };
    expect(judged(report(cases()), [...all, stray])).toEqual([
      "compiled/zz.json: no case list judges the kind registry",
    ]);
    expect(
      evidenceProblems(report(cases()), web, all, [roundTrip, speech]),
    ).toEqual(
      all
        .filter((r) => !judges(roundTrip, r) && !judges(speech, r))
        .map(
          (r) =>
            `${r.path}: no case list judges the kind ${r.kind}${r.part === null ? "" : ` with the part kind ${r.part}`}`,
        ),
    );
  });

  it("holds every kind to its own lists whatever the record is called", () => {
    // A chapter record stated as an alias registry owes the alias cases, and its round-trip
    // results no longer count for anything.
    const relabelled = all.map((r) =>
      r.path === first ? { ...r, kind: "aliases" as const, part: null } : r,
    );
    const problems = judged(report(cases()), relabelled);
    for (const title of aliases.cases)
      expect(problems).toContain(
        `${first}: "${title}" must pass exactly once, found []`,
      );
    expect(problems).toContain(
      `${roundTripSuite}${first}: unexpected case "${firstCase}"`,
    );
    // The other way round: a registry stated as a chapter owes every chapter case.
    const registry = all.find((r) => r.kind === "patterns")?.path ?? "";
    const promoted = all.map((r) =>
      r.path === registry ? { ...r, kind: "chapter" as const } : r,
    );
    expect(judged(report(cases()), promoted)).toContain(
      `${registry}: "${firstCase}" must pass exactly once, found []`,
    );
  });

  it("refuses a registry case that is missing, skipped, repeated or in the wrong suite", () => {
    const path = all.find((r) => r.kind === "aliases")?.path ?? "";
    const title = aliases.cases[0] ?? "";
    const found = (results: Case[]) =>
      judged(report(cases(), join(web, roundTripFile), undefined, results));
    const line = (status: string) =>
      `${path}: "${title}" must pass exactly once, found [${status}]`;
    expect(path).not.toBe("");
    expect(found(registryCases().slice(1))).toEqual([line("")]);
    const skipped = registryCases();
    if (skipped[0]) skipped[0].status = "skipped";
    expect(found(skipped)).toEqual([line("skipped")]);
    expect(found([...registryCases(), ...registryCases().slice(0, 1)])).toEqual(
      [line("passed, passed")],
    );
    // An alias case filed under the pattern suite proves nothing about either.
    const crossed = registryCases();
    if (crossed[0])
      crossed[0].ancestorTitles = [
        patterns.suite + (all.find((r) => r.kind === "patterns")?.path ?? ""),
      ];
    expect(found(crossed)).toContain(line(""));
    expect(found([])).toHaveLength(
      aliases.cases.length + patterns.cases.length,
    );
  });

  it("refuses a report without the registry file", () => {
    const base = report(cases());
    base.testResults.pop();
    expect(judged(base)).toEqual([
      `${registryFile} has 0 results in the Vitest report`,
    ]);
  });

  it("requires exactly one record of each registry kind", () => {
    const without = (kind: RecordKind) => all.filter((r) => r.kind !== kind);
    const twice = (kind: RecordKind) => [
      ...all,
      { path: "compiled/zz.json", kind, part: null },
    ];
    expect(recordSetProblems(all)).toEqual([]);
    expect(recordSetProblems(without("aliases"))).toEqual([
      "the compiled records must hold exactly one aliases record",
    ]);
    expect(recordSetProblems(twice("patterns"))).toEqual([
      "the compiled records must hold exactly one patterns record",
    ]);
    expect(recordSetProblems(expected)).toHaveLength(2);
    expect(recordSetProblems([])).toHaveLength(2);
  });

  it("refuses a part without a part kind and any other record with one", () => {
    const part = all.find((r) => r.kind === "part")?.path ?? "";
    const bare = all.map((r) => (r.path === part ? { ...r, part: null } : r));
    expect(judged(report(cases()), bare)).toEqual([
      `${part}: no case list judges the kind part`,
    ]);
    for (const kind of ["chapter", "aliases", "patterns"] as const) {
      const path = all.find((r) => r.kind === kind)?.path ?? "";
      const tagged = all.map((r) =>
        r.path === path ? { ...r, part: "syntax" as const } : r,
      );
      expect(judged(report(cases()), tagged)).toEqual([
        `${path}: no case list judges the kind ${kind} with the part kind syntax`,
      ]);
    }
  });

  it("refuses a list keyed on the record kind alone for parts", () => {
    const loose = { ...roundTrip, kinds: ["chapter", "part"] as never };
    expect(
      evidenceProblems(report(cases()), web, expected, [loose, speech]),
    ).toEqual([
      `${roundTripFile}: a list is keyed on part, which is no record identity`,
    ]);
  });

  it("holds each part kind to the lists keyed on it", () => {
    const rendered = expected.filter((r) => judges(roundTrip, r));
    const build = all.find((r) => r.part === "build")?.path ?? "";
    const own: CaseList = {
      file: roundTripFile,
      suite: "the build cases of ",
      kinds: ["part:build"],
      cases: ["a case only a build part owes"],
    };
    const problems = evidenceProblems(report(cases()), web, rendered, [
      roundTrip,
      own,
    ]);
    expect(problems).toEqual([
      `${build}: "a case only a build part owes" must pass exactly once, found []`,
    ]);
    // Stated as a syntax part, the same record owes none of the build cases.
    const relabelled = rendered.map((r) =>
      r.path === build ? { ...r, part: "syntax" as const } : r,
    );
    expect(
      evidenceProblems(report(cases()), web, relabelled, [roundTrip, own]),
    ).toEqual([]);
  });

  it("refuses an empty expected set whatever the report holds", () => {
    expect(judged(report(cases()), [])).toEqual([
      "the compiled inventory is empty",
    ]);
  });
});

describe("the record-backed case lists", () => {
  it("name each suite once and no suite inside another", () => {
    const suites = caseLists.map((l) => l.suite);
    expect(new Set(suites).size).toBe(suites.length);
    for (const suite of suites)
      expect(suites.filter((other) => other.startsWith(suite))).toEqual([
        suite,
      ]);
    expect([...new Set(caseLists.map((l) => l.file))]).toEqual([
      roundTripFile,
      speechFile,
      hintsFile,
      registryFile,
    ]);
  });

  it("carry a key for every record kind and every part kind, never part alone", () => {
    expect(caseKeys).toEqual([
      "chapter",
      "aliases",
      "patterns",
      "glossary",
      "error",
      "hints-catalogue",
      "part:syntax",
      "part:build",
      "part:idioms",
      "part:gotchas",
      "part:library",
      "part:cards",
      "part:drill",
      "part:hints",
    ]);
    expect(caseKeys).not.toContain("part");
  });

  it("key a record only when its kind and part kind belong together", () => {
    expect(caseKey({ kind: "chapter", part: null })).toBe("chapter");
    expect(caseKey({ kind: "part", part: "build" })).toBe("part:build");
    expect(caseKey({ kind: "part", part: null })).toBeNull();
    expect(caseKey({ kind: "part", part: "hints" })).toBe("part:hints");
    expect(caseKey({ kind: "part", part: "quiz" as never })).toBeNull();
    expect(caseKey({ kind: "hints-catalogue", part: "hints" })).toBeNull();
    for (const kind of ["chapter", "aliases", "patterns"] as const)
      expect(caseKey({ kind, part: "syntax" })).toBeNull();
    expect(caseKey({ kind: "registry" as never, part: null })).toBeNull();
  });

  it.each(caseKeys)(
    "judge the kind %s with a list of its own cases",
    (kind) => {
      const lists = caseLists.filter((l) => l.kinds.includes(kind));
      expect(lists.length).toBeGreaterThan(0);
      for (const list of lists) {
        expect(list.cases.length).toBeGreaterThan(0);
        expect(new Set(list.cases).size).toBe(list.cases.length);
      }
    },
  );

  it.each(caseLists.map((l) => [`${l.file} under "${l.suite}"`, l] as const))(
    "are exactly the cases %s declares for each record",
    (_, list) => {
      const text = readFileSync(join(web, list.file), "utf8");
      const file = ts.createSourceFile(
        list.file,
        text,
        ts.ScriptTarget.Latest,
        true,
        list.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const suites: string[][] = [];
      const visit = (node: ts.Node): void => {
        const [name, body] = ts.isCallExpression(node) ? node.arguments : [];
        if (
          ts.isCallExpression(node) &&
          ts.isCallExpression(node.expression) &&
          node.expression.expression.getText(file) === "describe.each" &&
          name !== undefined &&
          ts.isStringLiteral(name) &&
          name.text === `${list.suite}%s` &&
          body !== undefined &&
          ts.isArrowFunction(body) &&
          ts.isBlock(body.body)
        )
          suites.push(
            body.body.statements.flatMap((s) => {
              const call = ts.isExpressionStatement(s) ? s.expression : null;
              const [title] =
                call && ts.isCallExpression(call) ? call.arguments : [];
              return call &&
                ts.isCallExpression(call) &&
                call.expression.getText(file) === "it" &&
                title !== undefined &&
                ts.isStringLiteral(title)
                ? [title.text]
                : [];
            }),
          );
        ts.forEachChild(node, visit);
      };
      visit(file);
      expect(suites).toEqual([[...list.cases]]);
    },
  );
});

describe("the child runner's environment", () => {
  const named = [
    "NODE_OPTIONS",
    "NODE_ENV",
    "NODE_PATH",
    "NODE_V8_COVERAGE",
    "UPDATE_SNAPSHOT",
    "VITEST",
    "TEST",
    "ESBUILD_BINARY_PATH",
    "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS",
  ];
  const prefixed = [
    "VITEST_POOL_ID",
    "VITE_ROOT",
    "TS_NODE_PROJECT",
    "npm_config_userconfig",
    "npm_config_script_shell",
    "npm_config_node_options",
    "npm_config_cache_min",
    "npm_config_cache_dir",
    "npm_config_",
    "NPM_CONFIG_PREFIX",
  ];
  const kept = {
    PATH: "/bin",
    Path: "C:\\bin",
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\temp",
    TMPDIR: "/tmp",
    CI: "true",
    DOTNET_ROOT: "/dotnet",
    NODE_ENVIRONMENT: "kept",
    UNRELATED: "1",
  };

  it("removes each named key and each prefix, keeping the rest", () => {
    const caller = Object.fromEntries(
      [...named, ...prefixed].map((key) => [key, "x"]),
    );
    expect(runnerEnv({ ...caller, ...kept })).toEqual({
      ...kept,
      NODE_ENV: "test",
    });
  });

  it("removes keys in any letter case, a differently cased duplicate included", () => {
    const caller = {
      Node_Options: "--require a",
      NODE_OPTIONS: "--require b",
      node_env: "production",
      Vitest_Mode: "x",
      Vite_Root: "x",
      ts_node_project: "x",
      NPM_CONFIG_USERCONFIG: "x",
      Npm_Config_Cache_Min: "x",
      Update_Snapshot: "x",
      test: "x",
      ...kept,
    };
    const env = runnerEnv(caller);
    expect(
      Object.keys(env).filter((k) => k.toLowerCase() === "node_env"),
    ).toEqual(["NODE_ENV"]);
    expect(env["NODE_ENV"]).toBe("test");
    expect(env).toEqual({ ...kept, NODE_ENV: "test" });
  });

  it.each(["npm_config_cache", "NPM_CONFIG_CACHE", "Npm_Config_Cache"])(
    "keeps the package cache location spelled %s",
    (key) => {
      expect(runnerEnv({ [key]: "/var/cache", ...kept })).toEqual({
        ...kept,
        [key]: "/var/cache",
        NODE_ENV: "test",
      });
    },
  );

  it("leaves its input unchanged", () => {
    const caller = {
      NODE_OPTIONS: "--require a",
      NODE_ENV: "production",
      ...kept,
    };
    const copy = { ...caller };
    runnerEnv(caller);
    expect(caller).toEqual(copy);
  });
});

// A real offline install, as the fixture installs run it, with the filtered environment.
describe("an offline install under the child runner's environment", () => {
  const npm = [
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(
      dirname(process.execPath),
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].find((path) => existsSync(path));
  // Windows holds one value per name in any letter case, so the launcher's own is dropped first.
  const launcher = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key.toLowerCase() !== "npm_config_cache",
    ),
  );
  const dir = (name: string) => {
    const made = join(temp, "offline", name);
    mkdirSync(made, { recursive: true });
    return made;
  };
  const run = (cwd: string, args: string[], cache: string) => {
    const done = spawnSync(process.execPath, [npm ?? "", ...args], {
      cwd,
      env: runnerEnv({ ...launcher, npm_config_cache: cache }),
      encoding: "utf8",
      timeout: 150_000,
    });
    if (done.error) throw done.error;
    return done;
  };
  const ci = ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"];
  const [full, empty] = [dir("full-cache"), dir("empty-cache")];
  const lock = (integrity: string) => ({
    name: "app",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "app",
        version: "1.0.0",
        dependencies: { "cache-probe-dep": "1.0.0" },
      },
      "node_modules/cache-probe-dep": {
        version: "1.0.0",
        resolved:
          "https://registry.npmjs.org/cache-probe-dep/-/cache-probe-dep-1.0.0.tgz",
        integrity,
      },
    },
  });
  const app = (name: string, integrity: string) => {
    const made = dir(name);
    writeFileSync(
      join(made, "package.json"),
      JSON.stringify(lock(integrity).packages[""]),
    );
    writeFileSync(
      join(made, "package-lock.json"),
      JSON.stringify(lock(integrity)),
    );
    return made;
  };
  let integrity = "";

  // The only package the install needs is packed here and put in a cache that is not npm's default.
  beforeAll(() => {
    const dep = dir("dep");
    writeFileSync(
      join(dep, "package.json"),
      '{"name":"cache-probe-dep","version":"1.0.0"}\n',
    );
    writeFileSync(join(dep, "index.js"), "module.exports = 1;\n");
    expect(run(dep, ["pack"], full).status).toBe(0);
    const packed = join(dep, "cache-probe-dep-1.0.0.tgz");
    integrity = `sha512-${createHash("sha512").update(readFileSync(packed)).digest("base64")}`;
    expect(run(dep, ["cache", "add", packed], full).status).toBe(0);
  }, 180_000);

  it("finds the package in the cache the caller named", () => {
    const made = app("app-full", integrity);
    const done = run(made, ci, full);
    expect(done.stderr).not.toContain("only-if-cached");
    expect(done.status).toBe(0);
    expect(
      existsSync(join(made, "node_modules", "cache-probe-dep", "index.js")),
    ).toBe(true);
  }, 180_000);

  it("fails without the network when the named cache is empty", () => {
    const made = app("app-empty", integrity);
    const done = run(made, ci, empty);
    expect(done.status).not.toBe(0);
    expect(done.stderr).toContain("only-if-cached");
    expect(existsSync(join(made, "node_modules", "cache-probe-dep"))).toBe(
      false,
    );
  }, 180_000);
});

// Each run below is a real Vitest run of the round-trip file through the acceptance entry.
describe("the acceptance run", { timeout: 300_000 }, () => {
  const run = (extra: string[]) => {
    const lines: string[] = [];
    const exit = acceptRun(extra, (line) => lines.push(line));
    return { exit, lines };
  };

  it("fails when a name filter skips the record-backed cases", () => {
    const { exit, lines } = run([
      roundTripFile,
      speechFile,
      hintsFile,
      registryFile,
      "-t",
      "strict binding",
    ]);
    expect(exit).toBe(1);
    expect(lines).toContain(`acceptance evidence: ${gap("skipped")}`);
    expect(lines).toHaveLength(
      recordBacked + aliases.cases.length + patterns.cases.length,
    );
  });

  it("fails when the round-trip file is not part of the run", () => {
    const { exit, lines } = run(["src/App.test.tsx"]);
    expect(exit).toBe(1);
    expect(lines).toEqual([
      `acceptance evidence: ${roundTripFile} has 0 results in the Vitest report`,
      `acceptance evidence: ${speechFile} has 0 results in the Vitest report`,
      `acceptance evidence: ${hintsFile} has 0 results in the Vitest report`,
      `acceptance evidence: ${registryFile} has 0 results in the Vitest report`,
    ]);
  });

  it.each([
    [speechFile, [roundTripFile, hintsFile, registryFile]],
    [hintsFile, [roundTripFile, speechFile, registryFile]],
    [registryFile, [roundTripFile, speechFile, hintsFile]],
  ])("fails when %s is not part of the run", (missing, files) => {
    const { exit, lines } = run(files);
    expect(exit).toBe(1);
    expect(lines).toEqual([
      `acceptance evidence: ${missing} has 0 results in the Vitest report`,
    ]);
  });

  const withVariable = <T>(key: string, value: string, body: () => T): T => {
    const before = process.env[key];
    process.env[key] = value;
    try {
      return body();
    } finally {
      if (before === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = before;
    }
  };

  it("keeps the caller's NODE_OPTIONS preload out of the runner", () => {
    const marker = join(temp, "preloaded");
    const preload = join(temp, "preload.cjs");
    writeFileSync(
      preload,
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "loaded");\n`,
    );
    const { exit } = withVariable(
      "NODE_OPTIONS",
      `--require ${JSON.stringify(preload)}`,
      () => run([roundTripFile, speechFile, hintsFile, registryFile]),
    );
    expect(existsSync(marker)).toBe(false);
    expect(exit).toBe(0);
  });

  it("runs in test mode whatever the caller's NODE_ENV", () => {
    const seen = join(temp, "node-env");
    const config = join(temp, "node-env.config.ts");
    writeFileSync(
      config,
      [
        'import { writeFileSync } from "node:fs";',
        'import base from "../../vite.config.ts";',
        `writeFileSync(${JSON.stringify(seen)}, String(process.env.NODE_ENV));`,
        "export default {",
        "  ...base,",
        `  root: ${JSON.stringify(web)},`,
        "};",
        "",
      ].join("\n"),
    );
    const { exit } = withVariable("NODE_ENV", "production", () =>
      run([
        roundTripFile,
        speechFile,
        hintsFile,
        registryFile,
        "--config",
        config,
      ]),
    );
    expect(readFileSync(seen, "utf8")).toBe("test");
    expect(exit).toBe(0);
  });

  it("fails when the configuration drops the global setup", () => {
    const config = join(temp, "no-setup.config.ts");
    writeFileSync(
      config,
      [
        'import base from "../../vite.config.ts";',
        "export default {",
        "  ...base,",
        `  root: ${JSON.stringify(web)},`,
        "  test: { ...base.test, globalSetup: [] },",
        "};",
        "",
      ].join("\n"),
    );
    const { exit, lines } = run([roundTripFile, "--config", config]);
    expect(exit).not.toBe(0);
    expect(lines).toEqual([]);
  });
});
