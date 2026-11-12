// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../vite.config.ts";
import { ports, serverCommand } from "../browser/pins.ts";
import { startupProblems, sweepingFlag } from "./startup.js";

const web = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "sl-startup-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const missing = `the process must start with ${sweepingFlag} exactly once, found 0`;
const inOptions = `NODE_OPTIONS holds ${JSON.stringify(sweepingFlag)}; the flag is admitted only on the command line`;

// The children start from these arguments alone, whatever the caller's environment says.
function cleanEnv(nodeOptions) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key.toLowerCase() !== "node_options",
    ),
  );
  return nodeOptions === undefined
    ? env
    : { ...env, NODE_OPTIONS: nodeOptions };
}

// Every variable a platform reads for its temporary directory points at `temp` instead.
function tempEnv(env, temp) {
  if (temp === undefined) return env;
  const names = ["TEMP", "TMP", "TMPDIR"];
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => !names.includes(key.toUpperCase())),
    ),
    ...Object.fromEntries(names.map((name) => [name, temp])),
  };
}

function child(flags, args, { nodeOptions, cwd = web, temp } = {}) {
  return spawnSync(process.execPath, [...flags, ...args], {
    cwd,
    env: tempEnv(cleanEnv(nodeOptions), temp),
    encoding: "utf8",
    timeout: 120_000,
  });
}

// The crash this guards against comes at exit, so a child's output counts only beside a clean exit.
function expectCleanExit(r) {
  expect(r.error).toBeUndefined();
  expect(r.signal).toBeNull();
  expect(r.status).toBe(0);
}

const moduleUrl = (...path) =>
  JSON.stringify(pathToFileURL(join(web, ...path)).href);

// A fresh process per script, since admission reads only the arguments a process started with.
function script(flags, lines, options) {
  return child(
    flags,
    ["--input-type=module", "--eval", lines.join("\n")],
    options,
  );
}

function guardScript(flags, lines, options) {
  return script(
    flags,
    [
      `import * as guard from ${moduleUrl("build-guard", "build.mjs")};`,
      ...lines,
    ],
    options,
  );
}

// Calls one exported entry, printing what it returned or threw. The pinned Node refuses the flag
// in NODE_OPTIONS before any script runs, so `laterNodeOptions` sets the variable as a later
// release would pass it.
function entry(flags, call, { laterNodeOptions, ...options } = {}) {
  return guardScript(
    flags,
    [
      laterNodeOptions === undefined
        ? ""
        : `process.env.NODE_OPTIONS = ${JSON.stringify(laterNodeOptions)};`,
      "try {",
      `  console.log("returned " + JSON.stringify(await (${call})));`,
      "} catch (error) {",
      "  console.log(`threw ${error.message}`);",
      "}",
    ],
    options,
  );
}

describe("startup admission: arguments", () => {
  it("admits the one canonical flag beside the runner's own arguments", () => {
    expect(
      startupProblems([
        "--experimental-import-meta-resolve",
        "--require",
        "C:/x/concurrent-array-buffer-sweeping.cjs",
        sweepingFlag,
      ]),
    ).toEqual([]);
    expect(
      startupProblems(
        [sweepingFlag],
        '--max-old-space-size=4096 --require "a b.cjs"',
      ),
    ).toEqual([]);
  });

  it("refuses a process started without the flag or with it twice", () => {
    expect(startupProblems([])).toEqual([missing]);
    expect(startupProblems(["--expose-gc"])).toEqual([missing]);
    expect(startupProblems([sweepingFlag, sweepingFlag])).toEqual([
      `the process must start with ${sweepingFlag} exactly once, found 2`,
    ]);
  });

  it.each([
    "--concurrent-array-buffer-sweeping",
    "--concurrent_array_buffer_sweeping",
    "--no_concurrent_array_buffer_sweeping",
    "--no-concurrent_array-buffer_sweeping",
    "--noconcurrent-array-buffer-sweeping",
    "--no_concurrent-array-buffer-sweeping",
    "-no-concurrent-array-buffer-sweeping",
    "-concurrent-array-buffer-sweeping",
    "--no-concurrent-array-buffer-sweeping=true",
    "--concurrent-array-buffer-sweeping=false",
    "--No-Concurrent-Array-Buffer-Sweeping",
  ])(
    "refuses %s on the command line, beside the canonical flag or not",
    (form) => {
      const another = `the process starts with ${JSON.stringify(form)}, another form of ${sweepingFlag}`;
      expect(startupProblems([sweepingFlag, form])).toEqual([another]);
      expect(startupProblems([form, sweepingFlag])).toEqual([another]);
      expect(startupProblems([form])).toEqual([missing, another]);
    },
  );

  it.each([
    [sweepingFlag, sweepingFlag],
    [
      "--concurrent-array-buffer-sweeping",
      "--concurrent-array-buffer-sweeping",
    ],
    [
      '"--concurrent_array_buffer_sweeping"',
      "--concurrent_array_buffer_sweeping",
    ],
    [
      "--max-old-space-size=4096   --noconcurrent-array-buffer-sweeping",
      "--noconcurrent-array-buffer-sweeping",
    ],
    [
      '--title "a b" --concurrent-array-buffer-sweeping=false',
      "--concurrent-array-buffer-sweeping=false",
    ],
    [
      '"--concurrent-array\\-buffer-sweeping"',
      "--concurrent-array-buffer-sweeping",
    ],
  ])("refuses NODE_OPTIONS %s", (nodeOptions, form) => {
    expect(startupProblems([sweepingFlag], nodeOptions)).toEqual([
      `NODE_OPTIONS holds ${JSON.stringify(form)}; the flag is admitted only on the command line`,
    ]);
  });

  it.each(['--title "open', '--title "ends\\'])(
    "refuses NODE_OPTIONS %s, which Node itself refuses",
    (nodeOptions) => {
      expect(startupProblems([sweepingFlag], nodeOptions)).toEqual([
        "NODE_OPTIONS leaves a string open or ends one with a backslash",
      ]);
    },
  );

  // Node separates NODE_OPTIONS at spaces only, so these keep the flag inside the title's value.
  it.each([
    ["a tab", "\t"],
    ["a newline", "\n"],
    ["a no-break space", " "],
  ])("admits NODE_OPTIONS where %s joins the flag to a value", (_, gap) => {
    expect(
      startupProblems(
        [sweepingFlag],
        `--title=hello${gap}--concurrent-array-buffer-sweeping`,
      ),
    ).toEqual([]);
    expect(
      startupProblems(
        [sweepingFlag],
        "--title=hello --concurrent-array-buffer-sweeping",
      ),
    ).toEqual([
      'NODE_OPTIONS holds "--concurrent-array-buffer-sweeping"; the flag is admitted only on the command line',
    ]);
  });

  it("reads quotes and escapes in NODE_OPTIONS as Node does", () => {
    expect(startupProblems([sweepingFlag], '--title=a"b c"\\ --x ""')).toEqual(
      [],
    );
    expect(
      startupProblems(
        [sweepingFlag],
        '--title="a" "--concurrent"-array-buffer-sweeping',
      ),
    ).toEqual([
      'NODE_OPTIONS holds "--concurrent-array-buffer-sweeping"; the flag is admitted only on the command line',
    ]);
  });
});

describe("startup admission: launch paths", () => {
  it("runs every test worker with the flag once", () => {
    expect(config.test?.pool).toBe("forks");
    expect(config.test?.execArgv).toEqual([sweepingFlag]);
    expect(
      startupProblems(process.execArgv, process.env["NODE_OPTIONS"] ?? ""),
    ).toEqual([]);
  });

  it("starts the release build and every browser server with the flag", () => {
    const { scripts } = JSON.parse(
      readFileSync(join(web, "package.json"), "utf8"),
    );
    expect(scripts.build).toMatch(
      new RegExp(`&& node ${sweepingFlag} build-guard/build\\.mjs$`, "u"),
    );
    for (const kind of ["dist", "specimen", "harness"])
      expect(serverCommand(kind)).toBe(
        `"${process.execPath}" ${sweepingFlag} browser/serve.mjs ${kind} ${String(ports[kind])}`,
      );
  });
});

describe("startup admission: each guard entry", () => {
  it.each([
    ["releaseBuild", "guard.releaseBuild({ build: { outDir: OUT } })"],
    ["terminalProvenance", "guard.terminalProvenance(new Map(), null)"],
    ["routeViolations", "guard.routeViolations(new Map())"],
  ])("refuses %s in an unflagged process before any work", (name, call) => {
    const out = join(scratch, `out-${name}`);
    const r = entry([], call.replace("OUT", JSON.stringify(out)));
    expectCleanExit(r);
    expect(r.stdout.trim()).toBe(`threw build guard: startup: ${missing}`);
    expect(existsSync(out)).toBe(false);
  });

  it("admits a flagged process", () => {
    const r = entry([sweepingFlag], "guard.routeViolations(new Map())");
    expectCleanExit(r);
    expect(r.stdout.trim()).toBe("returned []");
  });

  it("refuses a flagged process that also starts with another form", () => {
    const r = entry(
      [sweepingFlag, "--concurrent-array-buffer-sweeping"],
      "guard.routeViolations(new Map())",
    );
    expectCleanExit(r);
    expect(r.stdout.trim()).toMatch(
      /^threw build guard: startup: the process starts with/u,
    );
  });

  it("never runs with the opposite flag in NODE_OPTIONS", () => {
    const r = entry([sweepingFlag], "guard.routeViolations(new Map())", {
      nodeOptions: "--concurrent-array-buffer-sweeping",
    });
    // Node may refuse the variable before the script starts; either way nothing is admitted.
    expect(r.status === 0 && r.stdout.trim() === "returned []").toBe(false);
  });

  it(
    "fails the release command unflagged and serves nothing",
    { timeout: 300_000 },
    () => {
      const build = child([], ["build-guard/build.mjs"]);
      expect(build.status).toBe(1);
      expect(build.stderr.trim()).toBe(`build guard: startup: ${missing}`);
      const server = child([], ["browser/serve.mjs", "dist", "0"]);
      expect(server.status).toBe(1);
      expect(server.stdout).not.toMatch(/serving/u);
      expect(server.stderr.trim()).toBe(`build guard: startup: ${missing}`);
    },
  );
});

describe("startup admission: the release helpers", () => {
  const absent = join(scratch, "absent", "web");
  const recheck = join(scratch, "recheck");
  beforeAll(() => {
    mkdirSync(recheck);
    writeFileSync(join(recheck, "a.txt"), "a");
  });

  // Each call does visible work of its own once admitted, so a refusal can only come first.
  const helpers = [
    [
      "measure",
      'guard.measure(new Map([["a.css", { bytes: Buffer.from("a{}") }]]))',
      /^returned \{"css":\[\{"path":"a\.css","gzip":\d+\}\],"fonts":\[\],"fontTotal":0,"problems":\[\]\}$/u,
    ],
    [
      "terminalAdmission",
      `guard.terminalAdmission({ root: ${JSON.stringify(absent)} }, new Map())`,
      /^threw build guard: assets: /u,
    ],
    [
      "releaseRecheck",
      `guard.releaseRecheck(${JSON.stringify(recheck)}, new Map())`,
      /^threw build guard: .+ after verification has an extra file a\.txt$/u,
    ],
  ];
  const other = "--no_concurrent_array_buffer_sweeping";
  const starts = [
    ["without the flag", [], {}, missing],
    [
      "with another spelling",
      [other],
      {},
      `${missing}; the process starts with ${JSON.stringify(other)}, another form of ${sweepingFlag}`,
    ],
    [
      "with the flag twice",
      [sweepingFlag, sweepingFlag],
      {},
      `the process must start with ${sweepingFlag} exactly once, found 2`,
    ],
    [
      "with the flag in NODE_OPTIONS",
      [sweepingFlag],
      { laterNodeOptions: sweepingFlag },
      inOptions,
    ],
  ];

  it.each(
    helpers.flatMap(([name, call]) =>
      starts.map(([start, flags, options, problem]) => [
        name,
        start,
        call,
        flags,
        options,
        problem,
      ]),
    ),
  )("refuses %s started %s", (_, __, call, flags, options, problem) => {
    const r = entry(flags, call, options);
    expectCleanExit(r);
    expect(r.stdout.trim()).toBe(`threw build guard: startup: ${problem}`);
  });

  it.each(helpers)(
    "never runs %s with the flag in the real NODE_OPTIONS",
    (_, call) => {
      const r = entry([sweepingFlag], call, { nodeOptions: sweepingFlag });
      // Either Node refuses the variable before the script starts or the guard refuses the call.
      expect(r.stdout.trim()).toBe(
        r.status === 0 ? `threw build guard: startup: ${inOptions}` : "",
      );
    },
  );

  it.each(helpers)(
    "admits %s started with the flag once",
    (_, call, admitted) => {
      const r = entry([sweepingFlag], call);
      expectCleanExit(r);
      expect(r.stdout.trim()).toMatch(admitted);
    },
  );
});

describe("startup admission: every export", () => {
  it("refuses each exported function in an unflagged process", () => {
    const r = guardScript(
      [],
      [
        "const seen = {};",
        "for (const [name, value] of Object.entries(guard)) {",
        '  if (typeof value !== "function") seen[name] = null;',
        "  else {",
        "    try {",
        "      await value();",
        '      seen[name] = "returned";',
        "    } catch (error) {",
        "      seen[name] = error.message;",
        "    }",
        "  }",
        "}",
        "console.log(JSON.stringify(seen));",
      ],
    );
    expectCleanExit(r);
    const seen = JSON.parse(r.stdout);
    const functions = Object.keys(seen).filter((name) => seen[name] !== null);
    expect(functions).toEqual(
      expect.arrayContaining([
        "measure",
        "releaseBuild",
        "releaseRecheck",
        "routeViolations",
        "terminalAdmission",
        "terminalProvenance",
      ]),
    );
    for (const name of functions)
      expect([name, seen[name]]).toEqual([
        name,
        `build guard: startup: ${missing}`,
      ]);
    // Plain data does no work; any other kind of export must be judged here before it ships.
    expect(Object.keys(seen).filter((name) => seen[name] === null)).toEqual([
      "limits",
    ]);
  });
});

describe("startup admission: a direct Vite build", () => {
  // The guard refuses any unpinned plugin before buildStart, so the sentinel rides in memory on
  // its own pinned C2 plugin. Ordered first, it is reached whenever bundling begins, and stops it.
  const viteBuild = (flags) =>
    script(flags, [
      'import { build, loadConfigFromFile } from "vite";',
      "let reached = false;",
      "let outcome = null;",
      "try {",
      "  const { config } = await loadConfigFromFile(",
      '    { command: "build", mode: "production" },',
      `    ${JSON.stringify(join(web, "vite.config.ts"))},`,
      "  );",
      "  const host = config.plugins",
      "    .flat()",
      '    .find((plugin) => plugin?.name === "sharpladder:css-minify");',
      "  host.buildStart = {",
      '    order: "pre",',
      "    handler() {",
      "      reached = true;",
      '      throw new Error("sentinel reached");',
      "    },",
      "  };",
      "  await build({",
      "    ...config,",
      `    root: ${JSON.stringify(web)},`,
      "    configFile: false,",
      '    logLevel: "silent",',
      "    build: { ...config.build, write: false },",
      "  });",
      "} catch (error) {",
      "  outcome = error.message;",
      "}",
      "console.log(JSON.stringify({ reached, outcome }));",
    ]);

  it(
    "refuses an unflagged process before bundling begins",
    { timeout: 300_000 },
    () => {
      const r = viteBuild([]);
      expectCleanExit(r);
      expect(JSON.parse(r.stdout)).toEqual({
        reached: false,
        outcome: `build guard: startup: ${missing}`,
      });
    },
  );

  it("admits a flagged process", { timeout: 300_000 }, () => {
    const r = viteBuild([sweepingFlag]);
    expectCleanExit(r);
    const { reached, outcome } = JSON.parse(r.stdout);
    expect(reached).toBe(true);
    expect(outcome).toMatch(/Error: sentinel reached/u);
    expect(outcome).not.toMatch(/startup/u);
  });
});

describe("startup admission: the fixture builders", () => {
  // Each child gets its own empty temporary directory, so anything a builder made shows there.
  function builder(flags, name, call) {
    const temp = join(scratch, `temp-${name}`);
    mkdirSync(temp);
    const r = script(
      flags,
      [
        `import * as fixtures from ${moduleUrl("build-guard", "fixture.js")};`,
        'let outcome = "returned";',
        "try {",
        `  await (${call});`,
        "} catch (error) {",
        "  outcome = `threw ${error.message}`;",
        "}",
        "const reached = globalThis.sentinel === true;",
        "console.log(JSON.stringify({ outcome, reached }));",
      ],
      { temp },
    );
    expectCleanExit(r);
    return { ...JSON.parse(r.stdout), made: readdirSync(temp) };
  }

  it(
    "refuses buildRoot in an unflagged process before creating anything",
    { timeout: 300_000 },
    () => {
      const root = join(scratch, "fixture-root");
      // Without the real config Vite would run this hook at once, so a refusal must precede Vite.
      const options =
        '{ configFile: false, plugins: [{ name: "test:sentinel", config() { globalThis.sentinel = true; } }] }';
      expect(
        builder(
          [],
          "root",
          `fixtures.buildRoot(${JSON.stringify(root)}, ${options})`,
        ),
      ).toEqual({
        outcome: `threw build guard: startup: ${missing}`,
        reached: false,
        made: [],
      });
      expect(existsSync(root)).toBe(false);
    },
  );

  it(
    "refuses buildFixture in an unflagged process before creating anything",
    { timeout: 300_000 },
    () => {
      expect(
        builder(
          [],
          "fixture",
          'fixtures.buildFixture({ "src/main.tsx": "export {};\\n" })',
        ),
      ).toEqual({
        outcome: `threw build guard: startup: ${missing}`,
        reached: false,
        made: [],
      });
    },
  );

  // Shows that the temporary directory is where a fixture would appear, so the refusals above
  // are not empty by construction.
  it(
    "admits buildFixture in a flagged process, which creates its fixture",
    { timeout: 300_000 },
    () => {
      const { outcome, made } = builder(
        [sweepingFlag],
        "admitted",
        'fixtures.buildFixture({ "src/main.tsx": "export {};\\n" })',
      );
      expect(outcome).not.toMatch(/startup/u);
      expect(made).toEqual([expect.stringMatching(/^sl-guard-/u)]);
    },
  );
});
