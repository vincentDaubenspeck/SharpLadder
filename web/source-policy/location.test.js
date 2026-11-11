// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, parse, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classifyId,
  guardContext,
  projectPath,
  sourceUnit,
} from "../build-guard/classify.js";
import {
  buildRoot,
  cleanUp,
  fixture,
  link,
  tokensSheet,
} from "../build-guard/fixture.js";
import { canonical, descendant, sourceIdentity } from "./unit.js";

afterAll(cleanUp);

const windows = process.platform === "win32";
const bare = { modules: false, tokens: false, helpers: false };
// A capital whose lower case is the two characters of the second name: the names are two
// folders on disk and one text once letter case is folded.
const capital = "\u0130";
const folded = "i\u0307";
const probe = "export const x = 192837465;\n";
const importing = (path) => `import { x } from "${path}";\nconsole.log(x);\n`;

const put = (root, path, content) => {
  const file = join(root, ...path.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
  return file;
};

// Makes a folder keep names apart that differ only in letter case, where the system can: Windows
// needs the folder switched over while it is empty, and other systems are asked what they do.
function splitCase(dir) {
  if (windows) {
    const done = spawnSync(
      "fsutil.exe",
      ["file", "setCaseSensitiveInfo", dir, "enable"],
      { encoding: "utf8" },
    );
    if (done.error || done.status !== 0) return false;
  }
  const lower = join(dir, "case-probe");
  writeFileSync(lower, "");
  const apart = !existsSync(join(dir, "CASE-PROBE"));
  rmSync(lower);
  return apart;
}

const refused = (found) => {
  expect(found.unit).toBeNull();
  expect(found.error).toEqual(expect.any(String));
};

const failing = async (root) => {
  const error = await buildRoot(root).then(
    () => null,
    (e) => e,
  );
  expect(error?.message).toMatch(/build guard: /u);
  return error.message;
};

const web = join(import.meta.dirname, "..");
const copied = [
  "eslint-rules/app-capabilities.js",
  "source-policy/index.js",
  "source-policy/renderer.js",
  "source-policy/unit.js",
];
// Run from inside a copy of the tree, so the copied rule takes that copy as its project.
const linter = `import parser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import rule from "./eslint-rules/app-capabilities.js";

const lint = new ESLint({
  cwd: import.meta.dirname,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["src/**/*.ts"],
      languageOptions: { parser },
      plugins: { sharpladder: { rules: { "app-capabilities": rule } } },
      rules: { "sharpladder/app-capabilities": "error" },
    },
  ],
});
const found = [];
for (const path of ["src/content/escape/Probe.ts", "src/content/href.ts"]) {
  const [result] = await lint.lintFiles([path]);
  found.push(result.messages.map((m) => m.message));
}
process.stdout.write(JSON.stringify(found));
`;

// The messages for the file named through the link, then for an unchanged helper.
function lintInside(root) {
  for (const path of copied)
    put(root, path, readFileSync(join(web, path), "utf8"));
  put(root, "package.json", '{ "type": "module" }\n');
  put(root, "lint-link.mjs", linter);
  const run = spawnSync(process.execPath, ["lint-link.mjs"], {
    cwd: root,
    encoding: "utf8",
    timeout: 90_000,
  });
  if (run.error || run.status !== 0)
    throw new Error(`the lint child failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

describe("the part of one resolved path below another", () => {
  const dir = join(parse(process.cwd()).root, "a", "src");

  it("is the rest of the path, as written", () => {
    expect(descendant(dir, join(dir, "x.ts"))).toBe("x.ts");
    expect(descendant(dir, join(dir, "b", capital, "x.ts"))).toBe(
      ["b", capital, "x.ts"].join(sep),
    );
  });

  it("is nothing for the folder itself, a neighbour or a parent", () => {
    expect(descendant(dir, dir)).toBeNull();
    expect(descendant(dir, dir + sep)).toBeNull();
    expect(descendant(dir, `${dir}-extra${sep}x.ts`)).toBeNull();
    expect(descendant(dir, join(dir, "..", "x.ts"))).toBeNull();
    expect(descendant(join(dir, "b"), join(dir, "x.ts"))).toBeNull();
  });

  it("starts below a file system root without a second separator", () => {
    const { root } = parse(dir);
    expect(descendant(root, join(root, "a"))).toBe("a");
    expect(descendant(root, root)).toBeNull();
  });

  it.runIf(windows)("is nothing across drives", () => {
    expect(descendant("C:\\a\\src", "D:\\a\\src\\x.ts")).toBeNull();
  });

  it.each([
    ["another letter case of the folder", "SRC", "src"],
    ["a capital and its two-character lower case", capital, folded],
    ["a ligature and its letters", "\uFB01", "fi"],
    ["a composed and a decomposed accent", "\u00E9", "e\u0301"],
  ])("is nothing through %s", (_name, one, other) => {
    const base = join(parse(dir).root, "a");
    expect(descendant(join(base, one), join(base, other, "x.ts"))).toBeNull();
    expect(descendant(join(base, other), join(base, one, "x.ts"))).toBeNull();
    expect(descendant(join(base, one), join(base, one, "x.ts"))).toBe("x.ts");
  });
});

describe("a place that reads as src once letter case is folded", () => {
  const files = {
    "src/main.tsx": importing("./content/escape/Probe.ts"),
    [`../../${folded}/web/src/ordinary/Probe.ts`]: probe,
  };
  const layout = (options) => {
    const { base, root } = fixture(files, { under: capital, ...options });
    const outside = join(base, folded, "web", "src", "ordinary");
    link(outside, join(root, "src", "content", "escape"));
    return { root, outside };
  };

  it("is two folders on disk", () => {
    const { root, outside } = layout(bare);
    expect(canonical(join(outside, "Probe.ts"))).not.toBe(
      canonical(join(root, "src", "content", "escape", "Probe.ts")).replace(
        folded,
        capital,
      ),
    );
    expect(existsSync(join(root, "src", "ordinary"))).toBe(false);
  });

  it("is refused by the mapper, through the link and by its own name", () => {
    const { root, outside } = layout(bare);
    refused(
      sourceIdentity(root, join(root, "src", "content", "escape", "Probe.ts")),
    );
    refused(sourceIdentity(root, join(outside, "Probe.ts")));
    refused(sourceIdentity(root, join(outside, "absent.ts")));
  });

  it("is outside src for the build's classifier", () => {
    const { root, outside } = layout(bare);
    const ctx = guardContext(root);
    expect(() => classifyId(ctx, join(outside, "Probe.ts"), "load")).toThrow(
      /outside src/u,
    );
    expect(() => sourceUnit(ctx, join(outside, "Probe.ts"))).toThrow(
      /build guard: /u,
    );
  });

  it("fails a real build that imports it", async () => {
    const { root } = layout();
    expect(await failing(root)).toMatch(/outside src and node_modules/u);
  }, 120_000);

  // ESLint matches no configuration to a file under this ancestor, so there is no clean control.
  it("is never linted clean by ESLint run inside the project", () => {
    const [through] = lintInside(layout().root);
    expect(through.length).toBeGreaterThan(0);
  }, 120_000);

  it("builds an ordinary project under the same ancestor", async () => {
    const { root } = fixture(
      { "src/main.tsx": "console.log(1);\n" },
      { under: capital },
    );
    await expect(buildRoot(root)).resolves.toBeDefined();
    expect(
      sourceIdentity(root, join(root, "src", "content", "href.ts")),
    ).toEqual({ unit: "content/href.ts" });
  }, 120_000);
});

// Runs where a folder can hold src beside SRC: always off Windows, and on Windows where the
// folder can be switched over. A run that skips this block has not shown the rules below.
let caseSplit = false;
const caseProject = fixture(
  { "src/main.tsx": importing("./content/escape/Probe.ts") },
  {
    prepare: (root) => {
      caseSplit = splitCase(root);
    },
  },
);

describe.runIf(!caseSplit)("a folder that holds src beside SRC", () => {
  it("cannot be made on this system, so its rules are not shown by this run", () => {
    expect(existsSync(join(caseProject.root, "SRC"))).toBe(true);
  });
});

describe.runIf(caseSplit)("a folder that holds src beside SRC", () => {
  const { root } = caseProject;
  const outside = join(root, "SRC", "ordinary");
  const spelled = join(root, "src", "content", "escape", "Probe.ts");
  put(root, "SRC/ordinary/Probe.ts", probe);
  put(root, "INDEX.HTML", "<!doctype html>\n");
  put(root, "src-extra/x.ts", "export {};\n");
  link(outside, join(root, "src", "content", "escape"));

  it("holds two folders", () => {
    expect(canonical(join(root, "SRC"))).not.toBe(canonical(join(root, "src")));
    expect(canonical(spelled)).toBe(join(outside, "Probe.ts"));
  });

  it("is refused by the mapper, through the link and by its own name", () => {
    refused(sourceIdentity(root, spelled));
    refused(sourceIdentity(root, join(outside, "Probe.ts")));
    refused(sourceIdentity(root, join(root, "SRC", "content", "href.ts")));
  });

  it("is reported by ESLint run inside the project, beside a clean helper", () => {
    const [through, control] = lintInside(root);
    expect(through.join("\n")).toContain("is not established");
    expect(control).toEqual([]);
  }, 120_000);

  it("is outside src, the page and the project for the classifier", () => {
    const ctx = guardContext(root);
    for (const path of [
      "SRC/ordinary/Probe.ts",
      "INDEX.HTML",
      "src-extra/x.ts",
    ])
      expect(() =>
        classifyId(ctx, join(root, ...path.split("/")), "load"),
      ).toThrow(/outside src/u);
    expect(classifyId(ctx, join(root, "index.html"), "load").kind).toBe("html");
    expect(classifyId(ctx, join(root, "src", "main.tsx"), "load").kind).toBe(
      "first-party",
    );
    expect(projectPath(ctx, join(root, "SRC", "x.css"))).toBe("SRC/x.css");
  });

  it("fails a real build that imports through the link", async () => {
    expect(await failing(root)).toMatch(/outside src and node_modules/u);
  }, 120_000);
});

describe.runIf(caseSplit)("a dependency folder beside its other case", () => {
  let apart = false;
  const { root } = fixture(
    { "src/main.tsx": "export {};\n" },
    {
      ...bare,
      prepare: (dir) => {
        apart = splitCase(dir);
        mkdirSync(join(dir, "node_modules"));
        apart &&= splitCase(join(dir, "node_modules"));
      },
    },
  );
  put(root, "node_modules/good/package.json", '{ "name": "good" }');
  put(root, "node_modules/Good/package.json", '{ "name": "good" }');
  put(root, "NODE_MODULES/good/package.json", '{ "name": "good" }');

  it("is owned only under its exact name", () => {
    expect(apart).toBe(true);
    const ctx = guardContext(root);
    expect(
      classifyId(ctx, put(root, "node_modules/good/i.js", ""), "load").name,
    ).toBe("good");
    expect(() =>
      classifyId(ctx, put(root, "node_modules/Good/i.js", ""), "load"),
    ).toThrow(/owned by "good", not its directory/u);
    expect(() =>
      classifyId(ctx, put(root, "NODE_MODULES/good/i.js", ""), "load"),
    ).toThrow(/outside src and node_modules/u);
  });
});

describe("a module the build holds to be first-party", () => {
  const { root } = fixture(
    {
      "src/main.tsx": "export {};\n",
      "src/content/href.ts": "export {};\n",
      "extra.ts": "export {};\n",
    },
    bare,
  );
  const ctx = guardContext(root);

  it("has a unit", () => {
    expect(sourceUnit(ctx, join(root, "src", "content", "href.ts"))).toBe(
      "content/href.ts",
    );
  });

  it("stops the build when it has none", () => {
    expect(() => sourceUnit(ctx, join(root, "extra.ts"))).toThrow(
      /build guard: .*it has no place under src/u,
    );
    expect(() => sourceUnit(ctx, "<input>")).toThrow(/no place under src/u);
  });
});

describe("a link into or out of the renderer folders", () => {
  const { base, root } = fixture(
    {
      "src/main.tsx": "export {};\n",
      "src/content/href.ts": "export {};\n",
      "src/content-tests/href.test.ts": "export {};\n",
      "src/generated/body.ts": "export {};\n",
      "../outside/other.ts": "export {};\n",
    },
    bare,
  );
  const src = join(root, "src");
  const inward = [
    ["content", "href.ts"],
    ["content-tests", "href.test.ts"],
    ["generated", "body.ts"],
  ];
  for (const [folder] of inward)
    link(join(src, folder), join(src, `to-${folder}`));
  link(join(base, "outside"), join(src, "content", "out"));

  it.each(inward)("names a file by the %s folder it is in", (folder, name) => {
    expect(sourceIdentity(root, join(src, `to-${folder}`, name))).toEqual({
      unit: `${folder}/${name}`,
    });
    expect(sourceIdentity(root, join(src, `to-${folder}`, "new.ts"))).toEqual({
      unit: `${folder}/new.ts`,
    });
  });

  it("refuses a file the link takes out of src, saved or not", () => {
    refused(sourceIdentity(root, join(src, "content", "out", "other.ts")));
    refused(sourceIdentity(root, join(src, "content", "out", "new.ts")));
  });
});

describe.runIf(!windows)("a link to a name that is not a source name", () => {
  const { root } = fixture({ "src/main.tsx": "export {};\n" }, bare);
  const src = join(root, "src");
  mkdirSync(join(src, "content"));
  const targets = [
    ["a backslash", "content\\href.ts"],
    ["a colon", "href.ts:zone"],
    ["a trailing dot", "href.ts."],
    ["a trailing space", "href.ts "],
  ];
  for (const [index, [, name]] of targets.entries()) {
    writeFileSync(join(src, name), "export {};\n");
    link(join(src, name), join(src, `safe${String(index)}.ts`));
  }

  it.each(targets.map(([how, name], index) => [how, name, index]))(
    "is refused for %s in the name it leads to",
    (_how, name, index) => {
      const found = sourceIdentity(root, join(src, `safe${String(index)}.ts`));
      refused(found);
      expect(found.error).toContain("which is not a source name");
      refused(sourceIdentity(root, join(src, name)));
    },
  );
});

describe("the tokens stylesheet under another letter case", () => {
  it("is not the tokens stylesheet", async () => {
    const { root } = fixture({
      "src/theme/tokens.css": null,
      "src/theme/Tokens.css": tokensSheet,
      "src/main.tsx": 'import "./theme/Tokens.css";\nconsole.log(1);\n',
    });
    expect(await failing(root)).toContain(
      "src/theme/Tokens.css declares a colour outside src/theme/tokens.css",
    );
  }, 120_000);
});
