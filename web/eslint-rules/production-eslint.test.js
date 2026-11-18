// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, fixture, link } from "../build-guard/fixture.js";
import {
  copiedPaths,
  copyProblems,
  manifest,
  manifestChanges,
  outputFolders,
  outputPrefixes,
  probeProject,
  removeOwned,
  web,
} from "./production-eslint.js";

afterAll(cleanUp);

const names = ["Probe.tsx", "TypedProbe.ts"];
const none = { added: [], removed: [], changed: [] };
const real = realpathSync.native(web);
const fatal = async (project, name) =>
  JSON.parse(
    (
      await project.lintText(
        "export const x = 1;\n",
        project.probe(name),
        "json",
      )
    ).output,
  )[0].messages.filter((m) => m.fatal);
// A copy made the plain way, for the rows that damage one on purpose.
const plainCopy = () => {
  const paths = copiedPaths();
  const { root } = fixture(
    Object.fromEntries(paths.map((p) => [p, readFileSync(join(web, p))])),
    { tokens: false, helpers: false },
  );
  return { root, paths };
};

// Each project starts a runner that loads the production configuration cold.
describe("probe copies", () => {
  it("lints every probe in its own copy and leaves the real tree as it was", async () => {
    const before = manifest(join(web, "src"));
    const project = probeProject("Policy", names);
    for (const { path } of project.record.written) {
      const at = realpathSync.native(join(project.base, path));
      expect(at.startsWith(project.base + sep)).toBe(true);
      expect(at.startsWith(real + sep)).toBe(false);
    }
    expect(await fatal(project, "TypedProbe.ts")).toEqual([]);
    await project.teardown();
    expect(existsSync(project.base)).toBe(false);
    expect(manifestChanges(before, manifest(join(web, "src")))).toEqual(none);
  }, 120_000);

  it("finds a hard-linked file in a copy", () => {
    const { root, paths } = plainCopy();
    const config = join(root, "eslint.config.js");
    unlinkSync(config);
    // A hard link cannot cross devices, so where the temporary folder is on another device the
    // link joins a second name in the copy instead of the original.
    const shared = statSync(web).dev === statSync(root).dev;
    const other = shared
      ? join(web, "eslint.config.js")
      : join(root, "config-twin.js");
    if (!shared)
      writeFileSync(other, readFileSync(join(web, "eslint.config.js")));
    linkSync(other, config);
    expect(copyProblems(root, paths)).toEqual(
      shared
        ? [
            "eslint.config.js: 2 links",
            "eslint.config.js: the original file itself",
          ]
        : ["eslint.config.js: 2 links"],
    );
  });

  it("finds a folder linked in place of a copied one", () => {
    const { root, paths } = plainCopy();
    rmSync(join(root, "src"), { recursive: true });
    link(join(web, "src"), join(root, "src"));
    const found = copyProblems(root, paths);
    const src = paths.filter((p) => p.startsWith("src/"));
    expect(found).toEqual(
      src.flatMap((p) => [
        `${p}: web/src is a link`,
        `${p}: the original file itself`,
        `${p}: resolves outside the copy`,
      ]),
    );
  });

  it("refuses an altered copy of the configuration", () => {
    const { root, paths } = plainCopy();
    writeFileSync(join(root, "eslint.config.js"), "export default [];\n");
    expect(copyProblems(root, paths)).toEqual([
      "eslint.config.js: differs from the original",
    ]);
  });

  it("leaves an abandoned copy to its owner and still runs", async () => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    const helper = pathToFileURL(
      join(import.meta.dirname, "production-eslint.js"),
    );
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { probeCopy } from ${JSON.stringify(helper.href)};
console.log(probeCopy("Policy", ${JSON.stringify(names)}).base);`,
      ],
      { encoding: "utf8", env, timeout: 60_000 },
    );
    expect([child.status, child.stderr]).toEqual([0, ""]);
    const left = child.stdout.trim();
    const owner = readFileSync(join(left, "owner.json"));
    expect(JSON.parse(owner).pid).toBe(child.pid);
    const kept = manifest(left);
    const before = manifest(join(web, "src"));
    const project = probeProject("Policy", names);
    expect(project.base).not.toBe(left);
    expect(await fatal(project, "Probe.tsx")).toEqual([]);
    await project.teardown();
    expect(readFileSync(join(left, "owner.json"))).toEqual(owner);
    expect(manifestChanges(kept, manifest(left))).toEqual(none);
    expect(manifestChanges(before, manifest(join(web, "src")))).toEqual(none);
    removeOwned(left, JSON.parse(owner));
    expect(existsSync(left)).toBe(false);
  }, 120_000);

  // The child replaces one fs function before the copy starts; at the planted target it reads
  // the record from disk, then throws, so the copy fails at one known point.
  const files = copiedPaths().length;
  it.each([["a probe", "writeFileSync", "web/src/PolicyProbe.tsx", files]])(
    "removes a copy that fails at %s, through the record it wrote first",
    (_, fn, target, recorded) => {
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      const helper = pathToFileURL(
        join(import.meta.dirname, "production-eslint.js"),
      );
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { sep } from "node:path";
const { probeCopy } = await import(${JSON.stringify(helper.href)});
const fn = ${JSON.stringify(fn)};
const target = ${JSON.stringify(target)};
const real = fs[fn];
let seen = null;
fs[fn] = (...args) => {
  const parts = args[fn === "symlinkSync" ? 1 : 0].split(sep);
  const at = parts.findIndex((part) => part.startsWith("sl-probe-"));
  if (parts.slice(at + 1).join("/") !== target) return real(...args);
  const base = parts.slice(0, at + 1).join(sep);
  const record = JSON.parse(fs.readFileSync(base + sep + "owner.json", "utf8"));
  seen = { base, pid: record.pid, folders: record.folders, written: record.written.length };
  throw new Error("planted fault at " + target);
};
syncBuiltinESMExports();
let message = "no fault";
try {
  probeCopy("Policy", ${JSON.stringify(names)});
} catch (error) {
  message = error.message;
}
console.log(JSON.stringify({ seen, message, left: seen !== null && fs.existsSync(seen.base) }));`,
        ],
        { encoding: "utf8", env, timeout: 60_000 },
      );
      expect([child.status, child.stderr]).toEqual([0, ""]);
      const { seen, message, left } = JSON.parse(child.stdout);
      expect(message).toBe(`planted fault at ${target}`);
      expect(seen.pid).toBe(child.pid);
      expect(seen.folders).toContain("web");
      expect(seen.written).toBe(recorded);
      expect(left).toBe(false);
      expect(existsSync(seen.base)).toBe(false);
    },
    60_000,
  );
});

describe("the protected-tree manifest", () => {
  const checkout = () => {
    const top = realpathSync.native(mkdtempSync(join(tmpdir(), "sl-tree-")));
    for (const [path, text] of Object.entries({
      "web/eslint.config.js": "export default [];\n",
      "web/src/App.tsx": "export {};\n",
      "web/dist/index.js": "export {};\n",
      "api/SharpLadder.Api/Program.cs": "return;\n",
    })) {
      mkdirSync(join(top, path, ".."), { recursive: true });
      writeFileSync(join(top, path), text);
    }
    return top;
  };
  const put = (top, path, text) => {
    mkdirSync(join(top, path, ".."), { recursive: true });
    writeFileSync(join(top, path), text);
  };
  const tops = [];
  afterAll(() => {
    for (const top of tops) rmSync(top, { recursive: true, force: true });
  });
  const changed = (change) => {
    const top = checkout();
    tops.push(top);
    const before = manifest(top);
    change(top);
    return manifestChanges(before, manifest(top));
  };

  it("names a new source file and an edited configuration", () => {
    expect(
      changed((top) => {
        put(top, "web/src/New.tsx", "export {};\n");
        put(top, "web/eslint.config.js", "export default [{}];\n");
      }),
    ).toEqual({
      added: ["web/src/New.tsx"],
      removed: [],
      changed: ["web/eslint.config.js"],
    });
  });

  it("does not report the output a check run writes", () => {
    expect(
      changed((top) => {
        put(top, "web/dist/more.js", "export {};\n");
        put(top, "web/.cache/vitest/results.json", "{}\n");
        put(top, "api/SharpLadder.Api/bin/Debug/a.dll", "x");
        put(top, "api/SharpLadder.Api/obj/project.assets.json", "{}\n");
      }),
    ).toEqual(none);
  });

  // One exclusion of each kind with a file inside it, a file beside it and a new folder beside it.
  it.each([
    [
      "web/dist/",
      "web/dist/more.js",
      "web/dist-sibling",
      "web/dist-folder/a.txt",
    ],
    [
      "api bin folders",
      "api/SharpLadder.Api/bin/a.dll",
      "api/SharpLadder.Api/bin-sibling",
      "api/SharpLadder.Api/bin-folder/a.txt",
    ],
  ])("detects a change just outside %s", (_, inside, beside, folder) => {
    expect(
      changed((top) => {
        for (const path of [inside, beside, folder]) put(top, path, "x\n");
      }),
    ).toEqual({ ...none, added: [folder, beside] });
  });

  it("reports a new empty folder as a folder", () => {
    expect(
      changed((top) => mkdirSync(join(top, "web", "src", "empty"))),
    ).toEqual({ ...none, added: ["web/src/empty"] });
  });

  it("records a link as a link and never follows it", () => {
    const outside = realpathSync.native(
      mkdtempSync(join(tmpdir(), "sl-tree-")),
    );
    tops.push(outside);
    let linked;
    const result = changed((top) => {
      linked = join(top, "web", "linked");
      symlinkSync(outside, linked, "junction");
      writeFileSync(join(outside, "a.txt"), "x\n");
    });
    // The link goes first, so removing the checkout never reaches through it.
    if (process.platform === "win32") rmdirSync(linked);
    else unlinkSync(linked);
    expect(result).toEqual({ ...none, added: ["web/linked"] });
  });

  it("excludes only the listed output", () => {
    expect(outputPrefixes).toEqual([
      ".git/",
      ".tools/",
      "TestResults/",
      "web/.cache/build-evidence/",
      "web/.cache/playwright/results/",
      "web/.cache/vite/",
      "web/.cache/vitest/",
      "web/dist/",
      "web/node_modules/",
    ]);
    expect(outputFolders).toEqual({ under: "api/", names: ["bin", "obj"] });
  });
});
