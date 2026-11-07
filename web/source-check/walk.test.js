// @vitest-environment node
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, link, tree } from "./fixture.js";
import { admitTree, classifyName } from "./walk.js";

afterAll(cleanUp);

const current = {
  "src/App.tsx": "",
  "src/App.test.tsx": "",
  "src/main.tsx": "",
  "src/test-setup.ts": "",
};
const reasons = (base) =>
  Object.fromEntries(
    admitTree(join(base, "src")).rejected.map((r) => [r.path, r.reason]),
  );

describe("source tree admission", () => {
  it("admits the four current files and the stylesheet kinds", () => {
    const base = tree({
      ...current,
      "src/theme/tokens.css": "",
      "src/components/Card.module.css": "",
    });
    const { admitted, rejected } = admitTree(join(base, "src"));
    expect(rejected).toEqual([]);
    expect(admitted.map((f) => f.kind)).toEqual([
      "tsx",
      "tsx",
      "css-module",
      "tsx",
      "ts",
      "css",
    ]);
  });

  it("rejects every name outside the exact lowercase suffixes", () => {
    const base = tree({
      ...current,
      "src/Untested.JS": "",
      "src/x.vue": "",
      "src/.hidden": "",
      "src/LICENSE": "",
      "src/A.TS": "",
      "src/a.CSS": "",
      "src/types.d.ts": "",
      "src/b.js": "",
    });
    expect(reasons(base)).toEqual({
      ".hidden": "dotfile",
      "A.TS": "extension is not lowercase",
      "Untested.JS": "extension is not admitted",
      "a.CSS": "extension is not lowercase",
      "b.js": "extension is not admitted",
      LICENSE: "no extension",
      "types.d.ts": "declaration file (.d.ts) is not admitted",
      "x.vue": "extension is not admitted",
    });
  });

  it("finds a bad file in a nested directory and rejects dot directories", () => {
    const base = tree({
      ...current,
      "src/a/b/bad.mjs": "",
      "src/.cache/x.ts": "",
    });
    expect(reasons(base)).toEqual({
      ".cache": "dot directory",
      "a/b/bad.mjs": "extension is not admitted",
    });
  });

  it("rejects a link to an outside directory without listing its contents", () => {
    const base = tree({ ...current, "outside/evil.ts": "" });
    link(join(base, "outside"), join(base, "src", "linked"));
    const { admitted, rejected } = admitTree(join(base, "src"));
    expect(rejected).toEqual([
      { path: "linked", reason: "symlink or junction" },
    ]);
    expect(admitted.some((f) => f.path.includes("evil"))).toBe(false);
  });

  it("refuses a src that is itself a link", () => {
    const base = tree({ "real/App.tsx": "" });
    link(join(base, "real"), join(base, "src"));
    expect(() => admitTree(join(base, "src"))).toThrow(/not a real directory/u);
  });

  it("throws on an unreadable directory instead of returning a partial listing", () => {
    const base = tree({ ...current, "src/locked/x.ts": "" });
    const readdir = (dir, options) => {
      if (dir.endsWith("locked"))
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      return readdirSync(dir, options);
    };
    expect(() => admitTree(join(base, "src"), { readdir })).toThrow(
      /cannot read src\/locked: EACCES/u,
    );
  });

  it("fails when a queued directory becomes a junction while it is listed", () => {
    const base = tree({ ...current, "src/queued/": "", "outside/evil.ts": "" });
    const readdir = (dir, options) => {
      if (dir.endsWith("queued")) {
        rmdirSync(dir);
        link(join(base, "outside"), dir);
      }
      return readdirSync(dir, options);
    };
    expect(() => admitTree(join(base, "src"), { readdir })).toThrow(
      /src\/queued was replaced by a link or non-directory/u,
    );
  });

  it("fails when a queued directory is replaced before it is listed", () => {
    const base = tree({ ...current, "src/a/": "", "src/b/": "" });
    const readdir = (dir, options) => {
      if (dir.endsWith("b")) {
        rmdirSync(join(dir, "..", "a"));
        mkdirSync(join(dir, "..", "a"));
      }
      return readdirSync(dir, options);
    };
    expect(() => admitTree(join(base, "src"), { readdir })).toThrow(
      /src\/a changed identity/u,
    );
  });

  it("fails when an empty src is replaced while it is listed", () => {
    const base = tree({ "src/": "" });
    const readdir = (dir, options) => {
      rmdirSync(dir);
      mkdirSync(dir);
      return readdirSync(dir, options);
    };
    expect(() => admitTree(join(base, "src"), { readdir })).toThrow(
      /src changed identity/u,
    );
  });
  // The swap lands after the lstat that admits the directory and before its open.
  const swapAtOpen = (name, swap) => (path, flags) => {
    if (path.endsWith(name)) swap(path);
    return openSync(path, flags);
  };
  // Linux refuses the open itself; Windows follows the junction and the second lstat sees it.
  const linkRefused = (at) =>
    new RegExp(
      process.platform === "win32"
        ? `${at} was replaced by a link or non-directory`
        : `cannot open ${at}: ENOTDIR`,
      "u",
    );

  it("fails when a link to another directory is swapped in at admission", () => {
    const base = tree({
      ...current,
      "src/swapped/": "",
      "outside/evil.ts": "",
    });
    const open = swapAtOpen("swapped", (path) => {
      rmdirSync(path);
      link(join(base, "outside"), path);
    });
    expect(() => admitTree(join(base, "src"), { open })).toThrow(
      linkRefused("src/swapped"),
    );
  });

  it("fails when a link back to the same directory is swapped in at admission", () => {
    const base = tree({ ...current, "src/swapped/x.ts": "" });
    const open = swapAtOpen("swapped", (path) => {
      renameSync(path, `${path}2`);
      link(`${path}2`, path);
    });
    expect(() => admitTree(join(base, "src"), { open })).toThrow(
      linkRefused("src/swapped"),
    );
  });

  // The swap lands after the lstat that first sees src and before it is canonicalised.
  const swapAtFirstLstat = (swap) => {
    let first = true;
    return (path, options) => {
      const stat = lstatSync(path, options);
      if (first) {
        first = false;
        swap(path);
      }
      return stat;
    };
  };

  it("fails when src is replaced by a new directory at admission", () => {
    const base = tree({ ...current });
    const lstat = swapAtFirstLstat((path) => {
      renameSync(path, `${path}-old`);
      mkdirSync(path);
      writeFileSync(join(path, "substitute.ts"), "");
    });
    expect(() => admitTree(join(base, "src"), { lstat })).toThrow(
      /src changed identity/u,
    );
  });

  it("fails when src is replaced by a link to another directory at admission", () => {
    const base = tree({ ...current, "outside/outside.ts": "" });
    const lstat = swapAtFirstLstat((path) => {
      renameSync(path, `${path}-old`);
      link(join(base, "outside"), path);
    });
    expect(() => admitTree(join(base, "src"), { lstat })).toThrow(
      /src changed identity/u,
    );
  });

  it("fails when src is replaced by a link to itself at admission", () => {
    const base = tree({ ...current });
    const lstat = swapAtFirstLstat((path) => {
      renameSync(path, `${path}-old`);
      link(`${path}-old`, path);
    });
    expect(() => admitTree(join(base, "src"), { lstat })).toThrow(
      /src was replaced by a link or non-directory/u,
    );
  });

  it("fails clearly when no more directories can be held open", () => {
    const base = tree({ ...current, "src/a/": "" });
    const open = (path, flags) => {
      if (path.endsWith("a"))
        throw Object.assign(new Error("too many"), { code: "EMFILE" });
      return openSync(path, flags);
    };
    expect(() => admitTree(join(base, "src"), { open })).toThrow(
      /cannot hold src\/a open: EMFILE; too many open directories, and the walk never falls back/u,
    );
  });
});

describe("held directory handles", () => {
  const tracked = (seams = {}) => {
    const live = new Set();
    return {
      live,
      seams: {
        ...seams,
        open: (path, flags) => {
          const fd = (seams.open ?? openSync)(path, flags);
          live.add(fd);
          return fd;
        },
        close: (fd) => {
          live.delete(fd);
          closeSync(fd);
        },
      },
    };
  };
  const denied = (code) => Object.assign(new Error(code), { code });

  it.each([
    ["success", {}, undefined],
    [
      "a read failure",
      {
        readdir: (dir, options) => {
          if (dir.endsWith("beta")) throw denied("EACCES");
          return readdirSync(dir, options);
        },
      },
      /cannot read src\/beta: EACCES/u,
    ],
    [
      "an open failure with siblings held",
      {
        open: (path, flags) => {
          if (path.endsWith("gamma")) throw denied("ENFILE");
          return openSync(path, flags);
        },
      },
      /cannot hold src\/gamma open: ENFILE/u,
    ],
    [
      "a handle that cannot be inspected",
      {
        fstat: () => {
          throw denied("EIO");
        },
      },
      /cannot inspect src: EIO/u,
    ],
    [
      "a replacement before listing",
      {
        readdir: (dir, options) => {
          if (dir.endsWith("gamma")) {
            rmdirSync(join(dir, "..", "alpha"));
            mkdirSync(join(dir, "..", "alpha"));
          }
          return readdirSync(dir, options);
        },
      },
      /src\/alpha changed identity/u,
    ],
  ])("closes every handle after %s", (_, seams, error) => {
    const base = tree({
      ...current,
      "src/alpha/": "",
      "src/beta/x.ts": "",
      "src/gamma/": "",
    });
    const { live, seams: io } = tracked(seams);
    const walk = () => admitTree(join(base, "src"), io);
    if (error) expect(walk).toThrow(error);
    else expect(walk().admitted).toHaveLength(5);
    expect(live.size).toBe(0);
  });
});

describe("classifyName", () => {
  it.each([
    ["a.ts", "ts"],
    ["a.test.tsx", "tsx"],
    ["a.css", "css"],
    ["a.module.css", "css-module"],
  ])("admits %s as %s", (name, kind) => {
    expect(classifyName(name)).toEqual({ kind });
  });

  it.each([
    "A.D.TS",
    "a.mts",
    "a.cts",
    "a.tsx.bak",
    "a.Ts",
    ".ts",
    "a.module.CSS",
  ])("rejects %s", (name) => {
    expect(classifyName(name).kind).toBeUndefined();
  });
});
