// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildFixture,
  buildPlaywrightFixture,
  writeJson,
} from "./install-fixture.js";
import {
  binCollisions,
  binProblems,
  census,
  censusEquality,
  expectedBins,
  installHealth,
  npmCmdShim,
  within,
  allowedBinName,
  windowsDevice,
} from "./install-health.js";

const win = process.platform === "win32";
const linux = process.platform === "linux";
const denied = win ? "EPERM" : "EACCES";
// The system copy, never one found first on PATH.
const icacls = join(
  process.env.SystemRoot ?? "C:/Windows",
  "System32",
  "icacls.exe",
);

let base;
let clean;
let cases = 0;
const links = [];
const locked = [];

const nm = (dir, ...parts) => join(dir, "node_modules", ...parts);
const check = async (dir) => (await installHealth(dir)).problems;

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

function extra(dir) {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "package.json"), { name: "extra", version: "1.0.0" });
}

// The test timer cannot interrupt spawnSync, so a hung icacls or chmod dies here.
function permissions(windows, posix) {
  const r = win
    ? spawnSync(icacls, windows, { encoding: "utf8", timeout: 30_000 })
    : spawnSync("chmod", posix, { encoding: "utf8", timeout: 30_000 });
  if (r.error) throw r.error;
  if (r.signal)
    throw new Error(`${win ? "icacls" : "chmod"} was killed by ${r.signal}.`);
  return r;
}

function deny(path) {
  const r = permissions([path, "/deny", "*S-1-1-0:(RD)"], ["000", path]);
  if (r.status !== 0)
    throw new Error(`cannot deny ${path}: ${r.stdout}${r.stderr}`);
  locked.push(path);
  // Root, or a token with the backup privilege enabled (Git Bash enables it
  // on an elevated token), lists through any deny; the census assertion would
  // then prove nothing, so the precondition fails loudly instead.
  let code;
  try {
    readdirSync(path);
  } catch (e) {
    code = e.code;
  }
  if (code !== denied)
    throw new Error(
      `precondition did not hold: listing ${path} gave ${code ?? "no error"}, not ${denied}; ` +
        "run as a non-root user without an enabled backup privilege",
    );
}

function allow(path) {
  permissions([path, "/remove:d", "*S-1-1-0"], ["755", path]);
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "install-census-"));
  clean = join(base, "clean");
  mkdirSync(clean);
  buildFixture(clean);
}, 180_000);

// Every step is attempted, so one failure never leaves the rest locked or behind.
afterAll(() => {
  const errors = [];
  const attempt = (step) => {
    try {
      step();
      return true;
    } catch (e) {
      errors.push(e);
      return false;
    }
  };
  for (const path of locked) attempt(() => allow(path));
  // Links go before the recursive delete, so it never walks through one.
  const unlinked = links
    .map((path) => attempt(() => rmSync(path, { force: true })))
    .every(Boolean);
  if (base && unlinked)
    attempt(() => rmSync(base, { recursive: true, force: true }));
  if (errors.length > 0)
    throw new AggregateError(
      errors,
      `cleanup failed: ${errors.map((e) => e.message).join("; ")}`,
    );
});

// Suites timed at 30_000 load the fixture with npm Arborist, which is cold the first time.

describe("census of the clean fixture", () => {
  it("finds every package arborist loads and every .bin", async () => {
    const { problems, packages, bins } = census(clean);
    expect(problems).toEqual([]);
    expect([...packages.keys()].sort()).toEqual(
      [
        "node_modules/@npmcli/promise-spawn",
        "node_modules/@npmcli/promise-spawn/node_modules/isexe",
        "node_modules/@npmcli/promise-spawn/node_modules/which",
        "node_modules/abbrev",
        "node_modules/isexe",
        "node_modules/picocolors",
        "node_modules/which",
        ...(process.platform === "darwin" ? ["node_modules/fsevents"] : []),
      ].sort(),
    );
    expect(bins).toHaveLength(2);
    expect(await check(clean)).toEqual([]);
  });
}, 30_000);

describe("census fails what arborist drops silently", () => {
  it("fails a file named @broken in a nested node_modules", async () => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, "abbrev", "node_modules"));
    writeFileSync(nm(dir, "abbrev", "node_modules", "@broken"), "");
    extra(nm(dir, "abbrev", "node_modules", "extra"));
    const problems = await check(dir);
    expect(problems).toContain(
      "census: node_modules/abbrev/node_modules/@broken is a file, not a plain directory",
    );
    expect(problems).toContain(
      "census only: node_modules/abbrev/node_modules/extra is on disk but arborist did not load it",
    );
  });

  it("fails a dangling scope link", async () => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, "abbrev", "node_modules"));
    link(join(base, "gone"), nm(dir, "abbrev", "node_modules", "@gone"));
    expect(await check(dir)).toContain(
      "census: node_modules/abbrev/node_modules/@gone is a link, not a plain directory",
    );
  });

  it("fails a read-denied scope that hides an extra package", async () => {
    const dir = fixtureCopy();
    const scope = nm(dir, "abbrev", "node_modules", "@hide");
    extra(join(scope, "extra"));
    deny(scope);
    expect(await check(dir)).toContain(
      `census: cannot read node_modules/abbrev/node_modules/@hide: ${denied}`,
    );
  });

  it("fails a read-denied nested node_modules that hides an extra package", async () => {
    const dir = fixtureCopy();
    const nested = nm(dir, "abbrev", "node_modules");
    extra(join(nested, "extra"));
    deny(nested);
    expect(await check(dir)).toContain(
      `census: cannot read node_modules/abbrev/node_modules: ${denied}`,
    );
  });

  it("fails a regular file named node_modules", async () => {
    const dir = fixtureCopy();
    writeFileSync(nm(dir, "abbrev", "node_modules"), "");
    expect(await check(dir)).toContain(
      "census: node_modules/abbrev/node_modules is a file, not a plain directory",
    );
  });

  it("fails a read-denied package folder", async () => {
    const dir = fixtureCopy();
    deny(nm(dir, "abbrev"));
    expect(await check(dir)).toContain(
      `census: cannot read node_modules/abbrev: ${denied}`,
    );
  });
}, 30_000);

describe("census fails dot entries", () => {
  it.each([
    ["top-level", [".hidden"], "is an unexpected dot entry"],
    [
      "nested",
      ["@npmcli", "promise-spawn", "node_modules", ".extra"],
      "is an unexpected dot entry",
    ],
    ["scoped", ["@npmcli", ".extra"], "is a dot entry inside a scope"],
  ])("fails a %s hidden package", async (_name, parts, message) => {
    const dir = fixtureCopy();
    extra(nm(dir, ...parts));
    expect(await check(dir)).toContain(
      `census: node_modules/${parts.join("/")} ${message}`,
    );
  });

  it("fails a package inside .bin", async () => {
    const dir = fixtureCopy();
    extra(nm(dir, ".bin", "extra"));
    const problems = await check(dir);
    expect(problems).toContain(
      "bin: node_modules/.bin/extra is a subdirectory",
    );
    expect(problems).toContain("bin: node_modules/.bin/extra is not expected");
  });

  it("fails a package inside .cache and a stray jiti cache, deleting nothing", async () => {
    const dir = fixtureCopy();
    extra(nm(dir, ".cache", "extra"));
    mkdirSync(nm(dir, ".cache", "jiti"));
    writeFileSync(nm(dir, ".cache", "jiti", "cached.cjs"), "");
    expect(await check(dir)).toContain(
      "census: node_modules/.cache is a tool cache; delete it by hand and run knip through the npm script",
    );
    expect(existsSync(nm(dir, ".cache", "jiti", "cached.cjs"))).toBe(true);
  });

  it.each([
    ["a dot file", ".stray", "file"],
    ["an unknown cache folder", ".vite", "dir"],
    ["a nested lock copy", ".package-lock.json", "nested"],
  ])("fails %s", async (_name, name, shape) => {
    const dir = fixtureCopy();
    const where =
      shape === "nested"
        ? nm(dir, "@npmcli", "promise-spawn", "node_modules", name)
        : nm(dir, name);
    if (shape === "dir") mkdirSync(where);
    else writeFileSync(where, "{}");
    const problems = await check(dir);
    expect(
      problems.some((p) => p.startsWith("census:") && p.includes(name)),
    ).toBe(true);
  });
}, 30_000);

describe(".vite-temp", () => {
  it("passes an empty top-level folder", async () => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, ".vite-temp"));
    expect(await check(dir)).toEqual([]);
  });

  it("fails a folder with an entry", async () => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, ".vite-temp"));
    writeFileSync(nm(dir, ".vite-temp", "vite.config.mjs"), "");
    expect(await check(dir)).toContain(
      "census: node_modules/.vite-temp is not empty",
    );
  });

  it("fails a linked folder", async () => {
    const dir = fixtureCopy();
    mkdirSync(join(dir, "empty"));
    link(join(dir, "empty"), nm(dir, ".vite-temp"));
    expect(await check(dir)).toContain(
      "census: node_modules/.vite-temp is a link, not a plain directory",
    );
  });

  it("fails a nested folder", async () => {
    const dir = fixtureCopy();
    mkdirSync(
      nm(dir, "@npmcli", "promise-spawn", "node_modules", ".vite-temp"),
    );
    expect(await check(dir)).toContain(
      "census: node_modules/@npmcli/promise-spawn/node_modules/.vite-temp is only allowed at the top level",
    );
  });
}, 30_000);

describe("census fails scope faults", () => {
  it.each([
    ["top-level", ["@empty"]],
    ["nested", ["@npmcli", "promise-spawn", "node_modules", "@empty"]],
  ])("fails a %s empty scope", async (_name, parts) => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, ...parts));
    expect(await check(dir)).toContain(
      `census: scope node_modules/${parts.join("/")} is empty`,
    );
  });

  it("fails a .bin inside a scope", async () => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, "@npmcli", ".bin"));
    expect(await check(dir)).toContain(
      "census: node_modules/@npmcli/.bin is a dot entry inside a scope",
    );
  });
}, 30_000);

describe("census fails links and package faults", () => {
  it("fails a linked top-level node_modules", async () => {
    const dir = fixtureCopy();
    renameSync(join(dir, "node_modules"), join(dir, "moved"));
    link(join(dir, "moved"), join(dir, "node_modules"));
    expect(await check(dir)).toContain(
      "census: node_modules is a link, not a plain directory",
    );
  });

  it("fails a linked package and a linked nested node_modules", async () => {
    const dir = fixtureCopy();
    renameSync(nm(dir, "abbrev"), join(dir, "abbrev"));
    link(join(dir, "abbrev"), nm(dir, "abbrev"));
    const nested = nm(dir, "@npmcli", "promise-spawn", "node_modules");
    renameSync(nested, join(dir, "nested"));
    link(join(dir, "nested"), nested);
    const problems = await check(dir);
    expect(problems).toContain(
      "census: node_modules/abbrev is a link, not a plain directory",
    );
    expect(problems).toContain(
      "census: node_modules/@npmcli/promise-spawn/node_modules is a link, not a plain directory",
    );
  });

  it("fails a missing package.json", async () => {
    const dir = fixtureCopy();
    unlinkSync(nm(dir, "abbrev", "package.json"));
    expect(await check(dir)).toContain(
      "census: node_modules/abbrev has no package.json",
    );
  });

  it("fails a package.json that is a link", async () => {
    const dir = fixtureCopy();
    const manifest = nm(dir, "abbrev", "package.json");
    mkdirSync(join(dir, "manifest"));
    writeFileSync(
      join(dir, "manifest", "package.json"),
      readFileSync(manifest),
    );
    unlinkSync(manifest);
    link(join(dir, "manifest"), manifest);
    expect(await check(dir)).toContain(
      "census: node_modules/abbrev/package.json is a link, not a regular file",
    );
  });
}, 30_000);

describe("census equality", () => {
  it("reports both differences when the counts are equal", () => {
    const packages = new Map([
      ["node_modules/a", {}],
      ["node_modules/b", {}],
    ]);
    const inventory = new Map([
      ["", {}],
      ["node_modules/a", {}],
      ["node_modules/c", {}],
    ]);
    expect(censusEquality(packages, { inventory })).toEqual([
      "census only: node_modules/b is on disk but arborist did not load it",
      "arborist only: node_modules/c was loaded but the census did not find it",
    ]);
  });
});

describe("Windows spelling", () => {
  it.runIf(win)("fails a mixed-case top-level NODE_MODULES", async () => {
    const dir = fixtureCopy();
    renameSync(join(dir, "node_modules"), join(dir, "NODE_MODULES"));
    expect(await check(dir)).toContain(
      "census: node_modules is not spelled node_modules",
    );
  });

  it.runIf(win)("fails a mixed-case nested NODE_MODULES", async () => {
    const dir = fixtureCopy();
    const pkg = nm(dir, "@npmcli", "promise-spawn");
    renameSync(join(pkg, "node_modules"), join(pkg, "NODE_MODULES"));
    expect(await check(dir)).toContain(
      "census: node_modules/@npmcli/promise-spawn/node_modules is not spelled node_modules",
    );
  });

  it.runIf(win)("fails mixed-case scope and package names", async () => {
    const dir = fixtureCopy();
    renameSync(nm(dir, "@npmcli"), nm(dir, "@NPMcli"));
    renameSync(nm(dir, "abbrev"), nm(dir, "Abbrev"));
    const problems = await check(dir);
    expect(problems).toContain(
      "extra: node_modules/@NPMcli/promise-spawn is installed but not in the lock",
    );
    expect(problems).toContain(
      "extra: node_modules/Abbrev is installed but not in the lock",
    );
  });

  it.runIf(win)("fails a .cmd shim renamed by case only", async () => {
    const dir = fixtureCopy();
    renameSync(
      nm(dir, ".bin", "node-which.cmd"),
      nm(dir, ".bin", "Node-Which.cmd"),
    );
    const problems = await check(dir);
    expect(problems).toContain(
      "bin: node_modules/.bin/node-which.cmd is missing",
    );
    expect(problems).toContain(
      "bin: node_modules/.bin/Node-Which.cmd is not expected",
    );
  });

  it.runIf(win)("fails a .bin entry that is a link", async () => {
    const dir = fixtureCopy();
    unlinkSync(nm(dir, ".bin", "node-which"));
    link(nm(dir, "which"), nm(dir, ".bin", "node-which"));
    expect(await check(dir)).toContain(
      "bin: node_modules/.bin/node-which is a link, not a regular file",
    );
  });
}, 30_000);

describe(".bin contents", () => {
  it("fails a missing entry and a missing .bin", async () => {
    const dir = fixtureCopy();
    unlinkSync(nm(dir, ".bin", "node-which"));
    rmSync(nm(dir, "@npmcli", "promise-spawn", "node_modules", ".bin"), {
      recursive: true,
    });
    const problems = await check(dir);
    expect(problems).toContain("bin: node_modules/.bin/node-which is missing");
    expect(problems).toContain(
      "bin: node_modules/@npmcli/promise-spawn/node_modules/.bin is missing",
    );
  });

  it("fails an extra entry, a subdirectory and a package.json", async () => {
    const dir = fixtureCopy();
    writeFileSync(nm(dir, ".bin", "stray"), "");
    mkdirSync(nm(dir, ".bin", "sub"));
    writeFileSync(nm(dir, ".bin", "package.json"), "{}");
    const problems = await check(dir);
    expect(problems).toContain("bin: node_modules/.bin/stray is not expected");
    expect(problems).toContain("bin: node_modules/.bin/sub is a subdirectory");
    expect(problems).toContain(
      "bin: node_modules/.bin contains a package.json",
    );
  });

  it("fails an entry renamed by case only", async () => {
    const dir = fixtureCopy();
    renameSync(nm(dir, ".bin", "node-which"), nm(dir, ".bin", "NODE-WHICH"));
    const problems = await check(dir);
    expect(problems).toContain("bin: node_modules/.bin/node-which is missing");
    expect(problems).toContain(
      "bin: node_modules/.bin/NODE-WHICH is not expected",
    );
  });

  it("fails a .bin with no expected entries", async () => {
    const dir = fixtureCopy();
    mkdirSync(nm(dir, "abbrev", "node_modules", ".bin"), { recursive: true });
    expect(await check(dir)).toContain(
      "bin: node_modules/abbrev/node_modules/.bin has no expected entries",
    );
  });

  it("fails two packages declaring one name in one .bin", async () => {
    const { packages, bins } = census(clean);
    const abbrev = packages.get("node_modules/abbrev");
    const twin = new Map(packages);
    twin.set("node_modules/abbrev", {
      ...abbrev,
      pkg: { ...abbrev.pkg, bin: { "node-which": "package.json" } },
    });
    expect(await binProblems(clean, twin, bins)).toContain(
      "bin: node_modules/.bin/node-which is declared by node_modules/abbrev and node_modules/which; collision not modelled",
    );
  });
}, 30_000);

describe("declared bin forms", () => {
  const root = join(tmpdir(), "declared-bins");
  const suffixes = win ? ["", ".cmd", ".ps1"] : [""];
  const binsOf = (location, pkg) => {
    const before = structuredClone(pkg);
    const problems = [];
    const path = join(root, ...location.split("/"));
    const result = expectedBins(
      root,
      new Map([[location, { path, pkg }]]),
      problems,
    );
    expect(problems).toEqual([]);
    expect(pkg).toEqual(before);
    return Object.fromEntries(
      [...result].map(([dir, want]) => [
        dir,
        Object.fromEntries(
          [...want].map(([name, { declared }]) => [name, declared]),
        ),
      ]),
    );
  };
  const entries = (bins) =>
    Object.fromEntries(
      Object.entries(bins).flatMap(([name, target]) =>
        suffixes.map((suffix) => [name + suffix, target]),
      ),
    );

  it("maps a string bin to the package name", () => {
    expect(
      binsOf("node_modules/tool", { name: "tool", bin: "./cli.js" }),
    ).toEqual({
      [join(root, "node_modules", ".bin")]: entries({ tool: "cli.js" }),
    });
  });

  it("maps each object bin and normalises its target", () => {
    const pkg = { name: "multi", bin: { a: "./bin/a.js", b: "bin\\b.js" } };
    const bin = pkg.bin;
    expect(binsOf("node_modules/multi", pkg)).toEqual({
      [join(root, "node_modules", ".bin")]: entries({
        a: "bin/a.js",
        b: "bin/b.js",
      }),
    });
    expect(pkg.bin).toBe(bin);
  });

  it("names a scoped string bin after the unscoped name in the top .bin", () => {
    expect(
      binsOf("node_modules/@scope/tool", {
        name: "@scope/tool",
        bin: "cli.js",
      }),
    ).toEqual({
      [join(root, "node_modules", ".bin")]: entries({ tool: "cli.js" }),
    });
  });

  it("puts a nested package's bin in its parent's .bin", () => {
    expect(
      binsOf("node_modules/outer/node_modules/inner", {
        name: "inner",
        bin: { inner: "i.js" },
      }),
    ).toEqual({
      [join(root, "node_modules", "outer", "node_modules", ".bin")]: entries({
        inner: "i.js",
      }),
    });
  });
});

describe("Linux .bin links", () => {
  const bin = (dir) => nm(dir, ".bin", "node-which");
  const target = (dir) => nm(dir, "which", "bin", "node-which");

  it.runIf(linux)("fails a regular file in place of the link", async () => {
    const dir = fixtureCopy();
    unlinkSync(bin(dir));
    writeFileSync(bin(dir), "");
    expect(await check(dir)).toContain(
      "bin: node_modules/.bin/node-which is a file, not a symlink",
    );
  });

  it.runIf(linux)("fails a dangling link", async () => {
    const dir = fixtureCopy();
    unlinkSync(target(dir));
    expect(await check(dir)).toContain(
      "bin: node_modules/.bin/node-which has a declared target that cannot be read: ENOENT",
    );
  });

  it.runIf(linux)("fails a link to a target outside the package", async () => {
    const dir = fixtureCopy();
    unlinkSync(bin(dir));
    symlinkSync("../isexe/index.js", bin(dir));
    expect(await check(dir)).toContain(
      "bin: node_modules/.bin/node-which does not point at its declared target",
    );
  });

  it.runIf(linux)(
    "fails a declared target that links out of the package",
    async () => {
      const dir = fixtureCopy();
      unlinkSync(target(dir));
      symlinkSync("../../isexe/index.js", target(dir));
      expect(await check(dir)).toContain(
        "bin: node_modules/.bin/node-which has a declared target path through a link",
      );
    },
  );

  it.runIf(linux)(
    "fails a declared target that is not a regular file",
    async () => {
      const dir = fixtureCopy();
      unlinkSync(target(dir));
      mkdirSync(target(dir));
      expect(await check(dir)).toContain(
        "bin: node_modules/.bin/node-which has a declared target that is not a regular file",
      );
    },
  );

  it.runIf(linux)(
    "keeps a declared path that climbs out inside the package",
    async () => {
      const { packages, bins } = census(clean);
      const which = packages.get("node_modules/which");
      const moved = new Map(packages);
      moved.set("node_modules/which", {
        ...which,
        pkg: { ...which.pkg, bin: { "node-which": "../isexe/index.js" } },
      });
      expect(await binProblems(clean, moved, bins)).toContain(
        "bin: node_modules/.bin/node-which has a declared target that cannot be read: ENOENT",
      );
    },
  );

  // A hand-built tree judged as Linux, so these routes are also tested on Windows.
  function routed() {
    cases += 1;
    const dir = join(base, `case${String(cases)}`);
    const pkg = nm(dir, "example");
    const cli = join(pkg, "bin", "cli.js");
    mkdirSync(join(pkg, "bin"), { recursive: true });
    writeFileSync(cli, "");
    const bin = nm(dir, ".bin");
    mkdirSync(bin);
    const packages = new Map([
      [
        "node_modules/example",
        { path: pkg, pkg: { name: "example", bin: "bin/cli.js" } },
      ],
    ]);
    const pointAt = async (to) => {
      const entry = join(bin, "example");
      symlinkSync(typeof to === "string" ? to : relative(bin, to.at), entry);
      links.push(entry);
      return binProblems(dir, packages, [bin], "linux");
    };
    return { dir, pkg, cli, pointAt };
  }

  it("passes the link text bin-links writes", async () => {
    const { cli, pointAt } = routed();
    expect(await pointAt({ at: cli })).toEqual([]);
  });

  it("fails a link that reaches the declared target through an outside link", async () => {
    const { dir, pkg, pointAt } = routed();
    mkdirSync(join(dir, "external"));
    link(join(pkg, "bin"), join(dir, "external", "return"));
    expect(
      await pointAt({ at: join(dir, "external", "return", "cli.js") }),
    ).toEqual([
      "bin: node_modules/.bin/example does not point at its declared target",
    ]);
  });

  it("fails a link that leaves node_modules and returns through real folders", async () => {
    const { pointAt } = routed();
    expect(
      await pointAt(
        join("..", "..", "node_modules", "example", "bin", "cli.js"),
      ),
    ).toEqual([
      "bin: node_modules/.bin/example does not point at its declared target",
    ]);
  });

  it("fails a package folder that is itself a link", async () => {
    const { dir, pkg, cli, pointAt } = routed();
    renameSync(pkg, join(dir, "moved"));
    link(join(dir, "moved"), pkg);
    expect(await pointAt({ at: cli })).toEqual([
      "bin: node_modules/.bin/example points at its declared target through a link",
    ]);
  });
}, 30_000);

describe("a bin and a name that looks like its shim", () => {
  // Judged as Linux, where both names are real bins with their own targets.
  function twins() {
    cases += 1;
    const dir = join(base, `case${String(cases)}`);
    const pkg = nm(dir, "example");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "a.js"), "");
    writeFileSync(join(pkg, "b.js"), "");
    const bin = nm(dir, ".bin");
    mkdirSync(bin);
    const packages = new Map([
      [
        "node_modules/example",
        {
          path: pkg,
          pkg: {
            name: "example",
            bin: { example: "a.js", "example.cmd": "b.js" },
          },
        },
      ],
    ]);
    const point = (name, file) => {
      const entry = join(bin, name);
      symlinkSync(relative(bin, join(pkg, file)), entry);
      links.push(entry);
    };
    return { dir, bin, packages, point };
  }

  it("checks each entry against its own target", async () => {
    const { dir, bin, packages, point } = twins();
    point("example", "a.js");
    point("example.cmd", "b.js");
    expect(await binProblems(dir, packages, [bin], "linux")).toEqual([]);
  });

  it("fails entries swapped between the two targets", async () => {
    const { dir, bin, packages, point } = twins();
    point("example", "b.js");
    point("example.cmd", "a.js");
    expect(await binProblems(dir, packages, [bin], "linux")).toEqual([
      "bin: node_modules/.bin/example does not point at its declared target",
      "bin: node_modules/.bin/example.cmd does not point at its declared target",
    ]);
  });

  it("reports the shim collision when judged as Windows", () => {
    const { dir, packages } = twins();
    const problems = [];
    expectedBins(dir, packages, problems, "win32");
    expect(problems).toEqual([
      "bin: node_modules/.bin/example.cmd is declared by node_modules/example and node_modules/example; collision not modelled",
    ]);
  });
});

describe("Windows .bin shims", () => {
  const suffixes = ["", ".cmd", ".ps1"];
  const node = "#!/usr/bin/env node\nconsole.log(1);\n";
  const tool = (location, bin, files) => ({ location, pkg: { bin }, files });
  const standard = () => [
    tool(
      "node_modules/example",
      { example: "bin/cli.js" },
      { "bin/cli.js": node },
    ),
    tool("node_modules/other", { other: "index.js" }, { "index.js": node }),
  ];

  // Hand-built under a folder with spaces and judged as Windows, so these run on every host.
  async function shimmed(specs = standard()) {
    cases += 1;
    const dir = join(base, `shim case ${String(cases)}`);
    const packages = new Map();
    for (const { location, pkg, files } of specs) {
      const path = join(dir, ...location.split("/"));
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(path, file)), { recursive: true });
        writeFileSync(join(path, file), text);
      }
      packages.set(location, { path, pkg });
    }
    const expected = expectedBins(dir, packages, [], "win32");
    const cmdShim = npmCmdShim();
    for (const want of expected.values()) {
      const targets = new Map(
        [...want.values()].map(({ path, declared, to }) => [
          to,
          resolve(path, declared),
        ]),
      );
      for (const [to, target] of targets) await cmdShim(target, to);
    }
    const bins = [...expected.keys()];
    const judge = (options) =>
      binProblems(dir, packages, bins, "win32", options);
    return { dir, bins, judge };
  }

  const shim = (dir, name) => nm(dir, ".bin", name);
  const each = suffixes.map((suffix) => `example${suffix}`);
  const wrong = (name) =>
    `bin: node_modules/.bin/${name} is not the shim npm writes for its declared target`;

  it("passes the shims npm writes", async () => {
    const { judge } = await shimmed();
    expect(await judge()).toEqual([]);
  });

  const tampers = {
    "one byte changed": (b) => {
      const c = Buffer.from(b);
      c[Math.floor(c.length / 2)] ^= 1;
      return c;
    },
    "an appended command": (b) =>
      Buffer.concat([b, Buffer.from("echo extra\n")]),
    "the target moved to another package": (b) =>
      Buffer.from(
        b
          .toString("utf8")
          .replaceAll("example/bin/cli.js", "other/index.js")
          .replaceAll("example\\bin\\cli.js", "other\\index.js"),
      ),
    "its line endings flipped": (b) => {
      const text = b.toString("utf8");
      return Buffer.from(
        text.includes("\r\n")
          ? text.replaceAll("\r\n", "\n")
          : text.replaceAll("\n", "\r\n"),
      );
    },
  };

  for (const [tamper, change] of Object.entries(tampers))
    it.each(each)(`fails %s with ${tamper}`, async (name) => {
      const { dir, judge } = await shimmed();
      const before = readFileSync(shim(dir, name));
      const after = change(before);
      expect(after.equals(before)).toBe(false);
      writeFileSync(shim(dir, name), after);
      expect(await judge()).toEqual([wrong(name)]);
    });

  it("fails a .cmd that npm wrote for another package's bin", async () => {
    const { dir, judge } = await shimmed();
    writeFileSync(
      shim(dir, "example.cmd"),
      readFileSync(shim(dir, "other.cmd")),
    );
    expect(await judge()).toEqual([wrong("example.cmd")]);
  });

  it("fails shims left over from an older shebang", async () => {
    const { dir, judge } = await shimmed();
    writeFileSync(
      nm(dir, "example", "bin", "cli.js"),
      "#!/usr/bin/env python3\n",
    );
    expect(await judge()).toEqual(each.map(wrong));
  });

  it.each([
    ["arguments", "#!/usr/bin/env node --no-warnings --stack-size=2000\n"],
    ["an env assignment", "#!/usr/bin/env -S NODE_ENV=production node\n"],
    ["no env", "#!/bin/sh -e\r\nexit 0\r\n"],
    ["no shebang", "console.log(1);\n"],
  ])("passes the shims npm writes for a target with %s", async (_, text) => {
    const { judge } = await shimmed([
      tool(
        "node_modules/example",
        { example: "bin/cli.js" },
        { "bin/cli.js": text },
      ),
    ]);
    expect(await judge()).toEqual([]);
  });

  const scoped = () => [
    tool("node_modules/@scope/tool", { tool: "cli.js" }, { "cli.js": node }),
    tool(
      "node_modules/@scope/tool/node_modules/inner",
      { inner: "lib/inner.js" },
      { "lib/inner.js": node },
    ),
  ];

  it("passes scoped and nested packages", async () => {
    const { bins, judge } = await shimmed(scoped());
    expect(bins).toHaveLength(2);
    expect(await judge()).toEqual([]);
  });

  it("fails a nested shim that npm wrote for the scoped package", async () => {
    const { dir, judge } = await shimmed(scoped());
    writeFileSync(
      nm(dir, "@scope", "tool", "node_modules", ".bin", "inner.ps1"),
      readFileSync(shim(dir, "tool.ps1")),
    );
    expect(await judge()).toEqual([
      "bin: node_modules/@scope/tool/node_modules/.bin/inner.ps1 is not the shim npm writes for its declared target",
    ]);
  });

  it("fails a missing shim and an extra one", async () => {
    const { dir, judge } = await shimmed();
    unlinkSync(shim(dir, "example.ps1"));
    writeFileSync(shim(dir, "example.sh"), "");
    expect(await judge()).toEqual([
      "bin: node_modules/.bin/example.ps1 is missing",
      "bin: node_modules/.bin/example.sh is not expected",
    ]);
  });

  it("fails every shim of a missing declared target", async () => {
    const { dir, judge } = await shimmed();
    unlinkSync(nm(dir, "example", "bin", "cli.js"));
    expect(await judge()).toEqual(
      each.map(
        (name) =>
          `bin: node_modules/.bin/${name} has a declared target that cannot be read: ENOENT`,
      ),
    );
  });

  it("fails a declared target reached through a junction in its package", async () => {
    const { dir, judge } = await shimmed();
    const pkg = nm(dir, "example");
    renameSync(join(pkg, "bin"), join(pkg, "real"));
    link(join(pkg, "real"), join(pkg, "bin"));
    expect(await judge()).toEqual(
      each.map(
        (name) =>
          `bin: node_modules/.bin/${name} has a declared target path through a link`,
      ),
    );
  });

  it("fails a package folder that is a junction", async () => {
    const { dir, judge } = await shimmed();
    renameSync(nm(dir, "example"), join(dir, "moved"));
    link(join(dir, "moved"), nm(dir, "example"));
    expect(await judge()).toEqual(
      each.map(
        (name) =>
          `bin: node_modules/.bin/${name} points at its declared target through a link`,
      ),
    );
  });

  it("fails closed when the generator is unavailable", async () => {
    const { judge } = await shimmed();
    const loadShim = () => {
      throw new Error("no generator");
    };
    expect(await judge({ loadShim })).toEqual(
      [...each, ...suffixes.map((suffix) => `other${suffix}`)].map(
        (name) =>
          `bin: node_modules/.bin/${name} cannot be compared: no generator`,
      ),
    );
  });

  it("fails closed when the generator writes something else", async () => {
    const { judge } = await shimmed();
    const loadShim = () => async (_, to) => {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, "");
    };
    expect(await judge({ loadShim })).toEqual(
      [...each, ...suffixes.map((suffix) => `other${suffix}`)].map(
        (name) =>
          `bin: node_modules/.bin/${name} cannot be compared: the generator wrote ${name.replace(/\.(cmd|ps1)$/, "")}`,
      ),
    );
  });

  // Counts generator calls, so a rejected mirror is shown to stop before generation.
  const spied = () => {
    const real = npmCmdShim();
    const calls = [];
    const loadShim = () => async (from, to) => {
      calls.push(to);
      return real(from, to);
    };
    return { calls, loadShim };
  };
  const inTree = [...each, ...suffixes.map((suffix) => `other${suffix}`)].map(
    (name) =>
      `bin: node_modules/.bin/${name} cannot be compared: the mirror is inside the tree`,
  );

  it("generates in a temp folder outside the tree", async () => {
    const { judge } = await shimmed();
    cases += 1;
    const temp = join(base, `temp${String(cases)}`);
    mkdirSync(temp);
    const { calls, loadShim } = spied();
    expect(await judge({ loadShim, temp })).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(readdirSync(temp)).toEqual([]);
  });

  it.each([
    ["an ordinary child", "cache", false],
    ["a child named like the parent", "..cache", false],
    ["a junction to a child", "cache", true],
  ])(
    "refuses a temp folder that is %s of the tree",
    async (_, name, junction) => {
      const { dir, judge } = await shimmed();
      const child = join(dir, name);
      mkdirSync(child);
      let temp = child;
      if (junction) {
        cases += 1;
        temp = join(base, `junction${String(cases)}`);
        link(child, temp);
      }
      const { calls, loadShim } = spied();
      expect(await judge({ loadShim, temp })).toEqual(inTree);
      expect(calls).toEqual([]);
      expect(readdirSync(child)).toEqual([]);
    },
  );

  it.runIf(win)(
    "refuses a temp folder named by its short alias",
    async (ctx) => {
      const { dir, judge } = await shimmed();
      const child = join(dir, "a long temporary folder");
      mkdirSync(child);
      const r = spawnSync(
        join(process.env.SystemRoot ?? "C:/Windows", "System32", "cmd.exe"),
        ["/d", "/s", "/c", `"for %I in ("${child}") do @echo %~sI"`],
        { encoding: "utf8", timeout: 30_000, windowsVerbatimArguments: true },
      );
      const temp = r.stdout.trim();
      if (r.status !== 0 || temp === "" || temp === child)
        ctx.skip("this volume does not create 8.3 short names");
      const { calls, loadShim } = spied();
      expect(await judge({ loadShim, temp })).toEqual(inTree);
      expect(calls).toEqual([]);
      expect(readdirSync(child)).toEqual([]);
    },
  );

  it("tells a child named like the parent from the parent itself", () => {
    const root = join(base, "web");
    expect(within(root, root)).toBe(true);
    expect(within(root, join(root, "..cache", "x"))).toBe(true);
    expect(within(root, join(root, "..", "x"))).toBe(false);
    expect(within(root, dirname(root))).toBe(false);
    if (win) expect(within("C:\\web", "D:\\web\\x")).toBe(false);
  });

  // A host that cannot create file symlinks cannot build these fixtures, so they skip there.
  const fileLinks = (() => {
    const probe = mkdtempSync(join(tmpdir(), "file-link-"));
    try {
      writeFileSync(join(probe, "a"), "");
      symlinkSync(join(probe, "a"), join(probe, "b"), "file");
      return true;
    } catch {
      return false;
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  })();
  const fileLink = (target, path) => {
    symlinkSync(target, path, "file");
    links.push(path);
  };

  (fileLinks ? it : it.skip).each(each)(
    "fails %s replaced by a file symlink to the same bytes",
    async (name) => {
      const { dir, judge } = await shimmed();
      const copy = join(dir, `copy of ${name}`);
      writeFileSync(copy, readFileSync(shim(dir, name)));
      unlinkSync(shim(dir, name));
      fileLink(copy, shim(dir, name));
      expect(await judge()).toEqual([
        `bin: node_modules/.bin/${name} is a link, not a regular file`,
      ]);
    },
  );

  (fileLinks ? it : it.skip)(
    "fails a declared target that is a symlink out of its package",
    async () => {
      const { dir, judge } = await shimmed();
      const cli = nm(dir, "example", "bin", "cli.js");
      unlinkSync(cli);
      fileLink(nm(dir, "other", "index.js"), cli);
      expect(await judge()).toEqual(
        each.map(
          (name) =>
            `bin: node_modules/.bin/${name} has a declared target path through a link`,
        ),
      );
    },
  );

  it("fails two bins whose names differ only by case", () => {
    const root = join(base, "fold");
    const packages = new Map(
      ["Foo", "foo"].map((name) => [
        `node_modules/${name}-tool`,
        {
          path: join(root, "node_modules", `${name}-tool`),
          pkg: { bin: { [name]: "cli.js" } },
        },
      ]),
    );
    for (const platform of ["win32", "linux"]) {
      const problems = [];
      expectedBins(root, packages, problems, platform);
      expect(problems).toEqual([
        "bin: node_modules/.bin has Foo and foo, which differ only by case, declared by node_modules/Foo-tool and node_modules/foo-tool",
      ]);
    }
  });

  it.each(["win32", "linux"])(
    "fails one package declaring names that differ only by case, judged as %s",
    (platform) => {
      const root = join(base, "fold one");
      const problems = [];
      const expected = expectedBins(
        root,
        new Map([
          [
            "node_modules/tool",
            {
              path: join(root, "node_modules", "tool"),
              pkg: { bin: { TOOL: "cli.js", tool: "cli.js" } },
            },
          ],
        ]),
        problems,
        platform,
      );
      expect(problems).toEqual([
        "bin: node_modules/.bin has TOOL and tool, which differ only by case, declared by node_modules/tool",
      ]);
      expect([...expected.values()].every((want) => want.size === 0)).toBe(
        true,
      );
    },
  );

  describe.each(["win32", "linux"])("bin names judged as %s", (platform) => {
    const judged = (bin, name = "tool") => {
      const root = join(base, "names");
      const problems = [];
      const expected = expectedBins(
        root,
        new Map([
          [
            `node_modules/${name}`,
            { path: join(root, "node_modules", name), pkg: { name, bin } },
          ],
        ]),
        problems,
        platform,
      );
      const names = [...expected.values()].flatMap((want) => [...want.keys()]);
      return { problems, names };
    };

    it.each([
      "../evil",
      "sub/evil",
      "sub\\evil",
      "a:b",
      "NUL",
      "con.txt",
      "Lpt9.cmd",
      "..",
      ".",
      "evil.",
      "evil ",
      "evil\u0007",
      "",
    ])("refuses %j before any path is built", (key) => {
      const { problems, names } = judged({ [key]: "cli.js", ok: "cli.js" });
      expect(problems).toEqual([
        `bin: node_modules/tool declares bin ${JSON.stringify(key)}, which is not an allowed bin name: ${ALLOWED}`,
      ]);
      expect(names.filter((n) => !n.startsWith("ok"))).toEqual([]);
      expect(names).toContain("ok");
    });

    it("accepts plain names, a scoped package's own name and an array", () => {
      expect(
        judged({ "con-tool": "a.js", com0: "b.js", "a.b_c-d": "c.js" })
          .problems,
      ).toEqual([]);
      expect(judged("cli.js", "@scope/tool").problems).toEqual([]);
      expect(judged(["bin/one.js", "lib/two"]).problems).toEqual([]);
    });
  });

  it("loads only npm's own cmd-shim at the expected version", () => {
    cases += 1;
    const dir = join(base, `case${String(cases)}`);
    const exe = join(dir, "node.exe");
    mkdirSync(dir);
    expect(() => npmCmdShim(exe)).toThrow(
      "the running node has no bundled npm",
    );
    const npm = join(dir, "node_modules", "npm");
    mkdirSync(npm, { recursive: true });
    writeJson(join(npm, "package.json"), { name: "npm" });
    expect(() => npmCmdShim(exe)).toThrow("ENOENT");
    mkdirSync(join(npm, "node_modules", "cmd-shim"), { recursive: true });
    writeJson(join(npm, "node_modules", "cmd-shim", "package.json"), {
      name: "cmd-shim",
      version: "7.0.0",
    });
    expect(() => npmCmdShim(exe)).toThrow(
      "npm bundles cmd-shim 7.0.0, not the pinned 8.0.0",
    );
    expect(typeof npmCmdShim()).toBe("function");
  });

  it.each([
    ["missing", "", "tools/tool-pins.json cannot be read: ENOENT"],
    ["not JSON", "{", "tools/tool-pins.json cannot be read: "],
    ["without the pin", { node: { version: "26.13.0" } }, "no node.cmdShim"],
    ["with a range", { node: { cmdShim: "^8.0.0" } }, "no node.cmdShim"],
    [
      "with another version",
      { node: { cmdShim: "7.0.0" } },
      "not the pinned 7.0.0",
    ],
  ])("fails closed on a pins file %s", (_, content, message) => {
    cases += 1;
    const dir = join(base, `case${String(cases)}`);
    mkdirSync(dir);
    const pins = join(dir, "tool-pins.json");
    if (typeof content === "string") {
      if (content !== "") writeFileSync(pins, content);
    } else writeJson(pins, content);
    expect(() => npmCmdShim(process.execPath, pins)).toThrow(message);
  });

  it("refuses a shim generator whose pin is wrong before generating", async () => {
    cases += 1;
    const dir = join(base, `case${String(cases)}`);
    mkdirSync(dir);
    const pins = join(dir, "tool-pins.json");
    writeJson(pins, { node: { cmdShim: "7.0.0" } });
    const { judge } = await shimmed();
    const problems = await judge({
      loadShim: () => npmCmdShim(process.execPath, pins),
    });
    expect(problems.length).toBeGreaterThan(0);
    for (const p of problems)
      expect(p).toMatch(
        /cannot be compared: npm bundles cmd-shim 8\.0\.0, not the pinned 7\.0\.0$/,
      );
  });
}, 30_000);

const ALLOWED =
  'an ASCII letter or digit, then letters, digits, ".", "_" or "-", not ending in "." and not a Windows device name';
const at = "bin: node_modules/tool";

describe("bin name rule", () => {
  it.each([
    "CON",
    "nul",
    "NUL.tar.gz",
    "nul .txt",
    "NUL  ",
    "COM\u00b9",
    "LPT\u00b2",
    "COM\u00b3.txt",
    "com\u00b9.CMD",
    "lpt9",
  ])("treats %j as a Windows device", (name) => {
    expect(windowsDevice(name)).toBe(true);
  });

  it.each([
    "COM10",
    "CONSOLE",
    "NULL",
    "COM",
    "LPT",
    "AUXILIARY",
    "com1x",
    "com0",
    "con-tool",
  ])("does not treat %j as a Windows device", (name) => {
    expect(windowsDevice(name)).toBe(false);
  });

  it.each([
    "COM\u00b9",
    "LPT\u00b2",
    "COM\u00b3.txt",
    "com\u00b9.CMD",
    "NUL.tar.gz",
    "nul .txt",
    "caf\u00e9",
    "a b",
    "a$b",
    "_x",
    "-x",
    ".hidden",
    "..x",
    "x.",
    "__proto__",
  ])("refuses %j", (name) => {
    expect(allowedBinName(name)).toBe(false);
  });

  it.each([
    "COM10",
    "CONSOLE",
    "NULL",
    "COM",
    "LPT",
    "AUXILIARY",
    "com1x",
    "com0",
    "a.b_c-d",
    "2to3",
    "constructor",
    "toString",
  ])("accepts %j", (name) => {
    expect(allowedBinName(name)).toBe(true);
  });
});

describe.each(["win32", "linux"])(
  "raw bin declarations judged as %s",
  (platform) => {
    const judged = (pkg) => {
      const root = join(tmpdir(), "raw-bins");
      const problems = [];
      const expected = expectedBins(
        root,
        new Map([
          [
            "node_modules/tool",
            { path: join(root, "node_modules", "tool"), pkg },
          ],
        ]),
        problems,
        platform,
      );
      const names = [...expected.values()].flatMap((want) => [...want.keys()]);
      return { problems, names };
    };
    const shims = (name) =>
      platform === "win32" ? [name, `${name}.cmd`, `${name}.ps1`] : [name];

    it.each([true, false, null, 0, 123, "", [null], [123], [""], [[]], [{}]])(
      "reports the bin field %j and expects nothing from it",
      (bin) => {
        const { problems, names } = judged({ name: "tool", bin });
        expect(problems).toEqual([
          `${at} has a bin field npm's forms do not cover: ${JSON.stringify(bin)}`,
        ]);
        expect(names).toEqual([]);
      },
    );

    it.each([123, "", null, {}, [], true])(
      "reports an object bin whose target is %j",
      (target) => {
        const { problems, names } = judged({
          name: "tool",
          bin: { example: target, ok: "cli.js" },
        });
        expect(problems).toEqual([
          `${at} has a bin field npm's forms do not cover: ${JSON.stringify({ example: target, ok: "cli.js" })}`,
        ]);
        expect(names).toEqual([]);
      },
    );

    it("takes an empty object or array as no bins", () => {
      expect(judged({ name: "tool", bin: {} })).toEqual({
        problems: [],
        names: [],
      });
      expect(judged({ name: "tool", bin: [] })).toEqual({
        problems: [],
        names: [],
      });
    });

    it("refuses a bin named __proto__, which npm itself loses", () => {
      const bin = JSON.parse('{"__proto__":"lib/index.js","ok":"cli.js"}');
      const { problems, names } = judged({ name: "tool", bin });
      expect(problems).toEqual([
        `${at} declares bin "__proto__", which is not an allowed bin name: ${ALLOWED}`,
      ]);
      expect(names).toEqual(shims("ok"));
    });

    it.each(["constructor", "toString", "hasOwnProperty"])(
      "expects a bin named %s like any other",
      (name) => {
        const { problems, names } = judged({
          name: "tool",
          bin: JSON.parse(`{"${name}":"cli.js"}`),
        });
        expect(problems).toEqual([]);
        expect(names).toEqual(shims(name));
      },
    );

    it.each(["/", ".", "\\"])(
      "reports a bin whose target npm's normaliser drops: %j",
      (target) => {
        const { problems, names } = judged({
          name: "tool",
          bin: { example: target, ok: "cli.js" },
        });
        expect(problems).toEqual([
          `${at} declares bin "example", which npm's normaliser drops`,
        ]);
        expect(names).toEqual(shims("ok"));
      },
    );

    it("reports a refused name that npm would shorten onto a declared one", () => {
      const { problems, names } = judged({
        name: "tool",
        bin: { "sub/evil": "a.js", evil: "b.js", ok: "cli.js" },
      });
      expect(problems).toEqual([
        `${at} declares bin "sub/evil", which is not an allowed bin name: ${ALLOWED}`,
        `${at} declares bin "evil" more than once`,
      ]);
      expect(names).toEqual(shims("ok"));
    });

    it("reports two array paths with one basename", () => {
      const { problems, names } = judged({
        name: "tool",
        bin: ["a/cli.js", "b/cli.js"],
      });
      expect(problems).toEqual([`${at} declares bin "cli.js" more than once`]);
      expect(names).toEqual([]);
    });

    const withNormalize = (normalize) => {
      const root = join(tmpdir(), "raw-bins");
      const problems = [];
      const expected = expectedBins(
        root,
        new Map([
          [
            "node_modules/tool",
            {
              path: join(root, "node_modules", "tool"),
              pkg: { name: "tool", bin: { ok: "cli.js", two: "two.js" } },
            },
          ],
        ]),
        problems,
        platform,
        { normalize },
      );
      return { problems, size: expected.size };
    };
    // The real normaliser for single declarations, a faulty one for the whole field.
    const wholeOnly = (change) => (pkg) =>
      Object.keys(pkg.bin).length > 1
        ? { ...pkg, bin: { ...pkg.bin, ...change } }
        : pkg;

    it("reports a whole field that normalises to more than its parts", () => {
      expect(withNormalize(wholeOnly({ ghost: "g.js" }))).toEqual({
        problems: [
          `${at} has bins {"ghost":"g.js","ok":"cli.js","two":"two.js"} after npm's normaliser, not {"ok":"cli.js","two":"two.js"}`,
        ],
        size: 0,
      });
    });

    it("reports a whole field that normalises to other targets", () => {
      expect(withNormalize(wholeOnly({ ok: "elsewhere.js" }))).toEqual({
        problems: [
          `${at} has bins {"ok":"elsewhere.js","two":"two.js"} after npm's normaliser, not {"ok":"cli.js","two":"two.js"}`,
        ],
        size: 0,
      });
    });

    it("reports a normaliser that throws", () => {
      const thrower = () => {
        throw new TypeError("broken");
      };
      expect(withNormalize(thrower)).toEqual({
        problems: [
          `${at} has a bin field npm's normaliser cannot read: broken`,
        ],
        size: 0,
      });
    });

    it("reports a string bin without a usable package name", () => {
      for (const name of [undefined, 7, "a/b/c", "../x"])
        expect(judged({ name, bin: "cli.js" }).problems).toEqual([
          `${at} declares a string bin without a usable package name`,
        ]);
    });

    it.each([
      { directories: { bin: "bin" } },
      { bin: false, directories: { bin: "bin" } },
      { bin: { ok: "cli.js" }, directories: { bin: "bin" } },
    ])("reports directories.bin, which npm expands: %j", (fields) => {
      const { problems } = judged({ name: "tool", ...fields });
      expect(problems).toContain(
        `${at} declares directories.bin, which npm expands and the verifier does not model`,
      );
    });
  },
);

describe("raw bin declarations in an installed tree", () => {
  const manifest = (dir) => nm(dir, "abbrev", "package.json");
  const declare = (dir, text) => {
    const pkg = JSON.parse(readFileSync(manifest(dir), "utf8"));
    const body = JSON.stringify({ ...pkg, bin: "BIN" }, null, 2);
    writeFileSync(manifest(dir), body.replace('"BIN"', text));
  };

  it.each([
    "true",
    '{ "example": 123 }',
    '{ "__proto__": "index.js" }',
    "[null]",
  ])("reports the bin field %s", async (text) => {
    const dir = fixtureCopy();
    declare(dir, text);
    const problems = await check(dir);
    expect(
      problems.filter((p) => p.startsWith("bin: node_modules/abbrev ")),
    ).toHaveLength(1);
  });

  it("reports a package.json that is not an object", async () => {
    const dir = fixtureCopy();
    writeFileSync(manifest(dir), "[]\n");
    expect(await check(dir)).toContain(
      "census: node_modules/abbrev/package.json is not a JSON object",
    );
  });

  it("reports a check that throws after loading", async () => {
    const broken = {
      get inventory() {
        throw new Error("inventory unavailable");
      },
    };
    const arborist = () => ({
      loadActual: async () => broken,
      loadVirtual: async () => broken,
    });
    const { problems } = await installHealth(clean, { arborist });
    expect(problems.at(-1)).toMatch(
      /^the install could not be checked: .*inventory unavailable$/,
    );
  });
}, 30_000);

describe("Windows .bin shims written by npm", () => {
  const judged = async (dir) => {
    const { packages, bins } = census(dir);
    return binProblems(dir, packages, bins);
  };

  it.runIf(win)("passes the fixture's shims", async () => {
    expect(await judged(clean)).toEqual([]);
  });

  it.runIf(win)("fails each shim with one byte appended", async () => {
    const dir = fixtureCopy();
    const names = ["node-which", "node-which.cmd", "node-which.ps1"];
    for (const name of names) {
      const file = nm(dir, ".bin", name);
      writeFileSync(
        file,
        Buffer.concat([readFileSync(file), Buffer.from(" ")]),
      );
    }
    expect(await judged(dir)).toEqual(
      names.map(
        (name) =>
          `bin: node_modules/.bin/${name} is not the shim npm writes for its declared target`,
      ),
    );
  });

  it.runIf(win)(
    "fails a declared target reached through a junction",
    async () => {
      const dir = fixtureCopy();
      const which = nm(dir, "which");
      renameSync(join(which, "bin"), join(which, "real"));
      link(join(which, "real"), join(which, "bin"));
      expect(await check(dir)).toContain(
        "bin: node_modules/.bin/node-which.cmd has a declared target path through a link",
      );
    },
  );
}, 30_000);

const ALPHA = "node_modules/alpha";
const BETA = "node_modules/beta";
const GAMMA = "node_modules/gamma";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const script = (who) => `#!/usr/bin/env node\nconsole.log("${who}");\n`;
const sri = (name) => `sha512-${name.slice(0, 1).toUpperCase().repeat(86)}==`;
const spec = (location, bin = { tool: "cli.js" }) => {
  const name = location.split("/").pop();
  return { location, name, bin, files: { "cli.js": script(name) } };
};
const declarer = (location) => {
  const name = location.split("/").pop();
  return {
    path: location,
    name,
    version: "1.0.0",
    integrity: sri(name),
    target: "cli.js",
    targetSha256: sha256(script(name)),
  };
};
const record = (bin = "tool", paths = [ALPHA, BETA]) => ({
  bin,
  declarers: paths.map(declarer),
  winner: paths[0],
  reason: "Both packages are needed and this winner is reviewed.",
});

describe("bin collision record", () => {
  const faulty = (edit) => {
    const records = [record()];
    return binCollisions(edit(records) ?? records).problems;
  };
  const at = (message) => [`bin-collisions.json[0]: ${message}`];
  const lineSeparator = String.fromCodePoint(0x2028);
  const path = '"path" must be a canonical package location';
  const target = '"target" must be a canonical package-relative target';

  it("accepts a valid record and an empty file", () => {
    expect(binCollisions([record()]).problems).toEqual([]);
    expect(binCollisions([])).toEqual({ problems: [], collisions: new Map() });
  });

  it.each([
    [
      "a file that is not an array",
      () => ({}),
      ["bin-collisions.json: must be an array"],
    ],
    ["a record that is not an object", () => [null], at("must be an object")],
    [
      "a missing key",
      (r) => void delete r[0].reason,
      at('is missing "reason"'),
    ],
    [
      "an unknown key",
      (r) => void (r[0].note = "x"),
      at('has unknown key "note"'),
    ],
    [
      "a single declarer",
      (r) => void r[0].declarers.pop(),
      at('"declarers" must list two or more packages'),
    ],
    [
      "declarers that are not a list",
      (r) => void (r[0].declarers = {}),
      at('"declarers" must list two or more packages'),
    ],
    [
      "a declarer missing a key",
      (r) => void delete r[0].declarers[1].targetSha256,
      at('declarers[1] is missing "targetSha256"'),
    ],
    [
      "a declarer with an unknown key",
      (r) => void (r[0].declarers[0].bin = "tool"),
      at('declarers[0] has unknown key "bin"'),
    ],
    [
      "a declarer field of the wrong type",
      (r) => void (r[0].declarers[0].version = 1),
      at('declarers[0] "version" must be a string'),
    ],
    [
      "a path with a parent component",
      (r) => void (r[0].declarers[1].path = "node_modules/alpha/../beta"),
      at(`declarers[1] ${path}`),
    ],
    [
      "a path with a backslash",
      (r) => void (r[0].declarers[1].path = "node_modules/be\\ta"),
      at(`declarers[1] ${path}`),
    ],
    [
      "a path with a drive",
      (r) => void (r[0].declarers[1].path = "node_modules/c:beta"),
      at(`declarers[1] ${path}`),
    ],
    [
      "a path with an empty component",
      (r) => void (r[0].declarers[1].path = "node_modules//beta"),
      at(`declarers[1] ${path}`),
    ],
    [
      "an empty name",
      (r) => void (r[0].declarers[1].name = ""),
      at('declarers[1] "name" must not be empty'),
    ],
    [
      "a version range",
      (r) => void (r[0].declarers[1].version = "^1.0.0"),
      at('declarers[1] "version" must be an exact version'),
    ],
    [
      "an integrity of another form",
      (r) => void (r[0].declarers[1].integrity = "sha1-abc="),
      at('declarers[1] "integrity" must be one sha512 integrity'),
    ],
    [
      "a target npm would rewrite",
      (r) => void (r[0].declarers[1].target = "./cli.js"),
      at(`declarers[1] ${target}`),
    ],
    [
      "a target above the package",
      (r) => void (r[0].declarers[1].target = "../cli.js"),
      at(`declarers[1] ${target}`),
    ],
    [
      "a target with a backslash",
      (r) => void (r[0].declarers[1].target = "bin\\cli.js"),
      at(`declarers[1] ${target}`),
    ],
    [
      "an upper-case hash",
      (r) => void (r[0].declarers[1].targetSha256 = sha256("x").toUpperCase()),
      at('declarers[1] "targetSha256" must be 64 lowercase hex characters'),
    ],
    [
      "unsorted declarers",
      (r) => void r[0].declarers.reverse(),
      at('"declarers" must be unique and sorted by path'),
    ],
    [
      "duplicate declarers",
      (r) => void (r[0].declarers[1] = r[0].declarers[0]),
      at('"declarers" must be unique and sorted by path'),
    ],
    [
      "declarers in two .bin directories",
      (r) =>
        void (r[0].declarers[1].path = "node_modules/alpha/node_modules/beta"),
      at('"declarers" must share one .bin directory'),
    ],
    [
      "a winner outside the declarers",
      (r) => void (r[0].winner = GAMMA),
      at('"winner" must be the path of one declarer'),
    ],
    [
      "a blank reason",
      (r) => void (r[0].reason = " "),
      at('"reason" must be one non-blank line'),
    ],
    [
      "a reason over two lines",
      (r) => void (r[0].reason = "a\nb"),
      at('"reason" must be one non-blank line'),
    ],
    [
      "a reason with a line separator",
      (r) => void (r[0].reason = `a${lineSeparator}b`),
      at('"reason" must be one non-blank line'),
    ],
    [
      "unsorted records",
      () => [record("zz"), record()],
      [
        "bin-collisions.json[1]: node_modules/.bin/tool is not sorted after node_modules/.bin/zz",
      ],
    ],
    [
      "duplicate records",
      () => [record(), record()],
      ["bin-collisions.json[1]: duplicate record for node_modules/.bin/tool"],
    ],
  ])("fails %s", (_, edit, problems) => {
    expect(faulty(edit)).toEqual(problems);
  });

  it.each([["../tool"], ["CON"], ["a/b"], [7]])(
    "fails the bin name %s",
    (bin) => {
      expect(faulty((r) => void (r[0].bin = bin))).toEqual([
        expect.stringContaining(
          'bin-collisions.json[0]: "bin" must be an allowed bin name: ',
        ),
      ]);
    },
  );
});

describe.each(["linux", "win32"])(
  "recorded bin collisions judged as %s",
  (platform) => {
    const windows = platform === "win32";
    const suffixes = windows ? ["", ".cmd", ".ps1"] : [""];

    // Hand-built and judged explicitly, so both judgements run on every host.
    async function collided(
      specs = [spec(ALPHA), spec(BETA)],
      records = [record()],
    ) {
      cases += 1;
      const dir = join(base, `collision case ${String(cases)}`);
      const packages = new Map();
      const lock = {};
      const add = ({ location, name, bin, files }) => {
        const path = join(dir, ...location.split("/"));
        for (const [file, text] of Object.entries(files)) {
          mkdirSync(dirname(join(path, file)), { recursive: true });
          writeFileSync(join(path, file), text);
        }
        packages.set(location, { path, pkg: { name, version: "1.0.0", bin } });
        lock[location] = { version: "1.0.0", integrity: sri(name), bin };
      };
      for (const s of specs) add(s);
      const options = () => {
        const recorded = binCollisions(records);
        return {
          problems: recorded.problems,
          collisions: recorded.collisions,
          lock,
        };
      };
      const expected = expectedBins(dir, packages, [], platform, options());
      const cmdShim = windows ? npmCmdShim() : undefined;
      const write = async (binDir, owner) => {
        const target = resolve(owner.path, owner.declared);
        if (windows) return cmdShim(target, owner.to);
        const entry = join(binDir, basename(owner.to));
        symlinkSync(relative(binDir, target), entry);
        links.push(entry);
        return undefined;
      };
      for (const [binDir, want] of expected) {
        mkdirSync(binDir, { recursive: true });
        const owners = new Map([...want.values()].map((o) => [o.to, o]));
        for (const owner of owners.values()) await write(binDir, owner);
      }
      const bins = [...expected.keys()];
      const judge = async () => {
        const { problems, ...rest } = options();
        return [
          ...problems,
          ...(await binProblems(dir, packages, bins, platform, rest)),
        ];
      };
      const pkgAt = (location) => packages.get(location);
      return { dir, lock, records, add, judge, pkgAt, write };
    }

    const bound = (location, fault) =>
      `bin: node_modules/.bin/tool recorded declarer ${location} ${fault}`;

    it("passes the recorded winner's complete entries", async () => {
      const { judge } = await collided();
      expect(await judge()).toEqual([]);
    });

    it("fails an unrecorded collision", async () => {
      const { records, judge } = await collided();
      records.length = 0;
      expect(await judge()).toContain(
        "bin: node_modules/.bin/tool is declared by node_modules/alpha and node_modules/beta; collision not modelled",
      );
    });

    it("fails an additional declarer", async () => {
      const { add, judge } = await collided();
      add(spec(GAMMA));
      expect(await judge()).toContain(
        "bin: node_modules/.bin/tool is declared by node_modules/alpha and node_modules/beta and node_modules/gamma; the record names node_modules/alpha and node_modules/beta",
      );
    });

    it("fails a recorded declarer that is not installed", async () => {
      const { records, judge } = await collided();
      records[0] = record("tool", [ALPHA, BETA, GAMMA]);
      expect(await judge()).toContain(
        "bin: node_modules/.bin/tool is declared by node_modules/alpha and node_modules/beta; the record names node_modules/alpha and node_modules/beta and node_modules/gamma",
      );
    });

    it("fails a replaced declarer", async () => {
      const { records, judge } = await collided();
      records[0] = record("tool", [ALPHA, GAMMA]);
      expect(await judge()).toContain(
        "bin: node_modules/.bin/tool is declared by node_modules/alpha and node_modules/beta; the record names node_modules/alpha and node_modules/gamma",
      );
    });

    it("fails a stale record once the collision is gone", async () => {
      const { pkgAt, judge } = await collided();
      pkgAt(BETA).pkg = { name: "beta", version: "1.0.0" };
      expect(await judge()).toEqual([
        "bin: the record for node_modules/.bin/tool matches 0 collisions, not one",
      ]);
    });

    it("keeps the same bin at an unrelated level separate", async () => {
      const nested = `${ALPHA}/node_modules/gamma`;
      const { judge } = await collided([spec(ALPHA), spec(nested), spec(BETA)]);
      expect(await judge()).toEqual([]);
    });

    it("fails an unrecorded collision at another level", async () => {
      const one = `${ALPHA}/node_modules/gamma`;
      const two = `${ALPHA}/node_modules/delta`;
      const { judge } = await collided([
        spec(ALPHA),
        spec(two),
        spec(one),
        spec(BETA),
      ]);
      const problems = await judge();
      expect(problems).toContain(
        `bin: node_modules/alpha/node_modules/.bin/tool is declared by ${two} and ${one}; collision not modelled`,
      );
      expect(
        problems.filter((p) => p.startsWith("bin: node_modules/.bin/tool")),
      ).toEqual([]);
    });

    describe.each([ALPHA, BETA])("binding of %s", (location) => {
      const name = location.split("/").pop();
      const folder = (dir) => join(dir, ...location.split("/"));

      it("fails installed-only version drift", async () => {
        const { pkgAt, judge } = await collided();
        pkgAt(location).pkg.version = "1.0.1";
        expect(await judge()).toContain(
          bound(
            location,
            'has installed version "1.0.1", not the recorded "1.0.0"',
          ),
        );
      });

      it("fails lock-only version drift", async () => {
        const { lock, judge } = await collided();
        lock[location].version = "1.0.1";
        expect(await judge()).toContain(
          bound(location, 'has lock version "1.0.1", not the recorded "1.0.0"'),
        );
      });

      it("fails installed and lock drift against an unchanged record", async () => {
        const { pkgAt, lock, judge } = await collided();
        pkgAt(location).pkg.version = "1.0.1";
        lock[location].version = "1.0.1";
        const problems = await judge();
        expect(problems).toContain(
          bound(
            location,
            'has installed version "1.0.1", not the recorded "1.0.0"',
          ),
        );
        expect(problems).toContain(
          bound(location, 'has lock version "1.0.1", not the recorded "1.0.0"'),
        );
      });

      it("fails installed name drift", async () => {
        const { pkgAt, judge } = await collided();
        pkgAt(location).pkg.name = "other";
        expect(await judge()).toContain(
          bound(
            location,
            `has installed name "other", not the recorded "${name}"`,
          ),
        );
      });

      it("fails lock name drift", async () => {
        const { lock, judge } = await collided();
        lock[location].name = "other";
        expect(await judge()).toContain(
          bound(location, `has lock name "other", not the recorded "${name}"`),
        );
      });

      it("fails integrity drift, no integrity and no lock entry", async () => {
        const { lock, judge } = await collided();
        lock[location].integrity = sri("z");
        expect(await judge()).toContain(
          bound(
            location,
            `has lock integrity "${sri("z")}", not the recorded "${sri(name)}"`,
          ),
        );
        delete lock[location].integrity;
        expect(await judge()).toContain(
          bound(location, "has no lock integrity"),
        );
        delete lock[location];
        expect(await judge()).toContain(bound(location, "has no lock entry"));
      });

      it("fails a target spelled differently on disk", async () => {
        const { dir, judge } = await collided();
        renameSync(join(folder(dir), "cli.js"), join(folder(dir), "CLI.JS"));
        expect(await judge()).toContain(
          bound(location, "has a declared target not spelled cli.js on disk"),
        );
      });

      it("fails an intermediate directory spelled differently on disk", async () => {
        const nested = (at) => ({
          ...spec(at, { tool: "lib/cli.js" }),
          files: { "lib/cli.js": script(at.split("/").pop()) },
        });
        const records = [record()];
        for (const d of records[0].declarers) d.target = "lib/cli.js";
        const { dir, judge } = await collided(
          [nested(ALPHA), nested(BETA)],
          records,
        );
        expect(await judge()).toEqual([]);
        renameSync(join(folder(dir), "lib"), join(folder(dir), "LIB"));
        expect(await judge()).toContain(
          bound(location, "has a declared target not spelled lib on disk"),
        );
      });

      it("fails locked and declared target drift", async () => {
        const { pkgAt, lock, dir, judge } = await collided();
        writeFileSync(join(folder(dir), "other.js"), script(name));
        lock[location].bin = { tool: "other.js" };
        expect(await judge()).toContain(
          bound(
            location,
            'has lock bin target "other.js", not the recorded "cli.js"',
          ),
        );
        pkgAt(location).pkg.bin = { tool: "other.js" };
        expect(await judge()).toContain(
          bound(
            location,
            'has declared target "other.js", not the recorded "cli.js"',
          ),
        );
      });

      it("fails a changed target byte", async () => {
        const { dir, judge } = await collided();
        appendFileSync(join(folder(dir), "cli.js"), " ");
        const now = sha256(`${script(name)} `);
        expect(await judge()).toContain(
          bound(
            location,
            `has target SHA-256 "${now}", not the recorded "${sha256(script(name))}"`,
          ),
        );
      });
    });

    describe("losing target", () => {
      const loser = (dir) => join(dir, "node_modules", "beta", "cli.js");

      it("fails a missing loser target", async () => {
        const { dir, judge } = await collided();
        unlinkSync(loser(dir));
        expect(await judge()).toContain(
          bound(BETA, "has a declared target that cannot be read: ENOENT"),
        );
      });

      it("fails a loser target that is a link inside its package", async () => {
        const { dir, judge } = await collided();
        renameSync(loser(dir), join(dirname(loser(dir)), "real.js"));
        symlinkSync("real.js", loser(dir));
        links.push(loser(dir));
        expect(await judge()).toContain(
          bound(BETA, "has a declared target path through a link"),
        );
      });

      it("fails a loser target that escapes its package", async () => {
        const { dir, judge } = await collided();
        unlinkSync(loser(dir));
        symlinkSync(join("..", "alpha", "cli.js"), loser(dir));
        links.push(loser(dir));
        expect(await judge()).toContain(
          bound(BETA, "has a declared target path through a link"),
        );
      });

      it("fails a loser target reached through an intermediate junction", async () => {
        const nested = (at) => ({
          ...spec(at, { tool: "lib/cli.js" }),
          files: { "lib/cli.js": script(at.split("/").pop()) },
        });
        const records = [record()];
        for (const d of records[0].declarers) d.target = "lib/cli.js";
        const { dir, judge } = await collided(
          [nested(ALPHA), nested(BETA)],
          records,
        );
        expect(await judge()).toEqual([]);
        const lib = join(dirname(loser(dir)), "lib");
        const real = join(dirname(loser(dir)), "real");
        renameSync(lib, real);
        symlinkSync(real, lib, "junction");
        links.push(lib);
        expect(await judge()).toContain(
          bound(BETA, "has a declared target path through a link"),
        );
      });

      it("fails a loser target that is not a regular file", async () => {
        const { dir, judge } = await collided();
        unlinkSync(loser(dir));
        mkdirSync(loser(dir));
        expect(await judge()).toContain(
          bound(BETA, "has a declared target that is not a regular file"),
        );
      });
    });

    it("admits no owner while any binding fails", async () => {
      const { pkgAt, judge } = await collided();
      pkgAt(BETA).pkg.version = "1.0.1";
      expect(await judge()).toEqual([
        bound(BETA, 'has installed version "1.0.1", not the recorded "1.0.0"'),
        "bin: node_modules/.bin has no expected entries",
        ...suffixes.map(
          (s) => `bin: node_modules/.bin/tool${s} is not expected`,
        ),
      ]);
    });

    it("fails a missing winner entry", async () => {
      const { dir, judge } = await collided();
      unlinkSync(nm(dir, ".bin", "tool"));
      expect(await judge()).toEqual(["bin: node_modules/.bin/tool is missing"]);
    });

    it.runIf(!windows)("fails a link to the losing target", async () => {
      const { dir, judge } = await collided();
      const entry = nm(dir, ".bin", "tool");
      unlinkSync(entry);
      symlinkSync(join("..", "beta", "cli.js"), entry);
      links.push(entry);
      expect(await judge()).toEqual([
        "bin: node_modules/.bin/tool does not point at its declared target",
      ]);
    });

    it.runIf(!windows)(
      "fails an absolute link to the winner's target",
      async () => {
        const { dir, judge } = await collided();
        const entry = nm(dir, ".bin", "tool");
        unlinkSync(entry);
        symlinkSync(nm(dir, "alpha", "cli.js"), entry);
        links.push(entry);
        expect(await judge()).toEqual([
          "bin: node_modules/.bin/tool does not point at its declared target",
        ]);
      },
    );

    it.runIf(windows).each([[[""]], [[".cmd"]], [[".ps1"]], [suffixes]])(
      "fails genuine loser shims in place of %j",
      async (replaced) => {
        const { dir, pkgAt, judge, write } = await collided();
        const bin = nm(dir, ".bin");
        const kept = new Map(
          suffixes.map((s) => [s, readFileSync(join(bin, `tool${s}`))]),
        );
        const loser = { ...pkgAt(BETA), declared: "cli.js" };
        await write(bin, { ...loser, to: join(bin, "tool") });
        for (const s of suffixes)
          if (!replaced.includes(s))
            writeFileSync(join(bin, `tool${s}`), kept.get(s));
        expect(await judge()).toEqual(
          replaced.map(
            (s) =>
              `bin: node_modules/.bin/tool${s} is not the shim npm writes for its declared target`,
          ),
        );
      },
    );
  },
  30_000,
);

describe("overlaps no record admits", () => {
  function overlapping(alphaBin, betaBin, attempt, platform = "win32") {
    cases += 1;
    const dir = join(base, `overlap case ${String(cases)}`);
    const packages = new Map();
    const lock = {};
    for (const [location, bin] of [
      [ALPHA, alphaBin],
      [BETA, betaBin],
    ]) {
      const name = location.split("/").pop();
      const path = join(dir, ...location.split("/"));
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "cli.js"), script(name));
      packages.set(location, { path, pkg: { name, version: "1.0.0", bin } });
      lock[location] = { version: "1.0.0", integrity: sri(name), bin };
    }
    const recorded = binCollisions(attempt === null ? [] : [record(attempt)]);
    const problems = [];
    expectedBins(dir, packages, problems, platform, {
      collisions: recorded.collisions,
      lock,
    });
    return [...recorded.problems, ...problems];
  }

  const unused =
    "bin: the record for node_modules/.bin/tool matches 0 collisions, not one";

  describe.each(["win32", "linux"])(
    "case-only names judged as %s",
    (platform) => {
      it.each([
        [
          "across packages",
          { Tool: "cli.js" },
          { tool: "cli.js" },
          "alpha and node_modules/beta",
          "Tool and tool",
        ],
        [
          "within one package",
          { TOOL: "cli.js", tool: "cli.js" },
          { tool: "cli.js" },
          "alpha and node_modules/beta",
          "TOOL and tool",
        ],
      ])("fails %s with and without a record", (_, alpha, beta, by, pair) => {
        const fault = `bin: node_modules/.bin has ${pair}, which differ only by case, declared by node_modules/${by}`;
        expect(overlapping(alpha, beta, "tool", platform)).toEqual([
          fault,
          unused,
        ]);
        expect(overlapping(alpha, beta, null, platform)).toEqual([fault]);
      });
    },
  );

  it("fails a bin named like another bin's shim even with a record", () => {
    expect(
      overlapping({ tool: "cli.js" }, { "tool.cmd": "cli.js" }, "tool.cmd"),
    ).toEqual([
      "bin: node_modules/.bin/tool.cmd is declared by node_modules/alpha and node_modules/beta; collision not modelled",
      "bin: the record for node_modules/.bin/tool.cmd matches 0 collisions, not one",
    ]);
  });
});

describe("the real playwright collision installed by npm", () => {
  const installs = [];
  const expectedEntries = win
    ? [
        "playwright",
        "playwright-core",
        "playwright-core.cmd",
        "playwright-core.ps1",
        "playwright.cmd",
        "playwright.ps1",
      ]
    : ["playwright", "playwright-core"];

  // Three independent clean installs from the cache, with no browser download.
  it.each([1, 2, 3])(
    "clean install %i admits the recorded winner and nothing else",
    async (n) => {
      const dir = join(base, `playwright install ${String(n)}`);
      mkdirSync(dir);
      buildPlaywrightFixture(dir);
      installs.push(dir);
      expect((await installHealth(dir)).problems).toEqual([]);
      const bin = nm(dir, ".bin");
      expect(readdirSync(bin).sort()).toEqual(expectedEntries);
      if (win)
        expect(readFileSync(join(bin, "playwright.cmd"), "utf8")).toContain(
          String.raw`\@playwright\test\cli.js`,
        );
      else
        expect(readlinkSync(join(bin, "playwright"))).toBe(
          "../@playwright/test/cli.js",
        );
    },
    180_000,
  );

  const copy = () => {
    cases += 1;
    const dir = join(base, `case${String(cases)}`);
    cpSync(installs[0], dir, { recursive: true, verbatimSymlinks: true });
    return dir;
  };

  it("fails without the record file", async () => {
    const dir = copy();
    unlinkSync(join(dir, "bin-collisions.json"));
    const problems = await check(dir);
    expect(problems).toContain("bin-collisions.json is missing");
    expect(problems).toContain(
      "bin: node_modules/.bin/playwright is declared by node_modules/@playwright/test and node_modules/playwright; collision not modelled",
    );
  });

  it("fails a malformed record file", async () => {
    const dir = copy();
    writeFileSync(join(dir, "bin-collisions.json"), "[");
    expect(await check(dir)).toContain(
      "bin-collisions.json is not valid JSON: Unexpected end of JSON input",
    );
  });

  it.each([
    [
      "a duplicate winner key",
      (t) =>
        t.replace(
          '"winner": ',
          '"winner": "node_modules/playwright",\n    "winner": ',
        ),
    ],
    [
      "a duplicate target key in a declarer",
      (t) =>
        t.replace('"target": ', '"target": "other.js",\n        "target": '),
    ],
    [
      "an escaped duplicate winner key",
      (t) =>
        t.replace(
          '"winner": ',
          String.raw`"winner": "node_modules/playwright",` + '\n    "winner": ',
        ),
    ],
    ["trailing whitespace", (t) => `${t} \n`],
    ["extra whitespace", (t) => t.replace('"bin": ', '"bin":  ')],
  ])("fails a record file with %s", async (_, edit) => {
    const dir = copy();
    const file = join(dir, "bin-collisions.json");
    const text = readFileSync(file, "utf8");
    const edited = edit(text);
    expect(edited).not.toBe(text);
    expect(JSON.parse(edited)).toEqual(JSON.parse(text));
    writeFileSync(file, edited);
    const problems = await check(dir);
    expect(problems).toContain("bin-collisions.json is not in canonical form");
    expect(problems).toContain(
      "bin: node_modules/.bin/playwright is declared by node_modules/@playwright/test and node_modules/playwright; collision not modelled",
    );
  });

  it("fails a record whose version the install does not match", async () => {
    const dir = copy();
    const file = join(dir, "bin-collisions.json");
    const records = JSON.parse(readFileSync(file, "utf8"));
    records[0].declarers[1].version = "1.64.0";
    writeJson(file, records);
    const problems = await check(dir);
    for (const where of ["installed", "lock"])
      expect(problems).toContain(
        `bin: node_modules/.bin/playwright recorded declarer node_modules/playwright has ${where} version "1.65.0", not the recorded "1.64.0"`,
      );
  });
}, 30_000);
