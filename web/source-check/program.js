import { realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import ts from "typescript";
import { inside, shown } from "./paths.js";

/**
 * Config-side inputs, by path under web. vite.config.ts is named in the
 * tsconfig include; the guard plugin's declaration is reached from its import.
 */
const configInputs = ["vite.config.ts", "build-guard/index.d.ts"];

const pinnedInclude = ["src", "vite.config.ts"];
const pinnedTypes = ["vite/client"];
const absentOptions = [
  "paths",
  "baseUrl",
  "rootDir",
  "rootDirs",
  "typeRoots",
  "allowJs",
];

/** Pins the tsconfig shape, so no alias, extension or reference can widen the program. */
export function tsconfigShapeProblems(tsconfig) {
  const { config, error } = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (error)
    return [
      `tsconfig.json: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
    ];
  const problems = [];
  const keys = Object.keys(config).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["compilerOptions", "include"]))
    problems.push(
      `tsconfig.json top-level keys are ${keys.join(", ")}; only compilerOptions and include are allowed`,
    );
  if (JSON.stringify(config.include) !== JSON.stringify(pinnedInclude))
    problems.push(
      `tsconfig.json include must be ${JSON.stringify(pinnedInclude)}`,
    );
  const options = config.compilerOptions ?? {};
  if (JSON.stringify(options.types) !== JSON.stringify(pinnedTypes))
    problems.push(`tsconfig.json types must be ${JSON.stringify(pinnedTypes)}`);
  for (const name of absentOptions) {
    if (Object.hasOwn(options, name))
      problems.push(`tsconfig.json must not set ${name}`);
  }
  return problems;
}

function parse(tsconfig) {
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
    (d) =>
      `tsconfig.json: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
  );
  return { parsed, errors };
}

const declaration = /\.d\.[cm]?ts$/u;

/** Package folders resolve before the trusted root, so one inside src would shadow it. */
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

/**
 * Every program input must be first-party src, a named config input, a TypeScript lib or a
 * declaration inside the trusted dependency root. That root is filled only by npm ci from the
 * integrity-hashed lockfile, so a file planted inside it is tooling compromise, out of scope here.
 */
export function programInputs(
  web,
  { tsconfig = join(web, "tsconfig.json"), config = configInputs } = {},
) {
  const { parsed, errors } = parse(tsconfig);
  if (!parsed) return { problems: errors, inputs: [] };
  const problems = [...errors];
  if (parsed.projectReferences)
    problems.push("tsconfig.json must not have project references");
  if (parsed.options.paths || parsed.options.baseUrl)
    problems.push("tsconfig.json must not define path aliases");

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
  const webReal = realpathSync.native(web);
  const src = realpathSync.native(join(web, "src"));
  const named = new Set(config.map((p) => join(webReal, p)));
  const libDir = realpathSync.native(
    dirname(ts.getDefaultLibFilePath(parsed.options)),
  );
  const dependencies = trustedDependencyRoot(webReal);

  const inputs = [];
  for (const file of program.getSourceFiles()) {
    let real;
    try {
      real = realpathSync.native(file.fileName);
    } catch {
      problems.push(`program input ${file.fileName} has no real path`);
      continue;
    }
    let kind;
    if (inside(src, real) && !inPackageFolder(src, real)) kind = "first-party";
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
    if (!kind) {
      const within = inside(webReal, real);
      const at = within ? shown(webReal, real) : real.split(sep).join("/");
      problems.push(
        within && inPackageFolder(webReal, real)
          ? `program input in a package folder outside the trusted dependency root: ${at}`
          : `program input outside the admitted set: ${at}`,
      );
    }
  }
  return { problems, inputs };
}
