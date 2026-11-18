// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, fixture, link } from "../build-guard/fixture.js";

afterAll(cleanUp);

const web = join(import.meta.dirname, "..");
const shared = realpathSync.native(join(web, "node_modules", "eslint"));
const version = JSON.parse(
  readFileSync(join(shared, "package.json"), "utf8"),
).version;
const sources = (dir, at = "") =>
  readdirSync(join(web, dir, at), { withFileTypes: true }).flatMap((entry) => {
    const path = at === "" ? entry.name : `${at}/${entry.name}`;
    if (entry.isDirectory()) return sources(dir, path);
    return entry.name.includes(".test.")
      ? []
      : [[`${dir}/${path}`, readFileSync(join(web, dir, path))]];
  });
// The lint policy and all it loads, so the copy's own factory binds the copy's web root.
const policy = Object.fromEntries([
  ...[
    "eslint.config.js",
    "eslint.comments.config.js",
    "lint-application.js",
    "package.json",
  ].map((p) => [p, readFileSync(join(web, p))]),
  [
    "../tools/forbidden-phrases.txt",
    readFileSync(join(web, "..", "tools", "forbidden-phrases.txt")),
  ],
  ...["eslint-rules", "source-check", "source-policy", "stylelint"].flatMap(
    (dir) => sources(dir),
  ),
]);

// Loaded with --import before the entry, so every resolution of the run is recorded, ESLint's
// own formatter import included, and written beside the hook when the process ends.
const observer = `import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const seen = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    seen.push({ specifier, parent: context.parentURL ?? null, url: result.url });
    return result;
  },
});
process.on("exit", () => {
  writeFileSync(new URL("observed.json", import.meta.url), JSON.stringify(seen));
});
`;
// Runs facade operations given as data and reports each outcome as data.
const runner = `import { applicationESLint } from "./eslint-rules/application-eslint.js";

const eslint = applicationESLint();
const outcomes = [];
for (const [operation, ...args] of JSON.parse(process.argv[2])) {
  try {
    const { errorCount, warningCount, fatalErrorCount, output } =
      await eslint[operation](...args);
    outcomes.push({ errorCount, warningCount, fatalErrorCount, output });
  } catch (error) {
    outcomes.push({ thrown: error.message });
  }
}
console.log(JSON.stringify(outcomes));
`;
// Planted code, always placed beside the copy's web root, announces that it ran by leaving a
// marker file in the copy's base folder.
const marking = (name, rest) => {
  const up = "../".repeat(name.split("/").length - 2);
  const marker = `${up}ran-${name.split("/").slice(1).join("-")}`;
  return `import { writeFileSync } from "node:fs";
writeFileSync(new URL(${JSON.stringify(marker)}, import.meta.url), "ran");
${rest}`;
};
const planted = (at) => {
  const files = {
    [`${at}/package.json`]: JSON.stringify({
      name: at.split("/").at(-1),
      version,
      type: "module",
      exports: { ".": "./lib/api.js" },
      main: "./lib/api.js",
    }),
  };
  for (const [path, rest] of [
    ["lib/api.js", "export class ESLint {}\n"],
    ["lib/cli-engine/formatters/json.js", "export default () => 'planted';\n"],
    ["lib/cli-engine/formatters/stylish.js", "export default () => '';\n"],
  ])
    files[`${at}/${path}`] = marking(`${at}/${path}`, rest);
  return files;
};
const formatterPackage = (name) => ({
  [`../node_modules/eslint-formatter-${name}/package.json`]: JSON.stringify({
    name: `eslint-formatter-${name}`,
    version,
    type: "module",
    main: "./index.js",
  }),
  [`../node_modules/eslint-formatter-${name}/index.js`]: marking(
    `../node_modules/eslint-formatter-${name}/index.js`,
    "export default () => 'planted';\n",
  ),
});
// A test-owned eslint package nearer the factory than the shared dependencies, so the shared
// node_modules link is never written through.
const ownPackage = (exportsMain, main) => ({
  "eslint-rules/node_modules/eslint/package.json": JSON.stringify({
    name: "eslint",
    version,
    type: "module",
    exports: { ".": exportsMain },
  }),
  [`eslint-rules/node_modules/eslint/${main}`]: `export { ESLint } from ${JSON.stringify(
    pathToFileURL(join(shared, "lib", "api.js")).href,
  )};\n`,
});

function copied(extra = {}, prepare = () => {}) {
  const made = fixture(
    {
      ...policy,
      ...extra,
      "facade-run.mjs": runner,
      "../observe.mjs": observer,
    },
    { tokens: false, helpers: false },
  );
  prepare(made);
  return made;
}

function observed({ base, root }, operations) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(base, "observe.mjs")).href,
      join(root, "facade-run.mjs"),
      JSON.stringify(operations),
    ],
    { cwd: root, encoding: "utf8", env, timeout: 120_000 },
  );
  expect([run.status, run.stderr]).toEqual([0, ""]);
  return {
    outcomes: JSON.parse(run.stdout),
    seen: JSON.parse(readFileSync(join(base, "observed.json"), "utf8")),
  };
}

const ran = (base) => readdirSync(base).filter((n) => n.startsWith("ran-"));
const formatterLoads = (seen) =>
  seen.filter((r) =>
    /\/cli-engine\/formatters\/|eslint-formatter-/u.test(r.url),
  );
const builtIn = (root, name) =>
  pathToFileURL(join(root, "lib", "cli-engine", "formatters", `${name}.js`))
    .href;
const ignoredText = ["lintText", "export {};\n", "dist/x.js"];

let plantedRun;
const withPlants = () => {
  if (plantedRun) return plantedRun;
  const made = copied({
    ...planted("../node_modules/eslint"),
    ...planted("../sibling/node_modules/eslint"),
    ...formatterPackage("json"),
    ...formatterPackage("stylish"),
  });
  plantedRun = {
    ...made,
    ...observed(made, [
      [...ignoredText, "json"],
      [...ignoredText, "stylish"],
      ["lintFiles", ["package.json"], "json"],
    ]),
  };
  return plantedRun;
};

// Each copy loads the production configuration cold in its own child.

describe("the formatter root", () => {
  it("runs both built-in formatters, loaded by absolute path under the imported root", () => {
    const { outcomes, seen } = withPlants();
    const [json, stylish, files] = outcomes;
    expect(JSON.parse(json.output)[0].messages[0].message).toMatch(
      /^File ignored because/u,
    );
    expect(stylish.output).toContain("1 problem (0 errors, 1 warning)");
    expect(JSON.parse(files.output)[0].filePath).toMatch(/package\.json$/u);
    // The counts are summed in the facade from the same results the formatter printed.
    expect(
      [json, files].map((o) => [
        o.errorCount,
        o.warningCount,
        o.fatalErrorCount,
      ]),
    ).toEqual(
      [json, files].map((o) => {
        const [result] = JSON.parse(o.output);
        return [result.errorCount, result.warningCount, result.fatalErrorCount];
      }),
    );
    const loads = formatterLoads(seen);
    expect(new Set(loads.map((r) => r.url))).toEqual(
      new Set([builtIn(shared, "json"), builtIn(shared, "stylish")]),
    );
    // ESLint imports exactly the path it was given, so the specifier is the absolute URL.
    for (const load of loads) expect(load.specifier).toBe(load.url);
  });

  it("refuses a resolved main without the pinned suffix before any formatter loads", () => {
    const made = copied(ownPackage("./lib/main.js", "lib/main.js"));
    const { outcomes, seen } = observed(made, [[...ignoredText, "json"]]);
    expect(outcomes).toEqual([
      { thrown: "format: the eslint main does not end in lib/api.js" },
    ]);
    // The fixture is valid: the factory imported the doctored package's main.
    const own = join(made.root, "eslint-rules", "node_modules", "eslint");
    expect(
      seen.some(
        (r) =>
          r.specifier === "eslint" &&
          r.url === pathToFileURL(join(own, "lib", "main.js")).href,
      ),
    ).toBe(true);
    expect(formatterLoads(seen)).toEqual([]);
  });

  it("refuses a formatter that escapes the root through a link", () => {
    const made = copied(
      {
        ...ownPackage("./lib/api.js", "lib/api.js"),
        "../escape/json.js": marking(
          "../escape/json.js",
          "export default () => 'escaped';\n",
        ),
      },
      ({ base, root }) =>
        link(
          join(base, "escape"),
          join(
            root,
            "eslint-rules",
            "node_modules",
            "eslint",
            "lib",
            "cli-engine",
            "formatters",
          ),
        ),
    );
    const { outcomes, seen } = observed(made, [[...ignoredText, "json"]]);
    expect(outcomes).toEqual([
      { thrown: "format: json is not a built-in formatter file" },
    ]);
    const own = join(made.root, "eslint-rules", "node_modules", "eslint");
    expect(
      seen.some(
        (r) =>
          r.specifier === "eslint" &&
          r.url === pathToFileURL(join(own, "lib", "api.js")).href,
      ),
    ).toBe(true);
    expect(formatterLoads(seen)).toEqual([]);
    expect(existsSync(join(made.base, "escape", "json.js"))).toBe(true);
    expect(ran(made.base)).toEqual([]);
  });
}, 120_000);

// A defensive-path test, not a supported-input regression: no supported input gives an empty
// result list, so a test-owned eslint, valid through formatting, gives one.
describe("the empty result refusal", () => {
  const emptyPackage = {
    "eslint-rules/node_modules/eslint/package.json": JSON.stringify({
      name: "eslint",
      version,
      type: "module",
      exports: { ".": "./lib/api.js" },
    }),
    "eslint-rules/node_modules/eslint/lib/api.js": `import { ESLint as Engine } from ${JSON.stringify(
      pathToFileURL(join(shared, "lib", "api.js")).href,
    )};

export class ESLint extends Engine {
  async lintText() {
    return [];
  }
  async lintFiles() {
    return [];
  }
}
`,
    "eslint-rules/node_modules/eslint/lib/cli-engine/formatters/json.js":
      marking(
        "../web/eslint-rules/node_modules/eslint/lib/cli-engine/formatters/json.js",
        "export default (results) => JSON.stringify(results);\n",
      ),
    "eslint-rules/node_modules/eslint/lib/cli-engine/formatters/stylish.js":
      marking(
        "../web/eslint-rules/node_modules/eslint/lib/cli-engine/formatters/stylish.js",
        "export default () => '';\n",
      ),
    // Formats an empty list through the same package, the path the refusal stands in front of.
    "eslint-rules/empty-format.mjs": `import { ESLint } from "eslint";

const engine = new ESLint({ cwd: process.argv[2] });
const results = await engine.lintText("export {};\\n");
const formatter = await engine.loadFormatter(process.argv[3]);
console.log(JSON.stringify({ results, output: await formatter.format(results) }));
`,
    "src/Empty.tsx": "export {};\n",
  };
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const cli = ({ base, root }, args, input) => {
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(join(base, "observe.mjs")).href,
        join(root, "lint-application.js"),
        ...args,
      ],
      { cwd: root, encoding: "utf8", env, input, timeout: 120_000 },
    );
    const seen = JSON.parse(readFileSync(join(base, "observed.json"), "utf8"));
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, seen };
  };

  it.each([["lintFiles", (file) => [[file], undefined]]])(
    "refuses it through %s before any formatter runs, with exit 2",
    (_, given) => {
      const made = copied(emptyPackage);
      const file = join(made.root, "src", "Empty.tsx");
      const own = join(made.root, "eslint-rules", "node_modules", "eslint");
      const run = cli(made, ...given(file));
      expect([run.status, run.stdout, run.stderr]).toEqual([
        2,
        "",
        `no lint results for ${file}\n`,
      ]);
      expect(
        run.seen.some(
          (r) =>
            r.specifier === "eslint" &&
            r.url === pathToFileURL(join(own, "lib", "api.js")).href,
        ),
      ).toBe(true);
      expect(formatterLoads(run.seen)).toEqual([]);
      expect(ran(made.base)).toEqual([]);
      const formatters = join(realpathSync.native(own), "lib", "cli-engine");
      const direct = spawnSync(
        process.execPath,
        [
          join(made.root, "eslint-rules", "empty-format.mjs"),
          made.root,
          join(formatters, "formatters", "json.js"),
        ],
        { cwd: made.root, encoding: "utf8", env, timeout: 120_000 },
      );
      expect([direct.status, direct.stderr]).toEqual([0, ""]);
      expect(JSON.parse(direct.stdout)).toEqual({ results: [], output: "[]" });
      expect(ran(made.base)).toEqual([
        "ran-web-eslint-rules-node_modules-eslint-lib-cli-engine-formatters-json.js",
      ]);
    },
  );
}, 120_000);
