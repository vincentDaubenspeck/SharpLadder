// Per-run copies of the lint policy for the tests of the production ESLint. The project service
// types a name only when the project holds a file of that name on disk, so each test lints its
// probes in a copy it owns, through the copy's own factory, and never writes the real tree.
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const web = dirname(dirname(fileURLToPath(import.meta.url)));

// Each stem appears once: the project keeps one file per stem.
const probes = {
  AppCapabilities: ["Probe.tsx", "TypedProbe.ts"],
  CssModuleAccess: ["Tone.tsx", "Alias.tsx"],
  Policy: ["Probe.tsx", "TypedProbe.ts"],
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const unlink = (path) =>
  process.platform === "win32" ? rmdirSync(path) : unlinkSync(path);

const filesUnder = (dir, tests, at = "") =>
  readdirSync(join(web, dir, at), { withFileTypes: true }).flatMap((entry) => {
    const path = at === "" ? entry.name : `${at}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(dir, tests, path);
    return !tests && entry.name.includes(".test.") ? [] : [`${dir}/${path}`];
  });

/**
 * The lint policy, all it loads and the program the project service builds, as paths under web;
 * a "../" path lands beside the copy's web root.
 * @returns {string[]} The paths a probe copy takes from the repository.
 */
export const copiedPaths = () => [
  "eslint.config.js",
  "eslint.comments.config.js",
  "lint-application.js",
  "package.json",
  "tsconfig.json",
  "../tools/forbidden-phrases.txt",
  ...["eslint-rules", "source-check", "source-policy", "stylelint"].flatMap(
    (dir) => filesUnder(dir, false),
  ),
  ...filesUnder("src", true),
];

// The copy's facade in its own process, loaded as the runner loads it; one request is one call.
const runner = `import { applicationESLint } from "./eslint-rules/application-eslint.js";

const facade = applicationESLint();
process.on("message", async ({ id, code, filePath, format }) => {
  try {
    const result = await facade.lintText(code, filePath, format);
    process.send({ id, result: { ...result } });
  } catch (error) {
    process.send({ id, error: String(error?.message ?? error) });
  }
});
process.on("disconnect", () => process.exit(0));
`;

/**
 * Lays out a fresh copy under a new temporary folder and records what this run wrote there.
 * Exported for child-process fixtures whose imports are outside static analysis.
 * @public
 * @param {string} tag The test file's prefix.
 * @param {string[]} names Its probe names under src, as listed above.
 * @returns {{ base: string, root: string, record: object, probe: (name: string) => string }} The copy.
 */
export function probeCopy(tag, names) {
  if (JSON.stringify(probes[tag]) !== JSON.stringify(names))
    throw new Error(`${tag} lists other probe files`);
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "sl-probe-")));
  const root = join(base, "web");
  const record = {
    run: randomUUID(),
    pid: process.pid,
    start: new Date().toISOString(),
    folders: [],
    written: [],
  };
  // The record is the folder's first entry, so a copy that stops part-way still has its owner.
  const owner = openSync(join(base, "owner.json"), "wx");
  const save = () => {
    ftruncateSync(owner, 0);
    writeSync(owner, `${JSON.stringify(record, null, 2)}\n`, 0);
  };
  try {
    save();
    layOut(base, tag, names, record, save);
  } catch (error) {
    closeSync(owner);
    try {
      removeOwned(base, record);
    } catch (left) {
      throw new AggregateError([error, left], `${base}: a failed copy`, {
        cause: left,
      });
    }
    throw error;
  }
  closeSync(owner);
  const probe = (name) => {
    const path = join(root, "src", `${tag}${name}`);
    if (!names.includes(name) || !existsSync(path))
      throw new Error(`${path} is not a written probe file`);
    return path;
  };
  return { base, root, record, probe };
}

// Each folder and file goes into the saved record as soon as it exists, before the next write.
function layOut(base, tag, names, { folders, written }, save) {
  const root = join(base, "web");
  const put = (path, bytes) => {
    const file = join(root, path);
    const entry = posix.normalize(`web/${path}`);
    const made = [];
    for (
      let at = posix.dirname(entry);
      !existsSync(join(base, at));
      at = posix.dirname(at)
    )
      made.unshift(at);
    mkdirSync(dirname(file), { recursive: true });
    if (made.length > 0) {
      folders.push(...made);
      save();
    }
    writeFileSync(file, bytes, { flag: "wx" });
    const { dev, ino, size } = statSync(file, { bigint: true });
    written.push({
      path: entry,
      dev: String(dev),
      ino: String(ino),
      size: Number(size),
      sha256: sha256(bytes),
    });
    save();
  };
  for (const path of copiedPaths()) put(path, readFileSync(join(web, path)));
  for (const name of names) put(`src/${tag}${name}`, "export {};\n");
  put("probe-runner.mjs", runner);
  symlinkSync(
    join(web, "node_modules"),
    join(root, "node_modules"),
    "junction",
  );
}

/**
 * Removes what a record says its run wrote, by identity, and nothing else. A path whose identity
 * no longer matches, or anything else found, stays and is reported.
 * @param {string} base The copy's temporary folder, held by the run that made it.
 * @param {{ folders: string[], written: { path: string, dev: string, ino: string }[] }} record
 *   That run's record.
 */
export function removeOwned(base, record) {
  const left = [];
  const folders = new Set(record.folders);
  for (const { path, dev, ino } of record.written) {
    const file = join(base, path);
    const now = lstatSync(file, { bigint: true, throwIfNoEntry: false });
    if (now?.isFile() && String(now.dev) === dev && String(now.ino) === ino)
      unlinkSync(file);
    else left.push(path);
    for (let at = posix.dirname(path); at !== "."; at = posix.dirname(at))
      folders.add(at);
  }
  const modules = join(base, "web", "node_modules");
  if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink())
    unlink(modules);
  unlinkSync(join(base, "owner.json"));
  const deepest = [...folders].sort(
    (a, b) => b.split("/").length - a.split("/").length,
  );
  for (const folder of [...deepest, "."])
    try {
      rmdirSync(join(base, folder));
    } catch {
      left.push(
        ...readdirSync(join(base, folder)).map((n) => `${folder}/${n}`),
      );
    }
  if (left.length > 0)
    throw new Error(
      `${base}: left in place, not this run's: ${left.join(", ")}`,
    );
}

/**
 * A probe copy with the copy's facade running in its own process.
 * @param {string} tag The test file's prefix.
 * @param {string[]} names Its probe names under src.
 * @returns {object} The copy, lintText through its facade, and teardown.
 */
export function probeProject(tag, names) {
  const copy = probeCopy(tag, names);
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const child = fork(join(copy.root, "probe-runner.mjs"), [], {
    cwd: copy.base,
    env,
    execArgv: [],
    serialization: "json",
  });
  const pending = new Map();
  let next = 0;
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => {
      for (const { reject } of pending.values())
        reject(new Error(`the probe runner exited (${code ?? signal})`));
      pending.clear();
      resolve(code);
    }),
  );
  child.on("message", ({ id, result, error }) => {
    const call = pending.get(id);
    pending.delete(id);
    if (error === undefined) call.resolve(Object.freeze(result));
    else call.reject(new Error(error));
  });
  const lintText = (code, filePath, format) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      child.send({ id, code, filePath, format });
    });
  // The runner exits by itself once the channel closes; its files go only after it has.
  const teardown = async () => {
    if (child.connected) child.disconnect();
    const code = await exited;
    removeOwned(copy.base, copy.record);
    if (code !== 0) throw new Error(`the probe runner exited with ${code}`);
  };
  return { ...copy, lintText, teardown };
}

/**
 * What makes a copied file other than a fresh, unlinked copy inside its own folder: a link on the
 * way down, a shared identity, a resolution outside the copy, or different bytes. The node_modules
 * link is the one named exception: the shared dependencies, never written through.
 * @param {string} root The copy's web root.
 * @param {string[]} paths Copied paths under web, each with its original under the real web.
 * @returns {string[]} One line per finding; none for a sound copy.
 */
export function copyProblems(root, paths) {
  const top = dirname(root);
  const problems = [];
  for (const path of paths) {
    const file = join(root, path);
    const original = join(web, path);
    const steps = relative(top, file).split(sep);
    for (let at = 1; at <= steps.length; at++)
      if (lstatSync(join(top, ...steps.slice(0, at))).isSymbolicLink())
        problems.push(`${path}: ${steps.slice(0, at).join("/")} is a link`);
    const own = statSync(file, { bigint: true });
    const repo = statSync(original, { bigint: true });
    if (own.nlink !== 1n) problems.push(`${path}: ${own.nlink} links`);
    if (own.dev === repo.dev && own.ino === repo.ino)
      problems.push(`${path}: the original file itself`);
    if (!realpathSync.native(file).startsWith(top + sep))
      problems.push(`${path}: resolves outside the copy`);
    if (sha256(readFileSync(file)) !== sha256(readFileSync(original)))
      problems.push(`${path}: differs from the original`);
  }
  const modules = join(root, "node_modules");
  if (
    !lstatSync(modules).isSymbolicLink() ||
    realpathSync.native(modules) !==
      realpathSync.native(join(web, "node_modules"))
  )
    problems.push("node_modules: not the link to the shared dependencies");
  return problems;
}

// Output a check run writes, as exact prefixes from the top of a checkout. Everything else is
// compared, ignored files included.
export const outputPrefixes = Object.freeze([
  ".git/", // The repository's own store, not part of the working tree.
  ".tools/", // Pinned tools the setup downloads.
  "TestResults/", // Result files the .NET test run writes.
  "web/.cache/build-evidence/", // Evidence the guarded build writes on each run.
  "web/.cache/playwright/results/", // Browser test results and failure images.
  "web/.cache/vite/", // The bundler's dependency cache.
  "web/.cache/vitest/", // The unit test runner's result cache.
  "web/dist/", // The production build.
  "web/node_modules/", // Installed dependencies, which the install health rows cover.
]);
// The C# build's output folders, at any depth under api.
export const outputFolders = Object.freeze({
  under: "api/",
  names: Object.freeze([
    "bin", // Compiled assemblies.
    "obj", // Intermediate files and the restore state.
  ]),
});

const output = (path, folder) => {
  const at = folder ? `${path}/` : path;
  return (
    outputPrefixes.some((prefix) => at.startsWith(prefix)) ||
    (folder &&
      path.startsWith(outputFolders.under) &&
      outputFolders.names.includes(posix.basename(path)))
  );
};

/**
 * Every path under a checkout with what it holds, walked with lstat, so links are recorded as
 * links and never followed, and git's ignore rules play no part.
 * @param {string} top The checkout's top folder.
 * @param {string} [at] The folder being walked, relative to top.
 * @param {Record<string, object>} [found] The entries so far.
 * @returns {Record<string, object>} Each relative path, "/" separated, to its kind and contents.
 */
export function manifest(top, at = "", found = {}) {
  for (const name of readdirSync(join(top, at)).sort()) {
    const path = at === "" ? name : `${at}/${name}`;
    const entry = lstatSync(join(top, path));
    if (output(path, entry.isDirectory())) continue;
    if (entry.isSymbolicLink())
      found[path] = { kind: "link", target: readlinkSync(join(top, path)) };
    else if (entry.isDirectory()) {
      // A folder is implied by what it holds, so one holding only output is no change.
      if (readdirSync(join(top, path)).length === 0)
        found[path] = { kind: "dir" };
      manifest(top, path, found);
    } else
      found[path] = {
        kind: "file",
        size: entry.size,
        sha256: sha256(readFileSync(join(top, path))),
        ...(process.platform === "win32"
          ? {}
          : { exec: (entry.mode & 0o111) !== 0 }),
      };
  }
  return found;
}

/**
 * @param {Record<string, object>} before A manifest.
 * @param {Record<string, object>} after The same walk later.
 * @returns {{ added: string[], removed: string[], changed: string[] }} The differences.
 */
export function manifestChanges(before, after) {
  const keys = (map) => Object.keys(map).sort();
  return {
    added: keys(after).filter((path) => !(path in before)),
    removed: keys(before).filter((path) => !(path in after)),
    changed: keys(after).filter(
      (path) =>
        path in before &&
        JSON.stringify(before[path]) !== JSON.stringify(after[path]),
    ),
  };
}
