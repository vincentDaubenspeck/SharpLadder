// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundleAsync, transform } from "lightningcss";
import { afterAll, describe, expect, it } from "vitest";
import { terminalProvenance } from "./build.mjs";
import { lightningTargets } from "./contract.js";
import {
  cleanUp,
  fixture,
  harness,
  pluginNamed,
  releaseRoot,
  tokensSheet,
} from "./fixture.js";
import { walkDist } from "./output.js";
import { layerPrelude } from "./prelude.js";
import { collect, parseSheet, tokenManifest } from "./provenance.js";

const web = join(import.meta.dirname, "..");

afterAll(cleanUp);

const release = (files, options) => releaseRoot(fixture(files, options).root);
const rejects = (promise, pattern) => expect(promise).rejects.toThrow(pattern);

const main = (code) => ({ "src/main.tsx": `${code}\n` });
const sheet = (css) => ({ ...main('import "./x.css";'), "src/x.css": css });
const tokens = (css) => ({
  ...main('import "./theme/tokens.css";'),
  "src/theme/tokens.css": css,
});

// Rewrites the shipped face the way a hidden plugin would; it must never get the chance.
const unapproved = (seen) => ({
  name: "probe:unapproved",
  generateBundle(_options, bundle) {
    seen.called = true;
    for (const file of Object.values(bundle))
      if (file.fileName.endsWith(".css"))
        file.source = String(file.source).replace(/margin:0/gu, "margin:1px");
  },
});

// A later configResolved hook sees the resolved config after the guard has judged it.
const afterGuard = (config, edit) => {
  const later = pluginNamed(config, "vite:react:config-post");
  const original = later.configResolved;
  later.configResolved = function configResolved(resolved) {
    edit(resolved);
    return original?.call(this, resolved);
  };
};

describe("plugin channels outside the pinned list", () => {
  it("fails build.rolldownOptions.plugins at config before it runs", async () => {
    const { run, state } = await harness(main("export {};"), (config) => {
      const seen = { called: false };
      config.build.rolldownOptions.plugins = [unapproved(seen)];
      return seen;
    });
    await rejects(run, /build\.rolldownOptions\.plugins is set/u);
    expect(state.called).toBe(false);
  }, 30_000);

  it("fails build.rolldownOptions.output.plugins at config before it runs", async () => {
    const { run, state } = await harness(main("export {};"), (config) => {
      const seen = { called: false };
      config.build.rolldownOptions.output.plugins = [unapproved(seen)];
      return seen;
    });
    await rejects(run, /build\.rolldownOptions\.output\.plugins is set/u);
    expect(state.called).toBe(false);
  }, 30_000);

  it("fails option plugins added after the configuration check at buildStart", async () => {
    const { run, state } = await harness(main("export {};"), (config) => {
      const seen = { called: false };
      afterGuard(config, (resolved) => {
        resolved.environments.client.build.rolldownOptions.plugins = [
          unapproved(seen),
        ];
      });
      return seen;
    });
    await rejects(run, /build pipeline differs from the pinned list/u);
    expect(state.called).toBe(false);
  }, 30_000);

  it("fails output plugins added after the configuration check", async () => {
    const { run, state } = await harness(main("export {};"), (config) => {
      const seen = { called: false };
      afterGuard(config, (resolved) => {
        resolved.environments.client.build.rolldownOptions.output.plugins = [
          unapproved(seen),
        ];
      });
      return seen;
    });
    await rejects(run, /output options carry plugins/u);
    expect(state.called).toBe(false);
  }, 30_000);

  it("fails a plugin swapped in per environment at buildStart", async () => {
    const { run, state } = await harness(main("export {};"), (config) => {
      const seen = { called: false };
      const react = pluginNamed(config, "vite:react-refresh");
      react.applyToEnvironment = () => [{ ...react }, unapproved(seen)];
      return seen;
    });
    await rejects(run, /build pipeline differs from the pinned list/u);
    expect(state.called).toBe(false);
  }, 30_000);
});

describe("Tool B: actual builds", () => {
  it("verifies the token sequence on disk after C2 minified it", async () => {
    const built = await release(main("export {};"));
    expect(built.provenance).toEqual({
      path: expect.stringMatching(/^assets\/style-[\w-]+\.css$/u),
      occurrences: 1,
      exceptions: 0,
    });
    const [css] = [...built.files.keys()].filter((f) => f.endsWith(".css"));
    const text = readFileSync(join(built.outDir, css), "utf8");
    // A4: the snapshot hash is of C2's final bytes; minify may absorb the layer statement.
    expect(text).toBe(
      "@layer tokens{:root{--bg:#fff}}@layer base,components,overrides;",
    );
    expect(built.manifest.entries).toHaveLength(1);
    expect(built.manifest.stage2).toEqual(built.manifest.stage1);
  }, 30_000);

  it("A4: a post-ordered C2 fails at the writeBundle recheck", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      const c2 = pluginNamed(config, "sharpladder:css-minify");
      c2.generateBundle = { order: "post", handler: c2.generateBundle };
    });
    await rejects(run, /differs from the snapshot in the written bundle/u);
  }, 30_000);

  it("N20: altering E between C0 and C1 fails at C1", async () => {
    const { run, state } = await harness(main("export {};"), (config) => {
      const seen = { mutated: false };
      const guard = pluginNamed(config, "sharpladder:build-guard");
      const original = guard.transform;
      guard.transform = function transformHook(code, id) {
        const out = original.call(this, code, id);
        if (out === null || !id.endsWith("tokens.css")) return out;
        seen.mutated = true;
        return {
          code: `${out.code}@layer tokens { :root { --bg: #000 } }\n`,
          map: null,
        };
      };
      return seen;
    });
    await rejects(run, /C1 compile input matches 0 C0 records/u);
    expect(state.mutated).toBe(true);
  }, 30_000);

  it("N14: a replacement visitor of the same shape fails at config", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      config.css.lightningcss.visitor = { StyleSheet() {} };
    });
    await rejects(run, /visitor is not the guard's C1 visitor/u);
  }, 30_000);

  it("fails a build with no stylesheet (bootstrap removal)", async () => {
    await rejects(
      release(main("export {};"), { tokens: false }),
      /expected one stylesheet at C2, found 0/u,
    );
  }, 30_000);

  it("fails a stylesheet build that never binds tokens.css", async () => {
    await rejects(
      release(sheet("@layer base { body { margin: 0 } }\n"), { tokens: false }),
      /tokens\.css was never bound/u,
    );
  }, 30_000);

  it("N27: two modules with identical ASTs fail closed at C1", async () => {
    const same = "@layer base { body { margin: 0 } }\n";
    await rejects(
      release({
        ...main('import "./a.css";\nimport "./b.css";'),
        "src/a.css": same,
        "src/b.css": same,
      }),
      /C1 compile input matches 2 C0 records/u,
    );
  }, 30_000);

  it.each([
    ["@layer base { body { color: #fff } }", /sets a colour on color/u],
    [
      "@layer base { body { color: var(--bg, red) } }",
      /sets a colour on color/u,
    ],
    ["@layer base { body { --brand: #123 } }", /declares a colour outside/u],
    ["@layer base { body { --brand: red } }", /declares a colour outside/u],
    ["@layer base { body { --bg: 4px } }", /declares a colour outside/u],
    [
      "@layer base { body { --x: activeborder } }",
      /deprecated colour activeborder/u,
    ],
  ])(
    "fails the stylesheet %s",
    async (css, pattern) => {
      await rejects(release(sheet(`${css}\n`)), pattern);
    },
    30_000,
  );

  it("fails a module that declares a non-colour registry name", async () => {
    await rejects(
      release({
        ...sheet("@layer base { body { --gap: 5px } }\n"),
        "src/theme/tokens.css": tokensSheet.replace(
          "--bg: #fff;",
          "--bg: #fff;\n    --gap: 4px;",
        ),
        "src/main.tsx": 'import "./theme/tokens.css";\nimport "./x.css";\n',
      }),
      /declares the token --gap/u,
    );
  }, 30_000);

  it.each([
    ["@layer base { body { color: currentcolor; background: transparent } }"],
    ["@layer base { body { border-color: Canvas; --edge: transparent } }"],
  ])(
    "admits exception-only colours in %s",
    async (css) => {
      const built = await release(sheet(`${css}\n`));
      expect(built.provenance.exceptions).toBeGreaterThan(0);
    },
    30_000,
  );

  it.each([
    [
      "@layer tokens { :root { --bg: #fff; --bg: #000 } }",
      /declares --bg twice in one rule and context/u,
    ],
    [
      "@layer tokens { :root { --bg: #fff; color: red } }",
      /sets a colour on color/u,
    ],
    [":root { --bg: #fff }", /places --bg outside layer tokens/u],
  ])(
    "fails the token sheet %s",
    async (css, pattern) => {
      await rejects(release(tokens(`${css}\n`)), pattern);
    },
    30_000,
  );
});

describe("Tool B: terminal C3", () => {
  it("fails a changed, added or missing colour occurrence on disk", async () => {
    const built = await release(main("export {};"));
    const terminal = walkDist(built.outDir);
    const [path] = [...terminal.keys()].filter((f) => f.endsWith(".css"));
    const swap = (from, to) => {
      const altered = new Map(terminal);
      const text = terminal.get(path).bytes.toString("utf8").replace(from, to);
      altered.set(path, { bytes: Buffer.from(text) });
      return altered;
    };
    expect(terminalProvenance(terminal, built.manifest).occurrences).toBe(1);
    expect(() =>
      terminalProvenance(swap("--bg:#fff", "--bg:#ffe"), built.manifest),
    ).toThrow(/colour occurrence 0 \(--bg\) differs/u);
    expect(() =>
      terminalProvenance(
        swap("--bg:#fff", "--bg:#fff;--bg:#000"),
        built.manifest,
      ),
    ).toThrow(/holds 2 colour occurrences, expected 1/u);
    expect(() =>
      terminalProvenance(swap("{--bg:#fff}", "{}"), built.manifest),
    ).toThrow(/holds 0 colour occurrences, expected 1/u);
    expect(() =>
      terminalProvenance(
        swap("{:root{", "{body{color:red}:root{"),
        built.manifest,
      ),
    ).toThrow(/sets a colour on color/u);
    expect(() => terminalProvenance(new Map(), built.manifest)).toThrow(
      /expected one stylesheet at C3, found 0/u,
    );
    expect(() => terminalProvenance(terminal, null)).toThrow(
      /no token manifest/u,
    );
  }, 30_000);
});

describe("Tool B: manifest", () => {
  const production = readFileSync(join(web, "src/theme/tokens.css"), "utf8");

  it("records every colour occurrence of tokens.css with its context", () => {
    const manifest = tokenManifest(layerPrelude + production, "0".repeat(64));
    // 43 colour tokens in light, both dark contexts and print, plus 5 .work overrides twice.
    expect(manifest.entries).toHaveLength(43 * 4 + 5 * 2);
    expect(manifest.stage2).toHaveLength(manifest.entries.length);
    expect(manifest.nameCount["--bg"]).toBe(4);
    expect(manifest.names).toHaveLength(186);
    expect(new Set(manifest.stage2.map((entry) => entry.context[0]))).toEqual(
      new Set(["layer tokens"]),
    );
  });

  // P12: transform stands in for bundleAsync only while their bytes agree on every input.
  it.each([
    ["src/theme/tokens.css"],
    ["src/theme/base.css"],
    ["src/theme/fonts.css"],
    ["fixture token sheet"],
  ])("P12: transform and bundleAsync agree on %s", async (name) => {
    const raw = name.startsWith("src/")
      ? readFileSync(join(web, name), "utf8")
      : tokensSheet;
    const code = layerPrelude + raw;
    const options = {
      errorRecovery: false,
      targets: lightningTargets,
      minify: false,
    };
    const viaTransform = transform({
      ...options,
      filename: "e.css",
      code: Buffer.from(code),
    });
    const viaBundle = await bundleAsync({
      ...options,
      filename: "e.css",
      resolver: { read: () => code, resolve: (specifier) => specifier },
    });
    expect(viaBundle.code.toString("utf8")).toBe(
      viaTransform.code.toString("utf8"),
    );
    expect(collect(parseSheet(code)).atRules).toEqual([]);
  });
});
