// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { scriptViolations, sourceUnit } from "../build-guard/classify.js";
import { sourceIdentity } from "../source-policy/unit.js";
import { applicationESLint } from "./application-eslint.js";
import {
  applicationSource,
  exactUnits,
  typedSource,
  untypedSource,
} from "./application-source.js";
import { web } from "./production-eslint.js";

const app = "sharpladder/app-capabilities";
const extension = "sharpladder/source-extension";
const exhaustive = "@typescript-eslint/switch-exhaustiveness-check";
// The production configuration exactly as the lint command and the coverage check load it.
const plain = applicationESLint();
// The json formatter prints the result list itself, so each result arrives as ESLint gave it.
const lintResult = async (code, filePath) =>
  JSON.parse((await plain.lintText(code, filePath, "json")).output)[0];
const runner = join(web, "lint-application.js");

const walkStepper = "content/WalkStepper.tsx";
const href = "content/href.ts";
const read = (unit) => readFileSync(join(web, "src", unit), "utf8");
const changed = (unit) =>
  unit === walkStepper
    ? read(unit).replace("spanText(sequence.intro)", "sequence.name")
    : `${read(unit)}export const probe = 1;\n`;

// Every disable and reconfigure form the earlier stages carried, in one file, each aimed at the
// Program node the pin is reported on.
const reason = "-- Probe.";
const comments = "@eslint-community/eslint-comments/require-description";
const forms = [
  `/* eslint-disable ${app} ${reason} */`,
  `/* eslint-disable ${app} */`,
  `/* eslint-disable ${reason} */`,
  "/* eslint-disable */",
  `/* eslint ${app}: "off" ${reason} */`,
  `/* eslint ${app}: 0 ${reason} */`,
  `/* eslint ${app}: "warn" ${reason} */`,
  `/* eslint-disable ${comments}, local/directive-single-line ${reason} */`,
  `/* eslint ${app}: "off", ${comments}: "off" */`,
  `/* eslint-env browser ${reason} */`,
  `/* global probe ${reason} */`,
];
const carried = (code) =>
  `${forms[0]} /* eslint-disable-line ${app} ${reason} */\n` +
  `${forms.slice(1).join("\n")}\n// eslint-disable-next-line ${app} ${reason}\n` +
  `${code}/* eslint-enable ${app} ${reason} */\n/* eslint-enable ${reason} */\n`;

// The build's own verdict on a name: the unit it reads, its pin finding, or its refusal.
function buildVerdict(path, code) {
  try {
    const unit = sourceUnit({ root: web }, path);
    const findings = scriptViolations(code, path, unit);
    const pin = findings.find((m) => m.startsWith(`src/${unit}: the reviewed`));
    return { unit, pin, findings };
  } catch (error) {
    return { refused: error.message };
  }
}

const pinFindings = (result) =>
  result.messages.filter(
    (m) => m.ruleId === app && m.severity === 2 && m.message.includes("pin"),
  );
const identityFinding = (result) =>
  result.messages.some(
    (m) =>
      m.ruleId === app &&
      m.severity === 2 &&
      m.message.startsWith("This file's place under src is not established"),
  );
const fatal = (result) => result.messages.some((m) => m.fatal === true);
const ignored = (result) =>
  result.messages.length === 1 &&
  result.messages[0].severity === 1 &&
  result.messages[0].ruleId === null &&
  /^File ignored because/u.test(result.messages[0].message);

const typedName = (path) => /\.tsx?$/u.test(basename(path));

// One text linted under one name, or the error ESLint threw for that name.
const lintOutcome = (eslint, path, code) =>
  eslint.lintText(code, path, "json").then(
    ({ output }) => ({ result: JSON.parse(output)[0] }),
    (error) => ({ thrown: error.message }),
  );

// The outcome the shared mapper and the build adapter require for a name and a text, checked
// against one lint outcome. Each kind is its own reason; only "clean" is a passing lint.
function expectVerdict(outcome, path, code) {
  const absolute = resolve(web, path);
  const id = sourceIdentity(web, absolute);
  const build = buildVerdict(absolute, code);
  expect(id.unit !== null || id.error !== undefined).toBe(true);
  // A throw is explained only by a name the mapper and the build both refuse.
  if (outcome.thrown !== undefined) {
    expect([id.error, build.refused]).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    return "thrown";
  }
  const { result } = outcome;
  expect(result.suppressedMessages.filter((m) => m.ruleId === app)).toEqual([]);
  if (ignored(result)) {
    expect([result.errorCount, result.warningCount]).toEqual([0, 1]);
    return /outside of base path/u.test(result.messages[0].message)
      ? "external"
      : "ignored";
  }
  if (id.unit === null) {
    expect(build.refused).toBeDefined();
    if (identityFinding(result)) return "identity";
    expect(fatal(result)).toBe(true);
    return "unparsed";
  }
  expect(build.unit).toBe(id.unit);
  if (fatal(result)) {
    expect(
      result.messages.filter((m) => m.fatal).map((m) => m.message),
    ).toEqual([expect.stringMatching(/was not found by the project service/u)]);
    return "unparsed";
  }
  const policy = result.messages
    .filter((m) => m.ruleId === app && m.severity === 2)
    .map((m) => m.message);
  expect(policy).toEqual(
    expect.arrayContaining(build.findings.map((m) => `${m}.`)),
  );
  const ids = result.messages.map((m) => m.ruleId);
  if (!typedName(absolute)) expect(ids).toContain(extension);
  if (build.pin !== undefined) {
    expect(pinFindings(result).map((m) => m.message)).toEqual([
      `${build.pin}.`,
    ]);
    return "pinned";
  }
  // Another unit under src, such as a different file on a case-sensitive disk.
  if (build.findings.length > 0) return "renderer";
  if (typedName(absolute)) {
    expect(result.messages).toEqual([]);
    return "clean";
  }
  expect(ids).toEqual([extension]);
  return "extension";
}

// A kind other than "clean" must leave a message or a throw behind.
const unsuccessful = (outcome) =>
  outcome.thrown !== undefined ||
  outcome.result.errorCount + outcome.result.warningCount > 0;

// The lint command on one text under one name, from the web folder unless told otherwise.
const command = (path, code, cwd = web, script = runner) =>
  new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [script, "--format", "json", "--stdin-filename", path],
      { cwd },
    );
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", fail);
    child.on("close", (status, signal) => {
      if (signal !== null || ![0, 1, 2].includes(status))
        fail(new Error(`the lint command gave ${String(status)}: ${err}`));
      else
        done({
          status,
          outcome:
            status === 2 ? { thrown: err } : { result: JSON.parse(out)[0] },
        });
    });
    child.stdin.end(code);
  });

describe("the application selector", () => {
  it("selects scripts under src and names the mapper cannot place", () => {
    expect(applicationSource(join(web, "src", "content", "href.ts"))).toBe(
      true,
    );
    expect(applicationSource(join(web, "src", "content", "href.TS"))).toBe(
      true,
    );
    expect(applicationSource(join(web, "src", "content", "href.ts."))).toBe(
      true,
    );
    expect(applicationSource("src/content/href.ts")).toBe(true);
    expect(applicationSource(undefined)).toBe(true);
  });

  it("leaves stylesheets under src and files outside src unselected", () => {
    expect(applicationSource(join(web, "src", "theme", "base.css"))).toBe(
      false,
    );
    expect(applicationSource(join(web, "browser", "probe.ts"))).toBe(false);
    expect(applicationSource(join(web, "eslint.config.js"))).toBe(false);
  });

  it("splits application source between the typed and untyped blocks", () => {
    for (const name of ["href.ts", "Blocks.tsx"]) {
      const path = join(web, "src", "content", name);
      expect([typedSource(path), untypedSource(path)]).toEqual([true, false]);
    }
    for (const name of ["href.TS", "Blocks.Tsx", "x.js", "x.MJS", "href.ts."]) {
      const path = join(web, "src", "content", name);
      expect([typedSource(path), untypedSource(path)]).toEqual([false, true]);
    }
  });

  it("exempts only the exact unit, never a name the mapper refuses", () => {
    const generated = exactUnits("generated/body.ts");
    expect(generated(join(web, "src", "generated", "body.ts"))).toBe(true);
    expect(generated(join(web, "src", "generated", "body.ts."))).toBe(false);
    expect(generated(join(web, "src", "generated", "content.ts"))).toBe(false);
    expect(generated("src/generated/body.ts")).toBe(false);
  });

  it("selects a name whose identity check throws, and exempts none", async () => {
    vi.resetModules();
    vi.doMock("../source-policy/unit.js", () => ({
      sourceIdentity: () => {
        throw new Error("probe");
      },
    }));
    try {
      const scope = await import("./application-source.js");
      const path = join(web, "browser", "probe.ts");
      expect(scope.applicationSource(path)).toBe(true);
      expect(scope.exactUnits("generated/body.ts")(path)).toBe(false);
    } finally {
      vi.doUnmock("../source-policy/unit.js");
      vi.resetModules();
    }
  });
});

// The production configuration through ESLint.lintText.
describe("the application policy through the factory", () => {
  // Every inline configuration form at once; none may switch off, downgrade or reconfigure the pin.
  it("refuses the changed stepper under every directive", async () => {
    const path = `src/${walkStepper}`;
    const code = carried(changed(walkStepper));
    const outcome = await lintOutcome(plain, path, code);
    expect(expectVerdict(outcome, path, code)).toBe("pinned");
    expect(unsuccessful(outcome)).toBe(true);
  });

  const missingCase = `export function probeCase(v: "a" | "b"): number {
  switch (v) {
    case "a":
      return 1;
    default:
      return 0;
  }
}
`;
  it("applies the exhaustive switch rule", async () => {
    const result = await lintResult(
      `${read(href)}${missingCase}`,
      `src/${href}`,
    );
    expect(result.messages.filter((m) => m.ruleId === exhaustive)).toHaveLength(
      1,
    );
  });

  // An editor's unsaved file under src. The project service never opens a typed one, which is a
  // parsing error.
  it("refuses an unsaved typed file under src as unparsed", async () => {
    const result = await lintResult('globalThis.eval("1");\n', "src/Absent.ts");
    expect(sourceIdentity(web, join(web, "src", "Absent.ts")).unit).toBe(
      "Absent.ts",
    );
    expect(result.messages.map((m) => [m.fatal, m.message])).toEqual([
      [true, expect.stringMatching(/was not found by the project service/u)],
    ]);
  });

  it("keeps a directive outside application source in effect", async () => {
    const path = "content-check/registry.ts";
    const result = await lintResult(
      readFileSync(join(web, path), "utf8"),
      path,
    );
    expect(result.messages).toEqual([]);
    expect(result.suppressedMessages.map((m) => m.ruleId)).toEqual([
      "no-control-regex",
    ]);
  });
}, 60_000);

// The production lint command on standard input. ESLint reports a name outside its base path as
// a warning only, so the command must fail on that warning.
describe("the application policy through the command line", () => {
  it("refuses the stepper as a trailing dot on the project folder", async () => {
    const path = `${web}./src/${walkStepper}`;
    const code = carried(read(walkStepper));
    const { status, outcome } = await command(path, code);
    expect(expectVerdict(outcome, path, code)).toBe("external");
    expect(status).toBe(1);
  });
}, 60_000);

// Fixed outcomes, written out rather than derived from the mapper and the build, so a fault the
// two share cannot pass: each row names the mapper's unit or refusal, the build's findings or
// refusal, and every error ESLint gives through the factory and through the lint command.
describe("the application policy against fixed outcomes", () => {
  const step = read(walkStepper);
  const pinStep =
    "src/content/WalkStepper.tsx: the reviewed module source changed; update its pin only " +
    "after a review of the whole module, its dependencies and its behaviour tests";
  const walk = [
    "isValidPosition from ./walk-position.ts",
    "move from ./walk-position.ts",
    "replay from ./walk-replay.ts",
  ].map(
    (value) => `walk helper value ${value} is admitted only in a listed test`,
  );
  const held = (segment) =>
    `its path holds "${segment}", which is not a source name`;
  const rule = (message) => `${app}: ${message}.`;
  const ext = `${extension}: application source must be .ts or .tsx.`;
  const unplaced = (segment) =>
    rule(`This file's place under src is not established: ${held(segment)}`);
  const globalRead =
    `${app}: globalThis is not allowed in application source, in any form; the only ` +
    'document use is document.getElementById("root").';
  const refusal = (segment) => ({ refusal: held(segment) });
  // [how, name, text, mapper, build findings or refusal, errors, fatal messages]
  const rows = [
    [
      "an allowed production source",
      "src/App.tsx",
      read("App.tsx"),
      { unit: "App.tsx" },
      [],
      [],
      [],
    ],
    [
      "the changed stepper",
      `src/${walkStepper}`,
      changed(walkStepper),
      { unit: walkStepper },
      [pinStep],
      [rule(pinStep)],
      [],
    ],
    [
      "a trailing dot on the file",
      "src/content/WalkStepper.tsx.",
      step,
      { unit: null, error: held("WalkStepper.tsx.") },
      refusal("WalkStepper.tsx."),
      [unplaced("WalkStepper.tsx."), ...walk.map(rule), ext],
      [],
    ],
    [
      "a globalThis read",
      "src/Absent.JS",
      'globalThis.eval("1");\n',
      { unit: "Absent.JS" },
      ["reference to globalThis"],
      [globalRead, ext, "no-eval: `eval` can be harmful."],
      [],
    ],
  ];
  const shown = (result) => [
    result.messages
      .filter((m) => m.severity === 2 && m.fatal !== true)
      .map((m) => `${m.ruleId}: ${m.message}`)
      .sort(),
    result.messages.filter((m) => m.fatal === true).map((m) => m.message),
    result.warningCount,
    result.suppressedMessages.length,
  ];
  it.each(rows)(
    "gives %s its fixed outcome",
    async (_how, path, code, mapper, build, errors, fatal) => {
      const absolute = resolve(web, path);
      expect(sourceIdentity(web, absolute)).toEqual(mapper);
      const verdict = buildVerdict(absolute, code);
      if (Array.isArray(build))
        expect([verdict.unit, [...verdict.findings].sort()]).toEqual([
          mapper.unit,
          [...build].sort(),
        ]);
      else
        expect(verdict).toEqual({
          refused: `build guard: ${absolute}: ${build.refusal}`,
        });
      const expected = [[...errors].sort(), fatal, 0, 0];
      const result = await lintResult(code, path);
      expect(shown(result)).toEqual(expected);
      const { status, outcome } = await command(path, code);
      expect([status, shown(outcome.result)]).toEqual([
        errors.length + fatal.length > 0 ? 1 : 0,
        expected,
      ]);
    },
  );
}, 120_000);

// ESLint reads a name that is no file or folder as a glob pattern and lints what it matches; the
// lint command takes only names that exist, so a pattern is refused before anything is linted.
describe("the names the lint command takes", () => {
  const run = (...names) =>
    spawnSync(process.execPath, [runner, "--format", "json", ...names], {
      cwd: web,
      encoding: "utf8",
    });
  it.each(["src/content/*.ts"])("refuses %s before linting", (name) => {
    const { status, stdout, stderr } = run(name);
    expect([status, stdout, stderr.trim()]).toEqual([
      2,
      "",
      `${name} is not an existing file or folder`,
    ]);
  });

  it("lints an existing name as that one file", () => {
    const { status, stdout } = run(`src/${href}`);
    expect([
      status,
      JSON.parse(stdout).map((r) => relative(web, r.filePath)),
    ]).toEqual([0, [join("src", "content", "href.ts")]]);
  });
}, 60_000);
