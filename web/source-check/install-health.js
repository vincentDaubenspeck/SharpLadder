import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
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
import { isDeepStrictEqual } from "node:util";
import Arborist from "@npmcli/arborist";
import binLinks from "bin-links";
import installChecks from "npm-install-checks";
import normalizeBin from "npm-normalize-package-bin";

// Arborist members used beyond its README: the forceActual load option and
// tree.inventory, a Map by location whose has() takes a node rather than a key.
// The checker's own process is trusted; a NODE_OPTIONS preload is a compromised checker.

const { checkPlatform, currentEnv } = installChecks;
const { getPaths } = binLinks;

const EDGE_TYPES = new Set(["prod", "dev", "optional", "peer", "peerOptional"]);
const OPTIONAL_EDGES = new Set(["optional", "peerOptional"]);
const MAP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "peerDependenciesMeta",
];
const SEGMENT = String.raw`(?:@[^/@.][^/]*/)?[^/@.][^/]*`;
const LOCATION = new RegExp(
  String.raw`^node_modules/${SEGMENT}(?:/node_modules/${SEGMENT})*$`,
);

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const label = (node) => (node.location === "" ? "(root)" : node.location);

/** The host as npm-install-checks sees it; libc stays unset off Linux, as npm leaves it. */
function hostPlatform() {
  const os = process.platform;
  return { os, cpu: process.arch, libc: currentEnv.libc(os) };
}

const platformList = (v) =>
  v === undefined ||
  typeof v === "string" ||
  (Array.isArray(v) && v.every((x) => typeof x === "string"));

/**
 * True when npm would skip the package on this host, false when it installs it, or a
 * problem string when the answer cannot be trusted; only EBADPLATFORM ever skips.
 */
export function platformSkip(pkg, host) {
  const { os, cpu, libc } = pkg;
  if (![os, cpu, libc].every(platformList))
    return "has an os, cpu or libc field of the wrong type";
  if (
    libc !== undefined &&
    host.os === "linux" &&
    typeof host.libc !== "string"
  )
    return "needs a libc check and the host libc is unknown";
  try {
    checkPlatform({ _id: pkg._id, os, cpu, libc }, false, host);
    return false;
  } catch (e) {
    if (e?.code === "EBADPLATFORM" && e.message === "Unsupported platform")
      return true;
    return `platform check failed: ${e?.code ?? ""} ${e?.message ?? String(e)}`;
  }
}

const normalMap = (v) => (v === undefined ? {} : v);
// npm reads bundledDependencies as an alias and never writes an empty or false list.
const normalBundle = (v) =>
  v === undefined || v === false || (Array.isArray(v) && v.length === 0)
    ? undefined
    : v;

/** Specifier drift between package.json and the lock's root entry. */
export function rootDrift(pkg, lockRoot) {
  if (!isObject(pkg)) return ["package.json is not a JSON object"];
  if (!isObject(lockRoot)) return ["the lock has no root package entry"];
  const problems = [];
  for (const key of ["name", "version"])
    if (pkg[key] !== lockRoot[key])
      problems.push(`root ${key} differs between package.json and the lock`);
  for (const key of MAP_FIELDS) {
    const a = normalMap(pkg[key]);
    const b = normalMap(lockRoot[key]);
    if (!isObject(a) || !isObject(b))
      problems.push(`root ${key} is not an object`);
    else if (!isDeepStrictEqual(a, b))
      problems.push(`root ${key} differs between package.json and the lock`);
  }
  const bundle = (o, side) => {
    const [x, y] = [o.bundleDependencies, o.bundledDependencies];
    if (x !== undefined && y !== undefined && !isDeepStrictEqual(x, y))
      problems.push(
        `${side} has conflicting bundleDependencies and bundledDependencies`,
      );
    return normalBundle(x ?? y);
  };
  if (
    !isDeepStrictEqual(
      bundle(pkg, "package.json"),
      bundle(lockRoot, "the lock"),
    )
  )
    problems.push(
      "root bundleDependencies differs between package.json and the lock",
    );
  return problems;
}

/** Shape faults that would make every later comparison meaningless. */
function shapeProblems(tree, side) {
  const problems = [];
  let fatal = false;
  const fault = (line) => {
    problems.push(line);
    fatal = true;
  };
  if (!(tree?.inventory instanceof Map) || !tree.inventory.get(""))
    return {
      problems: [`${side}: tree has no inventory or root`],
      fatal: true,
    };
  for (const node of tree.inventory.values()) {
    const at = `${side} ${typeof node?.location === "string" ? label(node) : "?"}`;
    if (typeof node?.location !== "string" || typeof node.path !== "string") {
      fault(`${at}: node has no location or path`);
      continue;
    }
    if (!isObject(node.package)) fault(`${at}: package is not an object`);
    if (!Array.isArray(node.errors)) fault(`${at}: errors is not a list`);
    if (!(node.edgesOut instanceof Map)) {
      fault(`${at}: edgesOut is not a map`);
      continue;
    }
    if (node.isLink) problems.push(`${at}: is a link`);
    if (node.location !== "" && !LOCATION.test(node.location))
      problems.push(`${at}: location is outside node_modules`);
    if (node.location !== "" && typeof node.package?.version !== "string")
      problems.push(`${at}: version is missing`);
    for (const edge of node.edgesOut.values()) {
      if (!EDGE_TYPES.has(edge?.type))
        fault(`${at}: edge of unknown type ${String(edge?.type)}`);
      if (typeof edge?.name !== "string" || typeof edge.spec !== "string")
        fault(`${at}: edge has no name or spec`);
    }
    for (const e of Array.isArray(node.errors) ? node.errors : [])
      problems.push(
        `${at}: load error ${e?.code ?? ""} ${e?.message ?? String(e)}`,
      );
  }
  return { problems, fatal };
}

function reach(seeds, skip = () => false) {
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length > 0) {
    const node = stack.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of node.edgesOut.values())
      if (edge.to && !skip(edge)) stack.push(edge.to);
  }
  return seen;
}

/**
 * Missing virtual nodes excused by a platform skip: downstream of an optional edge
 * into a package npm skips here, and unreachable once those edges are cut.
 */
export function excusedMissing(virtual, present, host) {
  const problems = [];
  const boundaries = [];
  const judged = new Map();
  for (const node of virtual.inventory.values())
    for (const edge of node.edgesOut.values()) {
      if (!OPTIONAL_EDGES.has(edge.type) || !edge.to) continue;
      if (!judged.has(edge.to))
        judged.set(edge.to, platformSkip(edge.to.package, host));
      const skip = judged.get(edge.to);
      if (skip === true) boundaries.push(edge);
      else if (skip !== false)
        problems.push(`virtual ${label(edge.to)}: ${skip}`);
    }
  const cut = new Set(boundaries);
  const seeds = [...virtual.inventory.values()].filter(
    (n) => n.location === "" || present.has(n.location),
  );
  const reduced = reach(seeds, (edge) => cut.has(edge));
  const excused = new Map();
  for (const boundary of boundaries)
    for (const node of reach([boundary.to])) {
      if (present.has(node.location) || reduced.has(node)) continue;
      const by = `${label(boundary.from)} -> ${label(boundary.to)}`;
      excused.set(node, [...(excused.get(node) ?? []), by]);
    }
  return { excused, problems };
}

/** Structural agreement of the loaded trees; installed file content is npm ci's to verify. */
export function compareTrees(actual, virtual, host) {
  const shapes = [
    shapeProblems(actual, "actual"),
    shapeProblems(virtual, "virtual"),
  ];
  const problems = shapes.flatMap((s) => s.problems);
  if (shapes.some((s) => s.fatal)) return { problems, excused: new Map() };
  const present = new Set();
  for (const node of actual.inventory.values()) {
    if (node.location === "") continue;
    const twin = virtual.inventory.get(node.location);
    if (!twin) {
      problems.push(`extra: ${node.location} is installed but not in the lock`);
      continue;
    }
    present.add(node.location);
    for (const key of ["name", "version"])
      if (node.package[key] !== twin.package[key])
        problems.push(
          `${node.location}: installed ${key} ${String(node.package[key])}, lock ${String(twin.package[key])}`,
        );
    // The actual tree takes integrity from the lock, so only a contradiction is evidence.
    if (node.integrity != null && node.integrity !== twin.integrity)
      problems.push(`${node.location}: integrity differs from the lock`);
  }
  for (const node of virtual.inventory.values())
    if (
      node.location !== "" &&
      (typeof node.integrity !== "string" || node.integrity === "")
    )
      problems.push(`virtual ${node.location}: the lock records no integrity`);
  const { excused, problems: platform } = excusedMissing(
    virtual,
    present,
    host,
  );
  problems.push(...platform);
  const required = reach([virtual.inventory.get("")]);
  for (const node of virtual.inventory.values()) {
    if (!required.has(node))
      problems.push(
        `virtual ${node.location}: nothing in the lock depends on it`,
      );
    if (
      node.location !== "" &&
      !present.has(node.location) &&
      !excused.has(node)
    )
      problems.push(
        `missing: ${node.location} is in the lock but not installed`,
      );
  }
  for (const [side, tree] of [
    ["actual", actual],
    ["virtual", virtual],
  ])
    for (const node of tree.inventory.values())
      for (const edge of node.edgesOut.values()) {
        if (!edge.error) continue;
        const expected =
          edge.error === "MISSING"
            ? virtual.inventory.get(node.location)?.edgesOut.get(edge.name)?.to
            : undefined;
        if (expected && excused.has(expected)) continue;
        problems.push(
          `${side} ${label(node)}: ${edge.error} ${edge.type} edge to ${edge.name}@${edge.spec}`,
        );
      }
  return { problems, excused };
}

/** Links and spelling on disk, segment by segment from the web root. */
function diskProblems(actual, root) {
  const problems = [];
  const linked = new Set();
  for (const node of actual.inventory.values()) {
    if (node.location === "" || !LOCATION.test(node.location)) continue;
    let dir = root;
    for (const part of node.location.split("/")) {
      dir = join(dir, part);
      if (linked.has(dir)) break;
      let stat;
      try {
        stat = lstatSync(dir);
      } catch (e) {
        problems.push(
          `${node.location}: cannot stat ${part}: ${e.code ?? e.message}`,
        );
        break;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        linked.add(dir);
        problems.push(
          `link: ${relative(root, dir).split(sep).join("/")} is not a plain directory`,
        );
        break;
      }
    }
    let real;
    try {
      real = relative(root, realpathSync.native(node.path))
        .split(sep)
        .join("/");
    } catch (e) {
      problems.push(`${node.location}: cannot resolve: ${e.code ?? e.message}`);
      continue;
    }
    if (real !== node.location)
      problems.push(`case: ${node.location} is spelled ${real} on disk`);
  }
  return problems;
}

// Claim limit: the census covers installation positions, scopes and each package root's own
// node_modules; a node_modules deeper inside a package is package contents. Installed contents
// are trusted as npm ci extracted them, and later edits, a compromised checker and concurrent
// filesystem changes are out of scope.

const slash = (root, path) => relative(root, path).split(sep).join("/");
const errorCode = (e) => e?.code ?? e?.message ?? String(e);

/** Names in a directory, or undefined after recording why it could not be read. */
function listDir(path, at, problems) {
  try {
    return readdirSync(path);
  } catch (e) {
    problems.push(`census: cannot read ${at}: ${errorCode(e)}`);
    return undefined;
  }
}

function statOf(path, at, problems) {
  try {
    return lstatSync(path);
  } catch (e) {
    problems.push(`census: cannot stat ${at}: ${errorCode(e)}`);
    return undefined;
  }
}

const kind = (stat) =>
  stat.isSymbolicLink()
    ? "a link"
    : stat.isDirectory()
      ? "a directory"
      : stat.isFile()
        ? "a file"
        : "an unknown entry type";

/** A plain directory, or false after recording what stands there instead. */
function plainDir(stat, at, problems) {
  if (stat.isDirectory() && !stat.isSymbolicLink()) return true;
  problems.push(`census: ${at} is ${kind(stat)}, not a plain directory`);
  return false;
}

/** Every package installation position under the web root, walked without following links. */
export function census(root) {
  const out = { problems: [], packages: new Map(), bins: [] };
  const names = listDir(root, "the web root", out.problems);
  if (!names) return out;
  if (!names.includes("node_modules")) {
    out.problems.push(
      names.some((n) => n.toLowerCase() === "node_modules")
        ? "census: node_modules is not spelled node_modules"
        : "census: node_modules is missing",
    );
    return out;
  }
  const top = join(root, "node_modules");
  const stat = statOf(top, "node_modules", out.problems);
  if (stat && plainDir(stat, "node_modules", out.problems))
    level(root, top, true, out);
  return out;
}

function topOnly(isTop, at, problems) {
  if (!isTop) problems.push(`census: ${at} is only allowed at the top level`);
  return isTop;
}

function level(root, dir, isTop, out) {
  const { problems, bins } = out;
  for (const name of listDir(dir, slash(root, dir), problems) ?? []) {
    const path = join(dir, name);
    const at = slash(root, path);
    const stat = statOf(path, at, problems);
    if (!stat) continue;
    if (name === ".package-lock.json") {
      if (
        topOnly(isTop, at, problems) &&
        (!stat.isFile() || stat.isSymbolicLink())
      )
        problems.push(`census: ${at} is ${kind(stat)}, not a regular file`);
    } else if (name === ".bin") {
      if (plainDir(stat, at, problems)) bins.push(path);
    } else if (name === ".vite-temp") {
      if (topOnly(isTop, at, problems) && plainDir(stat, at, problems)) {
        const inside = listDir(path, at, problems);
        if (inside && inside.length > 0)
          problems.push(`census: ${at} is not empty`);
      }
    } else if (name === ".cache")
      problems.push(
        `census: ${at} is a tool cache; delete it by hand and run knip through the npm script`,
      );
    else if (name.startsWith("."))
      problems.push(`census: ${at} is an unexpected dot entry`);
    else if (name.startsWith("@")) scopeAt(root, path, at, stat, out);
    else packageAt(root, path, out, stat);
  }
}

function scopeAt(root, path, at, stat, out) {
  const { problems } = out;
  if (!plainDir(stat, at, problems)) return;
  const scoped = listDir(path, at, problems);
  if (!scoped) return;
  if (scoped.length === 0) problems.push(`census: scope ${at} is empty`);
  for (const inner of scoped)
    if (inner.startsWith("."))
      problems.push(`census: ${at}/${inner} is a dot entry inside a scope`);
    else packageAt(root, join(path, inner), out);
}

function readManifest(path, at, names, problems) {
  if (!names.includes("package.json")) {
    problems.push(`census: ${at} has no package.json`);
    return {};
  }
  const file = statOf(
    join(path, "package.json"),
    `${at}/package.json`,
    problems,
  );
  if (!file) return {};
  if (!file.isFile() || file.isSymbolicLink()) {
    problems.push(
      `census: ${at}/package.json is ${kind(file)}, not a regular file`,
    );
    return {};
  }
  try {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    return isObject(pkg) ? pkg : {};
  } catch (e) {
    problems.push(`census: ${at}/package.json cannot be read: ${errorCode(e)}`);
    return {};
  }
}

function packageAt(root, path, out, known) {
  const { problems, packages } = out;
  const at = slash(root, path);
  const stat = known ?? statOf(path, at, problems);
  if (!stat || !plainDir(stat, at, problems)) return;
  const names = listDir(path, at, problems);
  if (!names) return;
  packages.set(at, { path, pkg: readManifest(path, at, names, problems) });
  const nested = join(path, "node_modules");
  if (!names.includes("node_modules")) {
    // A case-folding filesystem resolves a variant spelling as this package's node_modules.
    if (existsSync(nested))
      problems.push(`census: ${at}/node_modules is not spelled node_modules`);
    return;
  }
  const inner = statOf(nested, `${at}/node_modules`, problems);
  if (inner && plainDir(inner, `${at}/node_modules`, problems))
    level(root, nested, false, out);
}

/** The census and arborist's actual inventory must name the same locations. */
export function censusEquality(packages, actual) {
  const loaded = new Set([...actual.inventory.keys()].filter((l) => l !== ""));
  const problems = [];
  for (const location of packages.keys())
    if (!loaded.has(location))
      problems.push(
        `census only: ${location} is on disk but arborist did not load it`,
      );
  for (const location of loaded)
    if (!packages.has(location))
      problems.push(
        `arborist only: ${location} was loaded but the census did not find it`,
      );
  return problems;
}

const outside = (inside) =>
  inside === "" || inside.startsWith("..") || isAbsolute(inside);

/** The declared bin target inside its package, reached through no link. */
function declaredTarget(pkgPath, declared) {
  if (typeof declared !== "string")
    return { problem: "has no declared target" };
  const target = resolve(pkgPath, declared);
  const inside = relative(pkgPath, target);
  if (outside(inside)) return { problem: "is declared outside its package" };
  let dir = pkgPath;
  const parts = inside.split(sep);
  for (const [i, part] of parts.entries()) {
    dir = join(dir, part);
    let stat;
    try {
      stat = lstatSync(dir);
    } catch (e) {
      return {
        problem: `has a declared target that cannot be read: ${errorCode(e)}`,
      };
    }
    if (stat.isSymbolicLink())
      return { problem: "has a declared target path through a link" };
    if (i === parts.length - 1 && !stat.isFile())
      return { problem: "has a declared target that is not a regular file" };
  }
  return { target };
}

/** The .bin entries bin-links would write for each package, keyed by .bin directory. */
export function expectedBins(root, packages, problems) {
  const expected = new Map();
  for (const [location, { path, pkg }] of packages) {
    // The normaliser rewrites what it is given, so it only ever sees a copy.
    const declared =
      normalizeBin({ name: pkg.name, bin: structuredClone(pkg.bin) }).bin ?? {};
    for (const file of getPaths({ path, pkg, global: false, top: false })) {
      const dir = resolve(dirname(file));
      const name = basename(file);
      const want = expected.get(dir) ?? new Map();
      expected.set(dir, want);
      const prior = want.get(name);
      if (prior) {
        problems.push(
          `bin: ${slash(root, file)} is declared by ${prior.location} and ${location}; collision not modelled`,
        );
        continue;
      }
      const bin = Object.keys(declared).find((k) =>
        [k, `${k}.cmd`, `${k}.ps1`].includes(name),
      );
      want.set(name, { location, path, declared: declared[bin] });
    }
  }
  return expected;
}

/** The link text climbs out of .bin, so .bin and each directory down to the target count. */
function routeProblem(bin, target) {
  const modules = dirname(bin);
  const inside = relative(modules, target);
  if (outside(inside)) return "does not point at its declared target";
  const route = [bin, modules];
  let dir = modules;
  for (const part of inside.split(sep).slice(0, -1)) {
    dir = join(dir, part);
    route.push(dir);
  }
  for (const path of route) {
    try {
      if (lstatSync(path).isSymbolicLink())
        return "points at its declared target through a link";
    } catch (e) {
      return `has a route that cannot be read: ${errorCode(e)}`;
    }
  }
  return undefined;
}

/** A Linux .bin entry is a symlink to its declared target inside the declaring package. */
function linkProblem(entry, stat, owner) {
  if (!stat.isSymbolicLink()) return `is ${kind(stat)}, not a symlink`;
  const { target, problem } = declaredTarget(owner.path, owner.declared);
  if (problem) return problem;
  const bin = dirname(entry);
  let text;
  try {
    text = readlinkSync(entry);
  } catch (e) {
    return `cannot be read as a link: ${errorCode(e)}`;
  }
  // bin-links writes exactly this text; any other spelling could climb back through a link.
  if (text !== relative(bin, target))
    return "does not point at its declared target";
  const route = routeProblem(bin, target);
  if (route) return route;
  try {
    const real = realpathSync.native(entry);
    const inside = relative(realpathSync.native(owner.path), real);
    if (real !== realpathSync.native(target) || outside(inside))
      return "does not point at its declared target";
  } catch (e) {
    return `does not resolve: ${errorCode(e)}`;
  }
  return undefined;
}

/** Each .bin holds exactly the entries bin-links would write for the packages at its level. */
export function binProblems(root, packages, bins, platform = process.platform) {
  const problems = [];
  const expected = expectedBins(root, packages, problems);
  const found = new Set();
  for (const dir of bins) {
    found.add(resolve(dir));
    const at = slash(root, dir);
    const want = expected.get(resolve(dir)) ?? new Map();
    if (want.size === 0) problems.push(`bin: ${at} has no expected entries`);
    const names = listDir(dir, at, problems);
    if (!names) continue;
    for (const name of want.keys())
      if (!names.includes(name)) problems.push(`bin: ${at}/${name} is missing`);
    for (const name of names) {
      const entry = join(dir, name);
      const stat = statOf(entry, `${at}/${name}`, problems);
      if (!stat) continue;
      if (name === "package.json")
        problems.push(`bin: ${at} contains a package.json`);
      if (stat.isDirectory() && !stat.isSymbolicLink())
        problems.push(`bin: ${at}/${name} is a subdirectory`);
      const owner = want.get(name);
      const problem = !owner
        ? "is not expected"
        : platform === "win32"
          ? !stat.isFile() || stat.isSymbolicLink()
            ? `is ${kind(stat)}, not a regular file`
            : undefined
          : linkProblem(entry, stat, owner);
      if (problem) problems.push(`bin: ${at}/${name} ${problem}`);
    }
  }
  for (const [dir, want] of expected)
    if (want.size > 0 && !found.has(dir))
      problems.push(`bin: ${slash(root, dir)} is missing`);
  return problems;
}

function readJson(path, name, problems) {
  if (!existsSync(path)) {
    problems.push(`${name} is missing`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    problems.push(`${name} is not valid JSON: ${e.message}`);
    return undefined;
  }
}

/** Arborist is driven in-process with only a path, so no npm configuration reaches it. */
const newArborist = (path) => new Arborist({ path });

export async function installHealth(
  web,
  { arborist = newArborist, host = hostPlatform() } = {},
) {
  const problems = [];
  let root;
  try {
    root = realpathSync.native(web);
  } catch (e) {
    return {
      problems: [`web root cannot be resolved: ${e.message}`],
      excused: new Map(),
    };
  }
  if (existsSync(join(root, "npm-shrinkwrap.json")))
    problems.push("npm-shrinkwrap.json would replace the lock");
  const lock = readJson(
    join(root, "package-lock.json"),
    "package-lock.json",
    problems,
  );
  const pkg = readJson(join(root, "package.json"), "package.json", problems);
  if (lock !== undefined) {
    if (!isObject(lock) || lock.lockfileVersion !== 3)
      problems.push(
        `lockfileVersion is ${String(lock?.lockfileVersion)}, not 3`,
      );
    else if (!isObject(lock.packages))
      problems.push("the lock has no packages map");
    else if (pkg !== undefined)
      problems.push(...rootDrift(pkg, lock.packages[""]));
  }
  const heard = (level, ...args) => {
    if (level === "warn" || level === "error")
      problems.push(
        `${level} logged while loading: ${args.map(String).join(" ")}`,
      );
  };
  let actual;
  let virtual;
  process.on("log", heard);
  try {
    actual = await arborist(root).loadActual({ forceActual: true });
    virtual = await arborist(root).loadVirtual();
  } catch (e) {
    problems.push(
      `the tree could not be loaded: ${e?.code ?? ""} ${e?.message ?? String(e)}`,
    );
  } finally {
    process.off("log", heard);
  }
  // Arborist drops dot entries and unreadable folders, so the census vouches for completeness.
  const counted = census(root);
  problems.push(
    ...counted.problems,
    ...binProblems(root, counted.packages, counted.bins),
  );
  const tally = { census: counted.packages.size, bins: counted.bins.length };
  if (!actual || !virtual) return { problems, excused: new Map(), tally };
  tally.arborist = actual.inventory.size - 1;
  const compared = compareTrees(actual, virtual, host);
  problems.push(
    ...censusEquality(counted.packages, actual),
    ...compared.problems,
    ...diskProblems(actual, root),
  );
  return { problems, excused: compared.excused, tally };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { problems, excused, tally } = await installHealth(
    join(import.meta.dirname, ".."),
  );
  for (const [node, by] of excused)
    console.log(`excused: ${node.location} (below ${by.join("; ")})`);
  console.log(`excused total: ${excused.size}`);
  if (tally)
    console.log(
      `census: ${tally.census} packages, arborist: ${String(tally.arborist)}, .bin folders: ${tally.bins}`,
    );
  for (const line of problems) console.log(line);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
