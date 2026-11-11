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
  evidenceProblems,
  roundTripCases,
  roundTripFile,
  roundTripSuite,
  runnerEnv,
} from "./acceptance.ts";
import { recordInventory } from "./inventory.ts";

const web = join(import.meta.dirname, "..");
const expected = recordInventory(join(web, "compiled"));
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

const cases = (paths: readonly string[] = expected): Case[] =>
  paths.flatMap((path) =>
    roundTripCases.map((title) => ({
      ancestorTitles: [roundTripSuite + path],
      title,
      status: "passed",
    })),
  );

const report = (
  assertionResults: unknown,
  name = join(web, roundTripFile),
) => ({
  success: true,
  testResults: [
    { name: join(web, "src", "App.test.tsx"), assertionResults: [] },
    { name, assertionResults },
  ],
});

const judged = (value: unknown, paths: readonly string[] = expected) =>
  evidenceProblems(value, web, paths);

const first = expected[0] ?? "";
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
    expect(evidenceProblems(named(one), one, expected)).toEqual([]);
    expect(evidenceProblems(named(other), one, expected)).toEqual([
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

  it("refuses an empty expected set whatever the report holds", () => {
    expect(judged(report(cases()), [])).toEqual([
      "the compiled inventory is empty",
    ]);
  });
});

describe("the record-backed case list", () => {
  it("is exactly the cases the round-trip file declares for each record", () => {
    const text = readFileSync(join(web, roundTripFile), "utf8");
    const file = ts.createSourceFile(
      "round-trip.test.tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
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
        name.text === `${roundTripSuite}%s` &&
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
    expect(suites).toEqual([[...roundTripCases]]);
  });
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
    const { exit, lines } = run([roundTripFile, "-t", "strict binding"]);
    expect(exit).toBe(1);
    expect(lines).toContain(`round trip evidence: ${gap("skipped")}`);
  });

  it("fails when the round-trip file is not part of the run", () => {
    const { exit, lines } = run(["src/App.test.tsx"]);
    expect(exit).toBe(1);
    expect(lines).toEqual([
      `round trip evidence: ${roundTripFile} has 0 results in the Vitest report`,
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
      () => run([roundTripFile]),
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
      run([roundTripFile, "--config", config]),
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
