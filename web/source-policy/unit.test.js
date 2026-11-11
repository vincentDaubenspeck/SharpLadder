// @vitest-environment node
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, parse, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanUp, fixture, link } from "../build-guard/fixture.js";
import { sourceIdentity } from "./unit.js";

afterAll(cleanUp);

const windows = process.platform === "win32";
const bare = { modules: false, tokens: false, helpers: false };
// A capital whose lower case is two characters, so a folded path is longer than the real one.
const longer = "İ";
const tree = () =>
  fixture(
    {
      "src/main.tsx": "export {};\n",
      "src/content/href.ts": "export {};\n",
      "src/content/Blocks.tsx": "export {};\n",
      [`src/content/${longer}.ts`]: "export {};\n",
      [`src/content/${longer}/in.ts`]: "export {};\n",
      [`src/${longer}/content/href.ts`]: "export {};\n",
      "../outside/other.ts": "export {};\n",
      "../gone/file.ts": "export {};\n",
    },
    bare,
  );

const { base, root } = tree();
const src = join(root, "src");
const unit = "content/href.ts";
const file = join(src, "content", "href.ts");
// The file system decides whether a second letter case names the same file.
const caseBlind = existsSync(join(src, "CONTENT", "href.ts"));

link(join(src, "content"), join(src, "same"));
link(join(base, "outside"), join(src, "away"));
link(root, join(base, "alias"));
link(join(base, "gone"), join(src, "dangling"));
rmSync(join(base, "gone"), { recursive: true });

// The 8.3 name Windows keeps for a folder, when the volume keeps one.
function shortName(path) {
  if (!windows) return null;
  const done = spawnSync(
    "cmd.exe",
    ["/d", "/c", `for %I in ("${path}") do @echo %~sI`],
    { encoding: "utf8", windowsVerbatimArguments: true },
  );
  const short = done.stdout.trim();
  return done.status === 0 && short !== "" && short !== path ? short : null;
}

describe("a file that exists", () => {
  it("is named by its path under src", () => {
    expect(sourceIdentity(root, file)).toEqual({ unit });
    expect(sourceIdentity(root, join(src, "main.tsx"))).toEqual({
      unit: "main.tsx",
    });
  });

  it.each([
    [`content/${longer}.ts`],
    [`content/${longer}/in.ts`],
    [`${longer}/content/href.ts`],
  ])("keeps every character of a name whose folded form is longer", (named) => {
    expect(longer.toLowerCase()).toHaveLength(2);
    expect(sourceIdentity(root, join(src, ...named.split("/")))).toEqual({
      unit: named,
    });
    const absent = `${named}.absent`;
    expect(sourceIdentity(root, join(src, ...absent.split("/")))).toEqual({
      unit: absent,
    });
  });

  it.each([
    ["dot segments", join(src, "content", "..", ".", "content", "href.ts")],
    ["a folder link inside src", join(src, "same", "href.ts")],
    ["a link to the project", join(base, "alias", "src", "content", "href.ts")],
  ])("is the same file through %s", (_name, spelled) => {
    expect(sourceIdentity(root, spelled)).toEqual({ unit });
  });

  it("is the same file when the project is named through a link", () => {
    const alias = join(base, "alias");
    expect(sourceIdentity(alias, file)).toEqual({ unit });
    expect(
      sourceIdentity(alias, join(alias, "src", "content", "href.ts")),
    ).toEqual({ unit });
  });

  it.runIf(caseBlind).each([
    ["folder", join(src, "CONTENT", "href.ts")],
    ["file", join(src, "content", "HREF.TS")],
    ["src", join(root, "SRC", "Content", "Href.ts")],
  ])("is the same file under another letter case of its %s", (_n, spelled) => {
    expect(sourceIdentity(root, spelled)).toEqual({ unit });
  });

  it.runIf(!caseBlind)(
    "is a different file under another letter case, named as written",
    () => {
      expect(sourceIdentity(root, join(src, "CONTENT", "href.ts"))).toEqual({
        unit: "CONTENT/href.ts",
      });
    },
  );

  it.runIf(windows)("is the same file under Windows spellings", () => {
    const { root: drive } = parse(file);
    const rest = file.slice(drive.length);
    const flipped =
      drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase();
    expect(sourceIdentity(root, flipped + rest)).toEqual({ unit });
    expect(sourceIdentity(root, file.replaceAll("\\", "/"))).toEqual({ unit });
    expect(sourceIdentity(root, `\\\\?\\${file}`)).toEqual({ unit });
    expect(sourceIdentity(`\\\\?\\${root}`, file)).toEqual({ unit });
  });

  it.runIf(windows)("is the same file through an 8.3 short name", () => {
    const short = shortName(join(src, "content"));
    // A volume without short names has no such alias to test.
    if (short === null) return;
    expect(short.toLowerCase()).not.toBe(join(src, "content").toLowerCase());
    expect(sourceIdentity(root, join(short, "href.ts"))).toEqual({ unit });
  });

  it("is the same file when the temp folder is spelled as the system gives it", () => {
    const spelled = join(tmpdir(), basename(base), "web");
    expect(
      sourceIdentity(spelled, join(spelled, "src", "content", "href.ts")),
    ).toEqual({ unit });
  });

  // A share of the same disk may be closed to this user; the file is then refused, never passed.
  it.runIf(windows)("is never an outside file through a network path", () => {
    const { root: drive } = parse(file);
    const share = `\\\\localhost\\${drive[0]}$\\${file.slice(drive.length)}`;
    for (const spelled of [
      share,
      `\\\\?\\UNC\\${share.slice(2)}`,
      `\\\\127.0.0.1\\${share.slice(12)}`,
    ]) {
      const found = sourceIdentity(root, spelled);
      expect(found.unit === unit || found.error !== undefined).toBe(true);
      expect(found.unit === null || found.error === undefined).toBe(true);
    }
  });
});

describe("a name that is not a source name", () => {
  it.each([
    ["a trailing dot", `${file}.`],
    ["a trailing space", `${file} `],
    ["a folder with a trailing dot", join(src, "content.", "href.ts")],
    ["a folder with a trailing space", join(src, "content ", "href.ts")],
    ["a stream of an existing file", `${file}:zone`],
    ["the default stream", `${file}::$DATA`],
    ["a stream of a missing file", join(src, "content", "New.tsx:zone")],
    ["a NUL character", `${file}\0.ts`],
  ])("refuses %s", (_name, spelled) => {
    const found = sourceIdentity(root, spelled);
    expect(found.unit).toBeNull();
    expect(found.error).toMatch(/is not a source name/u);
  });

  it.runIf(windows).each([
    ["a device path", `\\\\.\\${file}`],
    ["a volume path", "\\\\?\\pipe\\name"],
    ["a volume name", "\\\\?\\Volume{0}\\src\\content\\href.ts"],
  ])("refuses %s", (_name, spelled) => {
    expect(sourceIdentity(root, spelled)).toEqual({
      unit: null,
      error: "a device path is not a source location",
    });
  });

  it.runIf(!windows)("refuses a backslash in a name", () => {
    expect(sourceIdentity(root, join(src, "content\\href.ts")).error).toMatch(
      /is not a source name/u,
    );
  });

  it("gives a file outside src no unit", () => {
    expect(sourceIdentity(root, join(base, "outside", "other.ts"))).toEqual({
      unit: null,
    });
    expect(sourceIdentity(root, join(root, "index.html"))).toEqual({
      unit: null,
    });
    expect(sourceIdentity(root, src)).toEqual({ unit: null });
  });

  it.each(["<input>", "<text>", "src/content/href.ts", "", null, undefined])(
    "gives the virtual name %j no unit",
    (name) => {
      expect(sourceIdentity(root, name)).toEqual({ unit: null });
    },
  );

  it("refuses a name under src that leads outside it", () => {
    for (const leaf of ["other.ts", "New.ts"])
      expect(sourceIdentity(root, join(src, "away", leaf))).toEqual({
        unit: null,
        error: "it is named under src but resolves outside it",
      });
  });
});

describe("a file that does not exist yet", () => {
  it.each([
    ["in a renderer folder", ["content", "New.tsx"], "content/New.tsx"],
    ["in src", ["New.ts"], "New.ts"],
    ["in folders that do not exist", ["a", "b", "New.ts"], "a/b/New.ts"],
    ["through a folder link", ["same", "New.tsx"], "content/New.tsx"],
    [
      "in a folder that only looks reserved",
      ["GENERATED", "New.ts"],
      "GENERATED/New.ts",
    ],
  ])("is named by where it would be, %s", (_name, parts, expected) => {
    expect(sourceIdentity(root, join(src, ...parts))).toEqual({
      unit: expected,
    });
  });

  it("takes an existing folder's real letter case, or keeps a new folder's own", () => {
    expect(sourceIdentity(root, join(src, "CONTENT", "New.tsx"))).toEqual({
      unit: caseBlind ? "content/New.tsx" : "CONTENT/New.tsx",
    });
  });

  it.each([
    ["under a file", join(file, "child.ts"), /not a directory|ENOTDIR/u],
    ["under a dangling link", join(src, "dangling", "New.ts"), /resolved/u],
    ["as a dangling link", join(src, "dangling"), /resolved/u],
    [
      "through dot segments",
      [src, "missing", "..", "New.ts"].join(sep),
      /named through/u,
    ],
  ])("is refused %s", (_name, spelled, pattern) => {
    const found = sourceIdentity(root, spelled);
    expect(found.unit).toBeNull();
    expect(found.error).toMatch(pattern);
  });

  // Windows does not deny a folder by mode bits, and an administrator is never denied.
  it.runIf(!windows && process.getuid?.() !== 0)(
    "is refused when a folder on the way cannot be read",
    () => {
      const { root: locked } = tree();
      const dir = join(locked, "src", "content");
      chmodSync(dir, 0o000);
      try {
        for (const leaf of ["href.ts", "New.tsx"]) {
          const found = sourceIdentity(locked, join(dir, leaf));
          expect(found.unit).toBeNull();
          expect(found.error).toMatch(/EACCES/u);
        }
      } finally {
        chmodSync(dir, 0o755);
      }
    },
  );
});

describe("a project whose src cannot be trusted", () => {
  it("refuses a src that is a link elsewhere", () => {
    const { base: other, root: linked } = fixture(
      { "../real/content/href.ts": "export {};\n" },
      bare,
    );
    link(join(other, "real"), join(linked, "src"));
    expect(
      sourceIdentity(linked, join(linked, "src", "content", "href.ts")),
    ).toEqual({ unit: null, error: "src resolves outside the project root" });
  });

  it("refuses a project with no src", () => {
    const { root: empty } = fixture({ "note.txt": "x" }, bare);
    const found = sourceIdentity(empty, join(empty, "src", "main.tsx"));
    expect(found.unit).toBeNull();
    expect(found.error).toMatch(/the source root cannot be resolved/u);
  });
});
