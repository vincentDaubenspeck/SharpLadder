// @vitest-environment node
import { spawnSync } from "node:child_process";
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixture, writeJson } from "./install-fixture.js";
import {
  binProblems,
  census,
  censusEquality,
  expectedBins,
  installHealth,
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

function deny(path) {
  const r = win
    ? spawnSync(icacls, [path, "/deny", "*S-1-1-0:(RD)"], {
        encoding: "utf8",
      })
    : spawnSync("chmod", ["000", path], { encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`cannot deny ${path}: ${r.stdout}${r.stderr}`);
  locked.push(path);
}

function allow(path) {
  if (win) spawnSync(icacls, [path, "/remove:d", "*S-1-1-0"]);
  else spawnSync("chmod", ["755", path]);
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "install-census-"));
  clean = join(base, "clean");
  mkdirSync(clean);
  buildFixture(clean);
}, 180_000);

afterAll(() => {
  for (const path of locked) allow(path);
  // Links go before the recursive delete, so it never walks through one.
  for (const path of links) rmSync(path, { force: true });
  if (base) rmSync(base, { recursive: true, force: true });
});

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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

  it("fails two packages declaring one name in one .bin", () => {
    const { packages, bins } = census(clean);
    const abbrev = packages.get("node_modules/abbrev");
    const twin = new Map(packages);
    twin.set("node_modules/abbrev", {
      ...abbrev,
      pkg: { ...abbrev.pkg, bin: { "node-which": "package.json" } },
    });
    expect(binProblems(clean, twin, bins)).toContain(
      "bin: node_modules/.bin/node-which is declared by node_modules/abbrev and node_modules/which; collision not modelled",
    );
  });
});

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
    () => {
      const { packages, bins } = census(clean);
      const which = packages.get("node_modules/which");
      const moved = new Map(packages);
      moved.set("node_modules/which", {
        ...which,
        pkg: { ...which.pkg, bin: { "node-which": "../isexe/index.js" } },
      });
      expect(binProblems(clean, moved, bins)).toContain(
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
    const pointAt = (to) => {
      const entry = join(bin, "example");
      symlinkSync(typeof to === "string" ? to : relative(bin, to.at), entry);
      links.push(entry);
      return binProblems(dir, packages, [bin], "linux").filter((p) =>
        p.startsWith("bin: node_modules/.bin/example "),
      );
    };
    return { dir, pkg, cli, pointAt };
  }

  it("passes the link text bin-links writes", () => {
    const { cli, pointAt } = routed();
    expect(pointAt({ at: cli })).toEqual([]);
  });

  it("fails a link that reaches the declared target through an outside link", () => {
    const { dir, pkg, pointAt } = routed();
    mkdirSync(join(dir, "external"));
    link(join(pkg, "bin"), join(dir, "external", "return"));
    expect(pointAt({ at: join(dir, "external", "return", "cli.js") })).toEqual([
      "bin: node_modules/.bin/example does not point at its declared target",
    ]);
  });

  it("fails a link that leaves node_modules and returns through real folders", () => {
    const { pointAt } = routed();
    expect(
      pointAt(join("..", "..", "node_modules", "example", "bin", "cli.js")),
    ).toEqual([
      "bin: node_modules/.bin/example does not point at its declared target",
    ]);
  });

  it("fails a package folder that is itself a link", () => {
    const { dir, pkg, cli, pointAt } = routed();
    renameSync(pkg, join(dir, "moved"));
    link(join(dir, "moved"), pkg);
    expect(pointAt({ at: cli })).toEqual([
      "bin: node_modules/.bin/example points at its declared target through a link",
    ]);
  });
});
