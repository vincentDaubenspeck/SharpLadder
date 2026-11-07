// @vitest-environment node
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Arborist from "@npmcli/arborist";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareTrees,
  excusedMissing,
  installHealth,
  platformSkip,
  rootDrift,
} from "./install-health.js";
import { buildFixture, writeJson } from "./install-fixture.js";
import { bypassEnv, bypassRc } from "./npm-bypass.js";

let base;
let clean;
let cases = 0;
const links = [];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function fixtureCopy() {
  cases += 1;
  const dir = join(base, `case${String(cases)}`);
  cpSync(clean, dir, { recursive: true, verbatimSymlinks: true });
  return dir;
}

function link(target, path) {
  symlinkSync(target, path, "junction");
  links.push(path);
}

const check = async (dir, options) =>
  (await installHealth(dir, options)).problems;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "install-health-"));
  clean = join(base, "clean");
  mkdirSync(clean);
  buildFixture(clean);
}, 180_000);

afterAll(() => {
  for (const path of links) if (existsSync(path)) unlinkSync(path);
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("install health on the clean fixture", () => {
  it("passes the clean fixture and excuses only its platform skip", async () => {
    const { problems, excused } = await installHealth(clean);
    expect(problems).toEqual([]);
    const names = [...excused.keys()].map((n) => n.location);
    expect(names).toEqual(
      process.platform === "darwin" ? [] : ["node_modules/fsevents"],
    );
  });
});

describe("npm configuration cannot change the result", () => {
  const settings = [
    ...Object.entries(bypassEnv).map(([k, v]) => [
      `env ${k}`,
      { env: { [k]: v } },
    ]),
    ["user rc", { userRc: true }],
    ["project rc", { projectRc: true }],
    ["all combined", { env: bypassEnv, userRc: true, projectRc: true }],
  ];

  async function under({ env = {}, userRc, projectRc }, dir) {
    const saved = { ...process.env };
    if (projectRc) writeFileSync(join(dir, ".npmrc"), bypassRc);
    const rc = join(base, "user-rc");
    writeFileSync(rc, bypassRc);
    Object.assign(
      process.env,
      env,
      userRc ? { npm_config_userconfig: rc } : {},
    );
    try {
      return await check(dir);
    } finally {
      for (const key of Object.keys(process.env))
        if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  }

  it.each(settings)(
    "%s leaves a clean tree passing",
    async (_name, setting) => {
      expect(await under(setting, fixtureCopy())).toEqual([]);
    },
  );

  it.each(settings)(
    "%s still fails a missing dev dependency",
    async (_name, setting) => {
      const dir = fixtureCopy();
      rmSync(join(dir, "node_modules", "abbrev"), { recursive: true });
      const expected = await check(dir);
      expect(expected).toContain(
        "missing: node_modules/abbrev is in the lock but not installed",
      );
      expect(await under(setting, dir)).toEqual(expected);
    },
  );
});

describe("install health fails on a changed install", () => {
  const nm = (dir, ...parts) => join(dir, "node_modules", ...parts);

  it("fails a top-level extra", async () => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, "extra"));
    writeJson(nm(dir, "extra", "package.json"), {
      name: "extra",
      version: "1.0.0",
    });
    expect(await check(dir)).toContain(
      "extra: node_modules/extra is installed but not in the lock",
    );
  });

  it("fails a nested extra", async () => {
    const dir = fixtureCopy();
    const at = nm(dir, "@npmcli", "promise-spawn", "node_modules", "extra");
    mkdirSync(at);
    writeJson(join(at, "package.json"), { name: "extra", version: "1.0.0" });
    expect(await check(dir)).toContain(
      "extra: node_modules/@npmcli/promise-spawn/node_modules/extra is installed but not in the lock",
    );
  });

  it.each([
    ["top-level", []],
    ["nested", ["node_modules", "@npmcli", "promise-spawn"]],
  ])("fails a mixed-case %s NODE_MODULES", async (_name, under) => {
    const dir = fixtureCopy();
    const parent = join(dir, ...under);
    renameSync(join(parent, "node_modules"), join(parent, "NODE_MODULES"));
    expect((await check(dir)).length).toBeGreaterThan(0);
  });

  it.runIf(process.platform === "win32").each([
    ["top-level", []],
    ["nested", ["node_modules", "@npmcli", "promise-spawn"]],
  ])("names a mixed-case %s NODE_MODULES on Windows", async (_name, under) => {
    const dir = fixtureCopy();
    const parent = join(dir, ...under);
    renameSync(join(parent, "node_modules"), join(parent, "NODE_MODULES"));
    expect(
      (await check(dir)).some(
        (p) => p.startsWith("case:") && p.includes("NODE_MODULES"),
      ),
    ).toBe(true);
  });

  it("fails a FOO/foo rename", async () => {
    const dir = fixtureCopy();
    renameSync(nm(dir, "abbrev"), nm(dir, "ABBREV"));
    const problems = await check(dir);
    expect(problems).toContain(
      "missing: node_modules/abbrev is in the lock but not installed",
    );
    expect(problems).toContain(
      "extra: node_modules/ABBREV is installed but not in the lock",
    );
  });

  it("fails a scoped-name case change", async () => {
    const dir = fixtureCopy();
    renameSync(nm(dir, "@npmcli"), nm(dir, "@NPMcli"));
    expect(await check(dir)).toContain(
      "missing: node_modules/@npmcli/promise-spawn is in the lock but not installed",
    );
  });

  it("fails a missing host-compatible optional dependency", async () => {
    const dir = fixtureCopy();
    rmSync(nm(dir, "picocolors"), { recursive: true });
    expect(await check(dir)).toContain(
      "missing: node_modules/picocolors is in the lock but not installed",
    );
  });

  it("fails a changed installed version", async () => {
    const dir = fixtureCopy();
    const path = nm(dir, "which", "package.json");
    writeJson(path, { ...readJson(path), version: "2.0.3" });
    expect(await check(dir)).toContain(
      "node_modules/which: installed version 2.0.3, lock 2.0.2",
    );
  });

  it("fails a version edited in the lock", async () => {
    const dir = fixtureCopy();
    const path = join(dir, "package-lock.json");
    const lock = readJson(path);
    lock.packages["node_modules/isexe"].version = "2.0.1";
    writeJson(path, lock);
    expect(await check(dir)).toContain(
      "node_modules/isexe: installed version 2.0.0, lock 2.0.1",
    );
  });

  it("fails a malformed package.json that the hidden lockfile would hide", async () => {
    const dir = fixtureCopy();
    writeFileSync(nm(dir, "isexe", "package.json"), "{");
    const later = new Date(Date.now() + 60_000);
    utimesSync(nm(dir, ".package-lock.json"), later, later);
    const trusting = await new Arborist({ path: dir }).loadActual();
    const hidden = [...trusting.inventory.values()].flatMap((n) => n.errors);
    expect(hidden).toEqual([]);
    expect(
      (await check(dir)).some((p) =>
        p.startsWith("actual node_modules/isexe: load error"),
      ),
    ).toBe(true);
  });

  it("fails an invalid edge", async () => {
    const dir = fixtureCopy();
    const path = nm(dir, "@npmcli", "promise-spawn", "package.json");
    writeJson(path, { ...readJson(path), dependencies: { which: "^7.0.0" } });
    expect(await check(dir)).toContain(
      "actual node_modules/@npmcli/promise-spawn: INVALID prod edge to which@^7.0.0",
    );
  });

  it("fails a range edit that still admits the installed version", async () => {
    const dir = fixtureCopy();
    const path = join(dir, "package.json");
    const pkg = readJson(path);
    writeJson(path, {
      ...pkg,
      dependencies: { ...pkg.dependencies, which: "^2.0.0" },
    });
    expect(await check(dir)).toEqual([
      "root dependencies differs between package.json and the lock",
    ]);
  });

  it("fails changed peerDependenciesMeta", async () => {
    const dir = fixtureCopy();
    const path = join(dir, "package.json");
    writeJson(path, {
      ...readJson(path),
      peerDependenciesMeta: { which: { optional: true } },
    });
    expect(await check(dir)).toEqual([
      "root peerDependenciesMeta differs between package.json and the lock",
    ]);
  });

  it.each([
    ["the package", ["abbrev"]],
    ["a scope folder", ["@npmcli"]],
    ["a nested node_modules", ["@npmcli", "promise-spawn", "node_modules"]],
  ])("fails a junction or symlink at %s", async (_name, parts) => {
    const dir = fixtureCopy();
    const at = nm(dir, ...parts);
    const moved = join(base, `moved${String(cases)}`);
    renameSync(at, moved);
    link(moved, at);
    const problems = await check(dir);
    expect(problems).toContain(
      `link: node_modules/${parts.join("/")} is not a plain directory`,
    );
  });

  it("fails lockfileVersion 2", async () => {
    const dir = fixtureCopy();
    const path = join(dir, "package-lock.json");
    writeJson(path, { ...readJson(path), lockfileVersion: 2 });
    expect(await check(dir)).toContain("lockfileVersion is 2, not 3");
  });

  it("fails a malformed lock", async () => {
    const dir = fixtureCopy();
    writeFileSync(join(dir, "package-lock.json"), "{");
    const problems = await check(dir);
    expect(
      problems.some((p) => p.startsWith("package-lock.json is not valid JSON")),
    ).toBe(true);
    expect(
      problems.some((p) => p.startsWith("the tree could not be loaded")),
    ).toBe(true);
  });

  it("fails a missing lock", async () => {
    const dir = fixtureCopy();
    unlinkSync(join(dir, "package-lock.json"));
    const problems = await check(dir);
    expect(problems).toContain("package-lock.json is missing");
    expect(
      problems.some((p) => p.startsWith("the tree could not be loaded")),
    ).toBe(true);
  });

  it("fails a load error", async () => {
    const arborist = () => ({
      loadActual: () =>
        Promise.reject(Object.assign(new Error("boom"), { code: "EACCES" })),
    });
    expect(await check(clean, { arborist })).toEqual([
      "the tree could not be loaded: EACCES boom",
    ]);
  });

  it("fails a warning logged during load and removes its listener", async () => {
    const listeners = process.listenerCount("log");
    const arborist = (path) => {
      const real = new Arborist({ path });
      return {
        loadActual: (o) => real.loadActual(o),
        loadVirtual: async () => {
          process.emit("log", "warn", "injected", "warning");
          return real.loadVirtual();
        },
      };
    };
    expect(await check(clean, { arborist })).toEqual([
      "warn logged while loading: injected warning",
    ]);
    expect(process.listenerCount("log")).toBe(listeners);
  });
});

describe("root specifier drift", () => {
  const pkg = { name: "w", version: "1.0.0", dependencies: { a: "1.0.0" } };

  it("passes an absent map against an empty one", () => {
    expect(rootDrift({ ...pkg, devDependencies: {} }, pkg)).toEqual([]);
  });

  it("reads bundledDependencies as npm's alias and an empty list as absent", () => {
    expect(
      rootDrift(
        { ...pkg, bundledDependencies: ["a"] },
        { ...pkg, bundleDependencies: ["a"] },
      ),
    ).toEqual([]);
    expect(rootDrift({ ...pkg, bundleDependencies: [] }, pkg)).toEqual([]);
  });

  it("fails each changed field", () => {
    expect(rootDrift({ ...pkg, name: "x" }, pkg)).toEqual([
      "root name differs between package.json and the lock",
    ]);
    expect(rootDrift({ ...pkg, version: "1.0.1" }, pkg)).toEqual([
      "root version differs between package.json and the lock",
    ]);
    for (const key of [
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ])
      expect(rootDrift({ ...pkg, [key]: { b: "1" } }, pkg)).toEqual([
        `root ${key} differs between package.json and the lock`,
      ]);
    expect(rootDrift({ ...pkg, bundleDependencies: ["a"] }, pkg)).toEqual([
      "root bundleDependencies differs between package.json and the lock",
    ]);
  });

  it("fails conflicting bundle aliases and wrong shapes", () => {
    expect(
      rootDrift(
        { ...pkg, bundleDependencies: ["a"], bundledDependencies: [] },
        pkg,
      ),
    ).toContain(
      "package.json has conflicting bundleDependencies and bundledDependencies",
    );
    expect(rootDrift({ ...pkg, dependencies: ["a"] }, pkg)).toEqual([
      "root dependencies is not an object",
    ]);
    expect(rootDrift([], pkg)).toEqual(["package.json is not a JSON object"]);
    expect(rootDrift(pkg, undefined)).toEqual([
      "the lock has no root package entry",
    ]);
  });
});

describe("platform skip excuses", () => {
  const host = { os: "linux", cpu: "x64", libc: "glibc" };
  const off = { os: ["darwin"] };
  const root = join(tmpdir(), "synthetic-root");

  /** A virtual tree from location to package, built through the public Node class. */
  function virtualTree(rootPkg, entries) {
    const top = new Arborist.Node({
      path: root,
      pkg: { name: "root", version: "1.0.0", ...rootPkg },
    });
    const at = new Map([["", top]]);
    for (const [location, pkg] of Object.entries(entries)) {
      const cut = location.lastIndexOf("/node_modules/");
      const parent = at.get(cut === -1 ? "" : location.slice(0, cut));
      const name = location.slice(
        cut === -1 ? "node_modules/".length : cut + "/node_modules/".length,
      );
      at.set(
        location,
        new Arborist.Node({
          pkg: { name, version: "1.0.0", ...pkg },
          parent,
          integrity: "sha512-x",
        }),
      );
    }
    return top;
  }

  const excused = (tree, present = []) => {
    const r = excusedMissing(tree, new Set(present), host);
    return {
      problems: r.problems,
      excused: Object.fromEntries(
        [...r.excused].map(([n, by]) => [n.location, by]),
      ),
    };
  };

  it("excuses a direct platform skip and names its boundary", () => {
    const tree = virtualTree(
      { optionalDependencies: { s: "1.0.0" } },
      { "node_modules/s": off },
    );
    expect(excused(tree).excused).toEqual({
      "node_modules/s": ["(root) -> node_modules/s"],
    });
  });

  it("excuses a required child of a skipped package, nested or hoisted", () => {
    const nested = virtualTree(
      { optionalDependencies: { s: "1.0.0" } },
      {
        "node_modules/s": { ...off, dependencies: { c: "1.0.0" } },
        "node_modules/s/node_modules/c": {},
      },
    );
    expect(Object.keys(excused(nested).excused)).toEqual([
      "node_modules/s",
      "node_modules/s/node_modules/c",
    ]);
    const hoisted = virtualTree(
      { optionalDependencies: { s: "1.0.0" } },
      {
        "node_modules/s": { ...off, dependencies: { c: "1.0.0" } },
        "node_modules/c": {},
      },
    );
    expect(excused(hoisted).excused["node_modules/c"]).toEqual([
      "(root) -> node_modules/s",
    ]);
  });

  it("never excuses a shared child that a present package requires", () => {
    const tree = virtualTree(
      { dependencies: { k: "1.0.0" }, optionalDependencies: { s: "1.0.0" } },
      {
        "node_modules/k": { dependencies: { c: "1.0.0" } },
        "node_modules/s": { ...off, dependencies: { c: "1.0.0" } },
        "node_modules/c": {},
      },
    );
    expect(Object.keys(excused(tree, ["node_modules/k"]).excused)).toEqual([
      "node_modules/s",
    ]);
  });

  it("excuses a child below several skipped parents and lists each boundary", () => {
    const tree = virtualTree(
      { optionalDependencies: { s1: "1.0.0", s2: "1.0.0" } },
      {
        "node_modules/s1": { ...off, dependencies: { c: "1.0.0" } },
        "node_modules/s2": { ...off, dependencies: { c: "1.0.0" } },
        "node_modules/c": {},
      },
    );
    expect(excused(tree).excused["node_modules/c"]).toEqual([
      "(root) -> node_modules/s1",
      "(root) -> node_modules/s2",
    ]);
  });

  it("does not excuse a child that a host-compatible optional parent also needs", () => {
    const tree = virtualTree(
      { optionalDependencies: { s: "1.0.0", h: "1.0.0" } },
      {
        "node_modules/s": { ...off, dependencies: { c: "1.0.0" } },
        "node_modules/h": { dependencies: { c: "1.0.0" } },
        "node_modules/c": {},
      },
    );
    expect(Object.keys(excused(tree, ["node_modules/h"]).excused)).toEqual([
      "node_modules/s",
    ]);
  });

  it("excuses a cycle below a skip", () => {
    const tree = virtualTree(
      { optionalDependencies: { s: "1.0.0" } },
      {
        "node_modules/s": { ...off, dependencies: { a: "1.0.0" } },
        "node_modules/a": { dependencies: { b: "1.0.0" } },
        "node_modules/b": { dependencies: { a: "1.0.0" } },
      },
    );
    expect(Object.keys(excused(tree).excused).sort()).toEqual([
      "node_modules/a",
      "node_modules/b",
      "node_modules/s",
    ]);
  });

  it("treats an optional peer as a boundary and a required peer as none", () => {
    const optionalPeer = virtualTree(
      {
        peerDependencies: { s: "1.0.0" },
        peerDependenciesMeta: { s: { optional: true } },
      },
      { "node_modules/s": off },
    );
    expect(Object.keys(excused(optionalPeer).excused)).toEqual([
      "node_modules/s",
    ]);
    const requiredPeer = virtualTree(
      { peerDependencies: { s: "1.0.0" } },
      { "node_modules/s": off },
    );
    expect(excused(requiredPeer).excused).toEqual({});
  });

  it("never seeds an excuse from a missing host-compatible package", () => {
    const tree = virtualTree(
      { optionalDependencies: { h: "1.0.0" } },
      {
        "node_modules/h": { dependencies: { s: "1.0.0" } },
        "node_modules/s": off,
      },
    );
    expect(excused(tree).excused).toEqual({});
  });

  it("fails an orphan lock entry, platform-skipped or not", () => {
    const tree = virtualTree({}, { "node_modules/orphan": off });
    expect(excused(tree).excused).toEqual({});
    const actual = virtualTree({}, {});
    expect(compareTrees(actual, tree, host).problems).toEqual([
      "virtual node_modules/orphan: nothing in the lock depends on it",
      "missing: node_modules/orphan is in the lock but not installed",
    ]);
  });

  it("fails closed when a libc check is needed and the host libc is unknown", () => {
    const tree = virtualTree(
      { optionalDependencies: { s: "1.0.0" } },
      { "node_modules/s": { libc: ["musl"] } },
    );
    const r = excusedMissing(tree, new Set(), { ...host, libc: null });
    expect(r.excused.size).toBe(0);
    expect(r.problems).toEqual([
      "virtual node_modules/s: needs a libc check and the host libc is unknown",
    ]);
  });

  it("judges only EBADPLATFORM as a skip", () => {
    expect(platformSkip({ os: ["darwin"] }, host)).toBe(true);
    expect(platformSkip({ os: ["linux"], libc: ["glibc"] }, host)).toBe(false);
    expect(platformSkip({ libc: ["musl"] }, host)).toBe(true);
    expect(platformSkip({ os: 7 }, host)).toBe(
      "has an os, cpu or libc field of the wrong type",
    );
  });
});

describe("tree comparison faults", () => {
  const host = { os: "linux", cpu: "x64", libc: "glibc" };
  const path = join(tmpdir(), "synthetic-root");

  it("fails a required edge missing from both trees, which no excuse can map", () => {
    const tree = () =>
      new Arborist.Node({
        path,
        pkg: { name: "r", version: "1.0.0", dependencies: { a: "1" } },
      });
    expect(compareTrees(tree(), tree(), host).problems).toEqual([
      "actual (root): MISSING prod edge to a@1",
      "virtual (root): MISSING prod edge to a@1",
    ]);
  });

  it("fails an unknown edge type, a bad shape and a lock entry with no integrity", () => {
    const node = (edgesOut, extra = {}) => ({
      location: "",
      path,
      package: {},
      errors: [],
      edgesOut,
      ...extra,
    });
    const weird = {
      inventory: new Map([
        ["", node(new Map([["a", { type: "weird", name: "a", spec: "1" }]]))],
      ]),
    };
    const bare = {
      inventory: new Map([["", node(new Map(), { errors: "x" })]]),
    };
    const problems = compareTrees(weird, bare, host).problems;
    expect(problems).toContain("actual (root): edge of unknown type weird");
    expect(problems).toContain("virtual (root): errors is not a list");
    const root = new Arborist.Node({
      path,
      pkg: { name: "r", version: "1.0.0", dependencies: { a: "1.0.0" } },
    });
    new Arborist.Node({ pkg: { name: "a", version: "1.0.0" }, parent: root });
    expect(compareTrees(root, root, host).problems).toContain(
      "virtual node_modules/a: the lock records no integrity",
    );
  });

  it("fails a Link node", () => {
    const root = new Arborist.Node({
      path,
      pkg: { name: "r", version: "1.0.0" },
    });
    new Arborist.Link({
      name: "l",
      parent: root,
      realpath: join(path, "elsewhere"),
    });
    expect(compareTrees(root, root, host).problems).toContain(
      "actual node_modules/l: is a link",
    );
  });
});
