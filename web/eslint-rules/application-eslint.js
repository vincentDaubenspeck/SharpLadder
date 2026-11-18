// The one ESLint the application policy runs through. ESLint otherwise takes the configuration
// file nearest each linted name, so a name in another project's folder would meet that
// project's rules; here the web root and web/eslint.config.js are fixed and no caller sets them.
// Callers get three operations and plain results, never the engine, its options, a formatter
// lookup or a Config, since each of those can build or reach another engine or configuration.
import { ESLint } from "eslint";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const formatters = new Set(["stylish", "json"]);

// The eslint package main, as its exports map names it; a row checks it against the installed
// package.
const eslintMain = "lib/api.js";

// The root of the package the import above loaded: the same specifier from the same module under
// the same conditions resolves to the same main file.
function eslintRoot() {
  const url = import.meta.resolve("eslint");
  if (!url.startsWith("file:"))
    refuse("format", "the eslint specifier does not resolve to a file");
  const main = realpathSync.native(fileURLToPath(url));
  if (!lstatSync(main).isFile())
    refuse("format", "the eslint main is not a regular file");
  const tail = sep + eslintMain.split("/").join(sep);
  if (!main.endsWith(tail))
    refuse("format", `the eslint main does not end in ${eslintMain}`);
  const root = main.slice(0, -tail.length);
  const manifest = join(root, "package.json");
  if (
    !lstatSync(manifest).isFile() ||
    JSON.parse(readFileSync(manifest, "utf8")).name !== "eslint"
  )
    refuse("format", "the eslint package root has no eslint package.json");
  return root;
}

function refuse(operation, reason) {
  throw new TypeError(`${operation}: ${reason}`);
}

function arity(operation, args, expected) {
  if (args.length !== expected)
    refuse(
      operation,
      `takes exactly ${expected} arguments, got ${args.length}`,
    );
}

function text(operation, value, position) {
  if (typeof value !== "string")
    refuse(
      operation,
      `argument ${position} must be a string, got ${typeof value}`,
    );
  return value;
}

function format(operation, value, position) {
  if (!formatters.has(text(operation, value, position)))
    refuse(operation, `${value} is not an allowed formatter`);
  return value;
}

function names(value) {
  if (!Array.isArray(value) || value.length === 0)
    refuse("lintFiles", "argument 1 must be a non-empty array of strings");
  const copy = [];
  for (let i = 0; i < value.length; i += 1) {
    const name = value[i];
    if (typeof name !== "string" || name === "")
      refuse("lintFiles", `name ${i + 1} must be a non-empty string`);
    let found;
    try {
      found = statSync(resolve(web, name));
    } catch {
      found = undefined;
    }
    // ESLint reads a name that is no file or folder as a glob pattern.
    if (found === undefined)
      refuse("lintFiles", `${name} is not an existing file or folder`);
    copy.push(name);
  }
  return copy;
}

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`lint result ${field} is not a non-negative integer`);
  return value;
}

function frozen(fields) {
  return Object.freeze(Object.assign(Object.create(null), fields));
}

/**
 * A facade over a new ESLint bound to the production configuration; a name outside the web root
 * is reported as outside its base path, never linted under another configuration.
 * @returns {Readonly<{ lintFiles: Function, lintText: Function, configFacts: Function }>} The
 *   frozen, prototype-free operations.
 */
export function applicationESLint() {
  const engine = new ESLint({
    cwd: web,
    overrideConfigFile: join(web, "eslint.config.js"),
  });
  // By absolute path only, so ESLint never looks up an eslint-formatter-<name> package.
  function formatter(name) {
    const root = eslintRoot();
    const path = realpathSync.native(
      join(root, "lib", "cli-engine", "formatters", `${name}.js`),
    );
    if (!path.startsWith(root + sep) || !lstatSync(path).isFile())
      refuse("format", `${name} is not a built-in formatter file`);
    return engine.loadFormatter(path);
  }

  async function settle(results, inputs, name) {
    if (!Array.isArray(results))
      throw new TypeError("ESLint returned no result list");
    if (results.length === 0) throw new Error(`no lint results for ${inputs}`);
    const totals = { errorCount: 0, warningCount: 0, fatalErrorCount: 0 };
    for (const result of results)
      for (const field of Object.keys(totals))
        totals[field] += count(result[field], field);
    const output = await (await formatter(name)).format(results);
    if (typeof output !== "string")
      throw new TypeError("the formatter returned no text");
    return frozen({ ...totals, output });
  }

  async function inert(work) {
    try {
      return await work();
    } catch (error) {
      // eslint-disable-next-line preserve-caught-error -- a cause would hand out ESLint's error object.
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  function facts(file, ignored, config) {
    if (typeof ignored !== "boolean")
      throw new TypeError(`${file}: ignored is not a boolean`);
    if (ignored !== (config === undefined))
      throw new TypeError(`${file}: ignored and configuration disagree`);
    if (ignored) return frozen({ ignored: true, configured: false });
    if (config === null || typeof config !== "object")
      throw new TypeError(`${file}: the configuration is not an object`);
    const options = config.languageOptions?.parserOptions;
    const service = options?.projectService;
    const project = options?.project;
    let projectService;
    if (service === undefined) projectService = null;
    else if (typeof service === "boolean") projectService = service;
    else
      throw new TypeError(
        `${file}: projectService is neither absent nor a boolean`,
      );
    let projectFact;
    if (project === undefined) projectFact = null;
    else if (typeof project === "string" || typeof project === "boolean")
      projectFact = project;
    else if (Array.isArray(project)) {
      const copy = [];
      for (const entry of project) {
        if (typeof entry !== "string")
          throw new TypeError(`${file}: a project entry is not a string`);
        copy.push(entry);
      }
      projectFact = Object.freeze(copy);
    } else
      throw new TypeError(
        `${file}: project is not a string, boolean or string list`,
      );
    return frozen({
      ignored: false,
      configured: true,
      projectService,
      project: projectFact,
    });
  }

  const lintFiles = (...args) =>
    inert(async () => {
      arity("lintFiles", args, 2);
      const list = names(args[0]);
      const name = format("lintFiles", args[1], 2);
      return settle(await engine.lintFiles(list), list.join(", "), name);
    });

  const lintText = (...args) =>
    inert(async () => {
      arity("lintText", args, 3);
      const code = text("lintText", args[0], 1);
      const filePath = text("lintText", args[1], 2);
      const name = format("lintText", args[2], 3);
      return settle(await engine.lintText(code, { filePath }), filePath, name);
    });

  const configFacts = (...args) =>
    inert(async () => {
      arity("configFacts", args, 1);
      const file = text("configFacts", args[0], 1);
      const ignored = await engine.isPathIgnored(file);
      return facts(file, ignored, await engine.calculateConfigForFile(file));
    });

  return frozen({
    lintFiles: Object.freeze(lintFiles),
    lintText: Object.freeze(lintText),
    configFacts: Object.freeze(configFacts),
  });
}
