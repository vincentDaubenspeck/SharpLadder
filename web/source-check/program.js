import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import ts from "typescript";
import { inside, shown } from "./paths.js";

/**
 * The TypeScript programs under web, each pinned to an exact include, types list, first-party
 * root, first-party source extensions and set of named config inputs by path under web. The
 * browser tests keep their own program so Playwright and Node declarations never enter the app
 * program and app files never enter the browser one. Declarations are named and kept to external
 * boundaries, because a declaration describes a module the type-aware lint never reads. The Vite
 * config needs Node, so it is checked with the browser tooling and never in the app program.
 */
const nodeTypePackages = ["@types/node", "undici-types"];

export const programs = [
  {
    tsconfig: "tsconfig.json",
    include: ["src"],
    types: ["vite/client"],
    root: "src",
    extensions: [".ts", ".tsx"],
    // The round trip declares the records the Vitest global setup provides.
    config: ["src/content/provided.d.ts"],
    forbiddenPackages: nodeTypePackages,
    // Every generated module is checked by the app program, never only by a test-only one.
    members: ["src/generated"],
    parser: { projectService: true },
  },
  {
    tsconfig: "tsconfig.browser.json",
    include: [
      "playwright.config.ts",
      "vite.config.ts",
      "browser",
      "content-check",
    ],
    types: ["node"],
    root: "browser",
    roots: ["content-check"],
    // The browser program has no JSX setting, so a .tsx file there is refused, never half-checked.
    extensions: [".ts"],
    config: [
      "playwright.config.ts",
      "vite.config.ts",
      "build-guard/index.d.ts",
      "stylelint/registry.d.ts",
    ],
    globalAugmentations: [],
    // Node tooling only drives built pages, so app, generated, renderer and harness code stay out.
    excluded: ["src", "harness"],
    parser: { projectService: false, project: "./tsconfig.browser.json" },
  },
  {
    tsconfig: "tsconfig.type-tests.json",
    include: ["type-tests"],
    types: ["vite/client"],
    root: "type-tests",
    extensions: [".ts"],
    config: [],
    admitted: ["src/generated/body.ts", "src/generated/content.ts"],
    forbiddenPackages: nodeTypePackages,
    equivalentTo: "tsconfig.json",
    parser: { projectService: false, project: "./tsconfig.type-tests.json" },
  },
  {
    tsconfig: "tsconfig.harness.json",
    include: ["harness/content/main.tsx"],
    types: ["vite/client"],
    root: "harness",
    extensions: [".ts", ".tsx"],
    config: [],
    rootFiles: ["harness/content/main.tsx"],
    // The harness validates each hints view against the closed schema the unit tests use.
    admitted: [
      "src/content",
      "src/generated",
      "src/content-tests/hints-view.ts",
    ],
    forbiddenPackages: nodeTypePackages,
    equivalentTo: "tsconfig.json",
    parser: { projectService: false, project: "./tsconfig.harness.json" },
  },
];

const absentOptions = [
  "paths",
  "baseUrl",
  "rootDir",
  "rootDirs",
  "typeRoots",
  "allowJs",
];

const configName = /^(?:js|ts)config.*\.json$/iu;

/**
 * Walks web one folder at a time, skipping only installed packages, because any config beyond
 * the pinned ones could start a program no check describes. A linked folder is refused: walking
 * it could leave web, and skipping it could hide a config.
 */
function tsconfigSetProblems(web, specs, readdir) {
  const expected = new Set(specs.map((s) => s.tsconfig));
  const found = new Set();
  const problems = [];
  const pending = [""];
  while (pending.length > 0) {
    const dir = pending.shift();
    let entries;
    try {
      entries = readdir(join(web, dir), { withFileTypes: true });
    } catch (error) {
      problems.push(
        `${dir || "."}: cannot list for TypeScript configs: ${error.code ?? error.message}`,
      );
      continue;
    }
    for (const entry of entries) {
      const at = dir ? `${dir}/${entry.name}` : entry.name;
      if (configName.test(entry.name)) found.add(at);
      else if (entry.isSymbolicLink())
        problems.push(`${at}: a link is not walked for TypeScript configs`);
      else if (entry.isDirectory() && entry.name !== "node_modules")
        pending.push(at);
    }
  }
  for (const at of [...found].sort())
    if (!expected.has(at)) problems.push(`${at}: unknown TypeScript config`);
  for (const name of expected)
    if (!found.has(name)) problems.push(`${name}: missing`);
  return problems;
}

/** Pins the config shape, so no alias, extension or reference can widen the program. */
export function tsconfigShapeProblems(tsconfig, spec = programs[0]) {
  const label = basename(tsconfig);
  const { config, error } = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (error)
    return [
      `${label}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
    ];
  const problems = [];
  const keys = Object.keys(config).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["compilerOptions", "include"]))
    problems.push(
      `${label} top-level keys are ${keys.join(", ")}; only compilerOptions and include are allowed`,
    );
  if (JSON.stringify(config.include) !== JSON.stringify(spec.include))
    problems.push(`${label} include must be ${JSON.stringify(spec.include)}`);
  const options = config.compilerOptions ?? {};
  if (JSON.stringify(options.types) !== JSON.stringify(spec.types))
    problems.push(`${label} types must be ${JSON.stringify(spec.types)}`);
  for (const name of absentOptions) {
    if (Object.hasOwn(options, name))
      problems.push(`${label} must not set ${name}`);
  }
  return problems;
}

function parse(tsconfig) {
  const label = basename(tsconfig);
  const fatal = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => fatal.push(d),
    },
  );
  const errors = [...fatal, ...(parsed?.errors ?? [])].map(
    (d) => `${label}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
  );
  return { parsed, errors, label };
}

const declaration = /\.d\.[cm]?ts$/u;
const firstPartySource = /\.tsx?$/u;

const sourceOf = (spec, path) =>
  (spec.extensions ?? [".ts"]).some((suffix) => path.endsWith(suffix));

/** Package folders resolve before the trusted root, so one inside the root would shadow it. */
const inPackageFolder = (root, path) =>
  shown(root, path)
    .split("/")
    .some((segment) => segment.toLowerCase() === "node_modules");

/**
 * Canonical web/node_modules, or undefined when absent or a link: npm ci fills only a real
 * folder there, so a redirected root is not the trusted one.
 */
function trustedDependencyRoot(webReal) {
  const expected = join(webReal, "node_modules");
  try {
    const real = realpathSync.native(expected);
    return real === expected ? real : undefined;
  } catch {
    return undefined;
  }
}

const foldCase =
  process.platform === "win32" ? (s) => s.toLowerCase() : (s) => s;

function packageName(dir, readFile) {
  let text;
  try {
    text = readFile(join(dir, "package.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { missing: true };
    return { error: error.code ?? error.message };
  }
  try {
    const { name } = JSON.parse(text);
    return { name: typeof name === "string" ? name : undefined };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Why a canonical path lies inside a forbidden package, or undefined. Each enclosing folder is
 * matched by its path components and by the name in its own package.json, so neither a nested
 * copy nor a differently named alias folder of the package passes.
 */
function forbiddenPackageReason(
  real,
  forbidden,
  { readFile = readFileSync, names = new Map() } = {},
) {
  const wanted = new Set(forbidden.map(foldCase));
  for (let dir = dirname(real); ; dir = dirname(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    const own = foldCase(basename(dir));
    const up = foldCase(basename(parent));
    const scoped = up.startsWith("@");
    const outer = foldCase(basename(dirname(parent)));
    const packageRoot =
      (up === "node_modules" && !own.startsWith("@")) ||
      (scoped && outer === "node_modules");
    const path = up === "node_modules" ? own : scoped ? `${up}/${own}` : "";
    if (packageRoot && wanted.has(path)) return `installed at ${path}`;
    if (!names.has(dir)) names.set(dir, packageName(dir, readFile));
    const found = names.get(dir);
    if (found.error)
      return `package.json in ${basename(dir)} is unreadable: ${found.error}`;
    if (packageRoot && found.missing)
      return `package root ${path} has no package.json`;
    if (found.name !== undefined && wanted.has(foldCase(found.name)))
      return `inside a package named ${found.name}`;
  }
}

/** Global declarations the named files may make; every other first-party global is refused. */
function globalAugmentationProblems(file, at) {
  if (!ts.isExternalModule(file))
    return [`${at}: a script file declares globals`];
  const problems = [];
  const visit = (statements) => {
    for (const node of statements) {
      if (!ts.isModuleDeclaration(node)) continue;
      if (ts.isGlobalScopeAugmentation(node))
        problems.push(`${at}: declare global is not admitted here`);
      else if (node.body && ts.isModuleBlock(node.body))
        visit(node.body.statements);
    }
  };
  visit(file.statements);
  return problems;
}

/**
 * Every program input must be a first-party source under the program's root, a named config
 * input, a TypeScript lib or a declaration inside the trusted dependency root. That root is
 * filled only by npm ci from the integrity-hashed lockfile, so a file planted inside it is
 * tooling compromise, out of scope here. A program with forbidden packages must not contain any
 * file of an installed copy of them, whatever route the compiler took to reach it.
 */
export function programInputs(
  web,
  spec = programs[0],
  { realpath = realpathSync.native, readFile = readFileSync } = {},
) {
  const { parsed, errors, label } = parse(join(web, spec.tsconfig));
  if (!parsed) return { problems: errors, inputs: [] };
  const problems = [...errors];
  if (parsed.projectReferences)
    problems.push(`${label} must not have project references`);
  if (parsed.options.paths || parsed.options.baseUrl)
    problems.push(`${label} must not define path aliases`);

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
  const webReal = realpathSync.native(web);
  const existing = (paths) =>
    paths.flatMap((p) => {
      try {
        return [realpathSync.native(join(webReal, p))];
      } catch {
        return [];
      }
    });
  const roots = existing([spec.root]);
  if (roots.length === 0)
    problems.push(`${spec.root}: first-party root is missing`);
  for (const group of spec.roots ?? []) {
    const found = existing([group]);
    if (found.length === 0)
      problems.push(`${group}: first-party root group is missing`);
    roots.push(...found);
  }
  const admitted = existing(spec.admitted ?? []);
  const excluded = existing(spec.excluded ?? []);
  if (spec.rootFiles) {
    const want = existing(spec.rootFiles).sort();
    const got = parsed.fileNames.map((f) => realpathSync.native(f)).sort();
    if (
      want.length !== spec.rootFiles.length ||
      JSON.stringify(got) !== JSON.stringify(want)
    )
      problems.push(
        `${label} root files must be exactly ${spec.rootFiles.join(", ")}`,
      );
  }
  const named = new Set(spec.config.map((p) => join(webReal, p)));
  const libDir = realpathSync.native(
    dirname(ts.getDefaultLibFilePath(parsed.options)),
  );
  const dependencies = trustedDependencyRoot(webReal);
  const forbidden = spec.forbiddenPackages ?? [];
  if (forbidden.length > 0 && !dependencies)
    problems.push(
      `${label}: the trusted dependency root is unavailable, so forbidden packages cannot be excluded`,
    );
  const names = new Map();
  const allowedGlobals = spec.globalAugmentations
    ? new Set(spec.globalAugmentations.map((p) => join(webReal, p)))
    : undefined;

  const inputs = [];
  for (const file of program.getSourceFiles()) {
    let real;
    try {
      real = realpath(file.fileName);
    } catch {
      problems.push(`program input ${file.fileName} has no real path`);
      continue;
    }
    const at = inside(webReal, real)
      ? shown(webReal, real)
      : real.split(sep).join("/");
    if (forbidden.length > 0) {
      const reason = forbiddenPackageReason(real, forbidden, {
        readFile,
        names,
      });
      if (reason) {
        problems.push(`${label} must not contain ${at}: ${reason}`);
        inputs.push({ path: real, kind: undefined });
        continue;
      }
    }
    if (excluded.some((dir) => inside(dir, real))) {
      problems.push(`${label} must not reach ${at}`);
      inputs.push({ path: real, kind: undefined });
      continue;
    }
    const source = sourceOf(spec, real) && !declaration.test(real);
    let kind;
    if (
      source &&
      roots.some((root) => inside(root, real) && !inPackageFolder(root, real))
    )
      kind = "first-party";
    else if (
      source &&
      admitted.some(
        (p) => p === real || (inside(p, real) && !inPackageFolder(p, real)),
      )
    )
      kind = "admitted";
    else if (named.has(real)) kind = "config";
    else if (
      dirname(real) === libDir &&
      /^lib(\..+)?\.d\.ts$/u.test(basename(real))
    )
      kind = "lib";
    else if (
      dependencies &&
      inside(dependencies, real) &&
      declaration.test(real)
    )
      kind = "package";
    inputs.push({ path: real, kind });
    if (
      allowedGlobals &&
      (kind === "first-party" || kind === "config") &&
      !allowedGlobals.has(real)
    )
      problems.push(...globalAugmentationProblems(file, at));
    if (!kind) {
      problems.push(
        inside(webReal, real) && inPackageFolder(webReal, real)
          ? `program input in a package folder outside the trusted dependency root: ${at}`
          : `program input outside the admitted set: ${at}`,
      );
    }
  }
  return { problems, inputs };
}

/** Every file under each member folder must be a first-party input of the program. */
function memberProblems(web, spec, inputs, readdir) {
  const label = spec.tsconfig;
  const own = new Set(
    inputs.filter((i) => i.kind === "first-party").map((i) => i.path),
  );
  const problems = [];
  for (const folder of spec.members ?? []) {
    const pending = [folder];
    while (pending.length > 0) {
      const dir = pending.shift();
      let entries;
      try {
        entries = readdir(join(web, dir), { withFileTypes: true });
      } catch (error) {
        problems.push(
          `${dir}: cannot list for ${label} members: ${error.code ?? error.message}`,
        );
        continue;
      }
      for (const entry of entries) {
        const at = `${dir}/${entry.name}`;
        if (entry.isDirectory()) pending.push(at);
        else if (!own.has(realpathSync.native(join(web, at))))
          problems.push(`${at}: not in the ${label} program`);
      }
    }
  }
  return problems;
}

/** The option set the compiler computes, so a config that only looks alike is told apart. */
function resolvedOptions(tsconfig) {
  const { parsed, errors } = parse(tsconfig);
  if (!parsed) return { errors };
  const options = { ...parsed.options };
  delete options.configFilePath;
  const sorted = (value) =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, sorted(value[k])]),
          )
        : value;
  return { errors, text: JSON.stringify(sorted(options)) };
}

/** A test-only program must check exactly as the app program does, or it proves nothing. */
export function equivalenceProblems(web, spec, specs = programs) {
  if (!spec.equivalentTo) return [];
  const base = specs.find((s) => s.tsconfig === spec.equivalentTo);
  if (!base) return [`${spec.tsconfig}: no ${spec.equivalentTo} program`];
  const want = resolvedOptions(join(web, base.tsconfig));
  const got = resolvedOptions(join(web, spec.tsconfig));
  if (want.text === undefined || got.text === undefined)
    return [...want.errors, ...got.errors];
  if (want.text === got.text) return [];
  const a = JSON.parse(want.text);
  const b = JSON.parse(got.text);
  const differing = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
  return [
    `${spec.tsconfig} resolved options differ from ${base.tsconfig}: ${differing.join(", ")}`,
  ];
}

/**
 * Runs the config set, shape and input checks for every pinned program, and returns each
 * program's own sources with the parser options their lint must use, and every input path.
 */
export function programProblems(
  web,
  specs = programs,
  { readdir = readdirSync } = {},
) {
  const problems = tsconfigSetProblems(web, specs, readdir);
  for (const spec of specs) {
    // The set check already reports a missing config; parsing it would only repeat that.
    if (existsSync(join(web, spec.tsconfig)))
      problems.push(...tsconfigShapeProblems(join(web, spec.tsconfig), spec));
  }
  // An unpinned or reshaped config is never handed to the compiler.
  if (problems.length > 0) return { problems, linted: [] };
  const linted = [];
  for (const spec of specs) {
    const { problems: found, inputs } = programInputs(web, spec);
    problems.push(
      ...found,
      ...memberProblems(web, spec, inputs, readdir),
      ...equivalenceProblems(web, spec, specs),
    );
    const files = inputs
      .filter(
        (i) =>
          (i.kind === "first-party" || i.kind === "config") &&
          firstPartySource.test(i.path) &&
          !declaration.test(i.path),
      )
      .map((i) => i.path);
    linted.push({
      tsconfig: spec.tsconfig,
      files,
      parser: spec.parser,
      inputs: new Set(inputs.map((i) => i.path)),
    });
  }
  return { problems, linted };
}
