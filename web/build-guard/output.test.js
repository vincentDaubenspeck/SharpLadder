// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "vite";
import { releaseBuild } from "./build.mjs";
import { cleanUp, fixture, link } from "./fixture.js";
import {
  layerViolations,
  pinnedPlugins,
  sameInventory,
  snapshot,
  walkDist,
} from "./output.js";
import { layerPrelude } from "./prelude.js";

const web = join(import.meta.dirname, "..");
const outs = [];

afterAll(() => {
  cleanUp();
  for (const out of outs.splice(0))
    rmSync(out, { recursive: true, force: true });
});

const quiet = (options = {}) => ({ logLevel: "silent", ...options });

// Fixture builds go to the fixture's own dist, which Vite empties because it sits inside root.
const release = (files, options = {}) =>
  releaseBuild(quiet({ root: fixture(files).root, ...options }));

const failure = (promise) =>
  promise.then(
    () => null,
    (error) => error,
  );

async function rejects(promise, pattern) {
  const error = await failure(promise);
  expect(error?.message).toMatch(/build guard: /u);
  expect(error?.message).toMatch(pattern);
}

const main = (code) => ({ "src/main.tsx": `${code}\n` });

const sheets = {
  "src/tokens.css": "@layer tokens { :root { --gap: 1px } }\n",
  "src/base.css": "@layer base { body { margin: 0 } }\n",
  "src/Card.module.css": "@layer components { .card { color: red } }\n",
  "src/overrides.css": "@layer overrides { .wide { width: 100% } }\n",
};

const cssFixture = main(
  'import "./base.css";\nimport s from "./Card.module.css";\nconsole.log(s);',
);

const kinds = (record) =>
  [...record.files].map(([name, { type }]) => `${type}:${name}`).sort();

describe("output admission: clean builds", () => {
  it("builds the real app to exactly the page and one chunk", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "sl-out-"));
    outs.push(outDir);
    const record = await releaseBuild(
      quiet({ build: { outDir, emptyOutDir: true } }),
    );
    expect(kinds(record)).toEqual([
      expect.stringMatching(/^asset:index\.html$/u),
      expect.stringMatching(/^chunk:assets\/index-[\w-]+\.js$/u),
    ]);
    expect(walkDist(outDir).size).toBe(2);
  });

  // Post order is terminal: no other resolved plugin orders its generateBundle after the guard.
  it("snapshots after every other generateBundle hook", async () => {
    const config = await resolveConfig(
      { root: web, configFile: join(web, "vite.config.ts") },
      "build",
    );
    const post = config.plugins
      .filter(({ generateBundle }) => generateBundle?.order === "post")
      .map(({ name }) => name);
    expect(post).toEqual(["sharpladder:build-guard"]);
    expect(config.plugins.map(({ name }) => name)).toEqual(pinnedPlugins);
    expect(pinnedPlugins).toHaveLength(42);
  });

  // An allowlist, not a strip list, so no unknown agent variable reaches the clean child.
  const cleanEnv = () => {
    const keep =
      process.platform === "win32"
        ? ["SystemRoot", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE"]
        : ["HOME"];
    const lookup = (name) =>
      Object.entries(process.env).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      )?.[1];
    const env = {};
    for (const name of keep) {
      const value = lookup(name);
      if (value !== undefined) env[name] = value;
    }
    const sep = process.platform === "win32" ? ";" : ":";
    env.PATH = (lookup("PATH") ?? "")
      .split(sep)
      .filter((segment) => !/\.pi[\\/]agent/u.test(segment))
      .join(sep);
    return env;
  };

  const resolveIn = (env) => {
    const url = (path) => pathToFileURL(join(web, path)).href;
    const script = [
      `import { detectAgent } from ${JSON.stringify(url("node_modules/std-env/dist/index.mjs"))};`,
      `import { resolveConfig } from ${JSON.stringify(url("node_modules/vite/dist/node/index.js"))};`,
      `const config = await resolveConfig({ root: ${JSON.stringify(web)}, configFile: ${JSON.stringify(join(web, "vite.config.ts"))}, logLevel: "silent" }, "build");`,
      "console.log(JSON.stringify({ agent: detectAgent().name ?? '', plugins: config.plugins.map(({ name }) => name) }));",
    ].join("\n");
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: web, env, encoding: "utf8" },
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  it("resolves the pinned plugins whether or not an agent is detected", () => {
    const clean = resolveIn(cleanEnv());
    const agent = resolveIn({ ...cleanEnv(), AI_AGENT: "test-agent" });
    expect(clean.agent).toBe("");
    expect(agent.agent).not.toBe("");
    expect(clean.plugins).toEqual(pinnedPlugins);
    expect(agent.plugins).toEqual(pinnedPlugins);
  }, 60_000);

  it("sees the stylesheet css-post emits and the page build-html adds", async () => {
    const record = await release({ ...sheets, ...cssFixture });
    expect(kinds(record).map((kind) => kind.split(":")[0])).toEqual([
      "asset",
      "asset",
      "chunk",
    ]);
    expect([...record.files.keys()]).toContain("index.html");
    expect([...record.files.keys()].some((f) => f.endsWith(".css"))).toBe(true);
  });
});

describe("output admission: layer order", () => {
  const names = ["tokens", "base", "Card.module", "overrides"];
  const orders = [
    ["overrides", "Card.module", "base", "tokens"],
    ["overrides", "tokens", "base", "Card.module"],
    ["Card.module", "tokens", "overrides", "base"],
    ["base", "tokens", "Card.module", "overrides"],
  ];
  const entry = (order) =>
    main(
      order
        .map((name) =>
          name === "Card.module"
            ? 'import s from "./Card.module.css";\nconsole.log(s);'
            : `import "./${name}.css";`,
        )
        .join("\n"),
    );

  it("has teeth: these orders break without the prelude", () => {
    for (const order of orders) {
      const joined = order.map((name) => sheets[`src/${name}.css`]).join("");
      expect(layerViolations(joined)).not.toEqual([]);
    }
    const ordered = names.map((name) => sheets[`src/${name}.css`]).join("");
    expect(layerViolations(ordered)).toEqual([]);
  });

  it("builds every import order to the same declared order", async () => {
    const outputs = new Set();
    for (const order of orders) {
      const { root } = fixture({ ...sheets, ...entry(order) });
      const record = await releaseBuild(quiet({ root }));
      const [css] = [...record.files.keys()].filter((f) => f.endsWith(".css"));
      const text = readFileSync(join(record.outDir, css), "utf8");
      expect(layerViolations(text)).toEqual([]);
      const seen = [
        ...new Set(
          [...text.matchAll(/@layer ([\w, ]+)/gu)].flatMap(([, list]) =>
            list.split(",").map((name) => name.trim()),
          ),
        ),
      ];
      expect(seen, text).toEqual(["tokens", "base", "components", "overrides"]);
      outputs.add(text);
    }
    expect(outputs.size).toBe(1);
  });

  it("fails on a layer outside the declared set", async () => {
    await rejects(
      release({
        ...main('import "./x.css";'),
        "src/x.css": "@layer extra { body { margin: 0 } }\n",
      }),
      /unknown layer "extra"/u,
    );
  });

  it("fails on a nested layer", async () => {
    await rejects(
      release({
        ...main('import "./x.css";'),
        "src/x.css": "@layer base { @layer inner { body { margin: 0 } } }\n",
      }),
      /nested @layer inner/u,
    );
  });

  it.each([
    ["@layer base;\n@layer tokens;", /first appear as base, tokens/u],
    ["@layer a.b { x { y: z } }", /unknown layer "a\.b"/u],
    ["@layer { x { y: z } }", /unknown layer ""/u],
    ["@layer base { @layer tokens; }", /nested @layer tokens/u],
  ])("rejects the output CSS %s", (css, pattern) => {
    expect(layerViolations(css).join("; ")).toMatch(pattern);
  });

  it("accepts missing names and a statement that is not first", () => {
    expect(layerViolations("a { b: c }\n@layer base, overrides;")).toEqual([]);
  });

  // The prelude adds one line, so compile errors point one line below the file on disk.
  it("shifts compile error lines by exactly the prelude", async () => {
    expect(layerPrelude.split("\n")).toHaveLength(2);
    const error = await failure(
      release({
        ...main('import s from "./a.module.css";\nconsole.log(s);'),
        "src/a.module.css": ".x { color: red }\na { color: red }\n",
      }),
    );
    expect(error?.message).toMatch(/a\.module\.css:3:0/u);
  });
});

describe("output admission: configuration", () => {
  const plain = main("export {};");

  it.each([
    ["source maps", { build: { sourcemap: true } }, /sourcemap is enabled/u],
    ["a manifest", { build: { manifest: true } }, /manifest is enabled/u],
    [
      "split CSS",
      { build: { cssCodeSplit: true } },
      /cssCodeSplit is not false/u,
    ],
    [
      "inlined assets",
      { build: { assetsInlineLimit: 4096 } },
      /assetsInlineLimit is not 0/u,
    ],
    [
      "an alias",
      { resolve: { alias: { x: "/y" } } },
      /resolve\.alias differs/u,
    ],
    [
      "a second input",
      { build: { rolldownOptions: { input: ["index.html", "a.html"] } } },
      /build input is not the default/u,
    ],
  ])("fails with %s", async (_name, options, pattern) => {
    await rejects(release(plain, options), pattern);
  });

  const plugin = (hooks) => ({ plugins: [{ name: "late", ...hooks }] });

  it.each([
    [
      "mutates the chunk",
      {
        generateBundle(_o, bundle) {
          for (const out of Object.values(bundle))
            if (out.type === "chunk") out.code += "\n";
        },
      },
    ],
    [
      "mutates the chunk after the snapshot",
      {
        generateBundle: {
          order: "post",
          handler(_o, bundle) {
            for (const out of Object.values(bundle))
              if (out.type === "chunk") out.code += "\n";
          },
        },
      },
    ],
    [
      "emits a .js asset",
      {
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "x.js", source: "1" });
        },
      },
    ],
    [
      "writes an extra file",
      {
        writeBundle({ dir }) {
          writeFileSync(join(dir, "extra.txt"), "x");
        },
      },
    ],
  ])("fails with a later plugin that %s", async (_name, hooks) => {
    await rejects(release(plain, plugin(hooks)), /plugin list differs/u);
  });

  it("fails when the build writes nothing", async () => {
    await rejects(
      release(plain, { build: { write: false } }),
      /wrote no admitted output/u,
    );
  });
});

describe("output admission: inventory", () => {
  const chunk = { type: "chunk", fileName: "assets/i.js", code: "1" };
  const page = { type: "asset", fileName: "index.html", source: "<p>" };
  const sheet = (fileName) => ({ type: "asset", fileName, source: "a{}" });
  const bundleOf = (...outs) =>
    Object.fromEntries(outs.map((out) => [out.fileName, out]));

  it("hashes exactly the admitted shape", () => {
    const files = snapshot(bundleOf(chunk, page, sheet("assets/i.css")));
    expect([...files.keys()].sort()).toEqual([
      "assets/i.css",
      "assets/i.js",
      "index.html",
    ]);
  });

  it.each([
    [
      "a second stylesheet",
      [chunk, page, sheet("assets/a.css"), sheet("assets/b.css")],
      /at most one stylesheet/u,
    ],
    [
      "a second chunk",
      [chunk, page, { ...chunk, fileName: "assets/j.js" }],
      /expected one chunk, found 2/u,
    ],
    ["no chunk", [page], /expected one chunk, found 0/u],
    ["no page", [chunk], /expected one index\.html/u],
    [
      "a .js asset",
      [chunk, page, { ...page, fileName: "assets/x.js" }],
      /unexpected asset output assets\/x\.js/u,
    ],
    [
      "a source map",
      [chunk, page, { ...page, fileName: "assets/i.js.map" }],
      /unexpected asset/u,
    ],
    [
      "a manifest",
      [chunk, page, { ...page, fileName: ".vite/manifest.json" }],
      /unexpected asset/u,
    ],
    [
      "a second page",
      [chunk, page, { ...page, fileName: "a.html" }],
      /unexpected asset/u,
    ],
    [
      "an opaque asset",
      [chunk, page, { ...page, fileName: "assets/a.png" }],
      /unexpected asset/u,
    ],
    [
      "an unknown type",
      [chunk, page, { type: "other", fileName: "x" }],
      /unexpected other output/u,
    ],
    [
      "a chunk named .css",
      [chunk, page, { ...chunk, fileName: "assets/i.css" }],
      /unexpected chunk/u,
    ],
    [
      "a missing source",
      [chunk, { ...page, source: undefined }],
      /has no content/u,
    ],
  ])("fails on %s", (_name, outs, pattern) => {
    expect(() => snapshot(bundleOf(...outs))).toThrow(pattern);
  });

  it("fails on a mutation after the snapshot", () => {
    const bundle = bundleOf({ ...chunk }, page);
    const files = snapshot(bundle);
    bundle["assets/i.js"].code += ";";
    expect(() => sameInventory(files, snapshot(bundle), "the bundle")).toThrow(
      /assets\/i\.js differs from the snapshot/u,
    );
  });
});

describe("output admission: disk walk", () => {
  const built = async () => {
    const record = await release(main("export {};"));
    expect(() =>
      sameInventory(record.files, walkDist(record.outDir), "dist"),
    ).not.toThrow();
    return record;
  };
  const check = ({ files, outDir }) =>
    sameInventory(files, walkDist(outDir), "dist");

  it("fails on a file planted after the build", async () => {
    const record = await built();
    writeFileSync(join(record.outDir, "assets", "extra.js"), "1");
    expect(() => check(record)).toThrow(
      /dist has an extra file assets\/extra\.js/u,
    );
  });

  it("fails on a missing file", async () => {
    const record = await built();
    unlinkSync(join(record.outDir, "index.html"));
    expect(() => check(record)).toThrow(/dist is missing index\.html/u);
  });

  it("fails on a changed file", async () => {
    const record = await built();
    writeFileSync(join(record.outDir, "index.html"), "<p>");
    expect(() => check(record)).toThrow(/index\.html differs/u);
  });

  it("fails on a link", async () => {
    const record = await built();
    mkdirSync(join(record.outDir, "..", "elsewhere"));
    link(join(record.outDir, "..", "elsewhere"), join(record.outDir, "l"));
    expect(() => check(record)).toThrow(/l is a link/u);
  });

  it("fails on a missing dist", () => {
    expect(() => walkDist(join(tmpdir(), "sl-none", "dist"))).toThrow(
      /cannot list/u,
    );
  });
});
