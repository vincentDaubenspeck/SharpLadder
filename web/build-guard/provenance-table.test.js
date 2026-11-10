// @vitest-environment node
// Tool B rows of T 5.2 not proved elsewhere; each name states the checkpoint expected to catch it (A6).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  releaseRecheck,
  routeViolations,
  terminalProvenance,
} from "./build.mjs";
import { lightningVersion, lightningViolations } from "./contract.js";
import {
  cleanUp,
  fixture,
  harness,
  link,
  pluginNamed,
  releaseRoot,
  tokensSheet,
} from "./fixture.js";
import { walkDist } from "./output.js";
import { layerPrelude } from "./prelude.js";
import { tokenManifest } from "./provenance.js";

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
const tokenBlock = (body) =>
  `@layer tokens, base, components, overrides;\n@layer tokens {\n${body}\n}\n`;
const manifestOf = (css) => tokenManifest(layerPrelude + css, "0".repeat(64));

// Wraps the guard's transform so tokens.css reaches the compiler as `edit` makes it.
const editTokens = (edit) => (config) => {
  const seen = { edited: false };
  const guard = pluginNamed(config, "sharpladder:build-guard");
  const original = guard.transform;
  guard.transform = function transformHook(code, id) {
    const out = original.call(this, code, id);
    if (out === null || !id.endsWith("tokens.css")) return out;
    seen.edited = true;
    return { code: edit(out.code, code), map: null };
  };
  return seen;
};

// Wraps the C1 visitor after the configuration check, so only the sheet that `pick` names changes.
const editVisitor = (pick, edit) => (config) => {
  const seen = { edited: false };
  const guard = pluginNamed(config, "sharpladder:build-guard");
  const resolved = guard.configResolved;
  guard.configResolved = function configHook(...args) {
    resolved.apply(this, args);
    const original = guard.visitor.StyleSheet;
    guard.visitor.StyleSheet = (found) => {
      if (!pick(found)) return original(found);
      seen.edited = true;
      return edit(original, found);
    };
  };
  return seen;
};

const marked = (found) => JSON.stringify(found.rules).includes('"marked"');
const markedSheet = sheet("@layer base { .marked { margin: 0 } }\n");

describe("Tool B table: C0 negatives", () => {
  it("N10: a copy of tokens.css elsewhere fails at C0", async () => {
    await rejects(
      release({
        ...main('import "./other/tokens.css";'),
        "src/other/tokens.css": tokensSheet,
      }),
      /src\/other\/tokens\.css declares a colour outside/u,
    );
  }, 30_000);

  it("N11: tokens.css bytes changed before the guard fail at C0", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      const guard = pluginNamed(config, "sharpladder:build-guard");
      const original = guard.transform;
      guard.transform = function transformHook(code, id) {
        const altered = id.endsWith("tokens.css") ? `${code}\n` : code;
        return original.call(this, altered, id);
      };
    });
    await rejects(run, /tokens\.css reached the guard altered/u);
  }, 30_000);

  it("N11: a second pre plugin with a load hook fails at config", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      config.plugins.unshift({
        name: "fixture:load",
        enforce: "pre",
        load: () => null,
      });
    });
    await rejects(run, /fixture:load/u);
  }, 30_000);

  it.each([
    ['@import "./theme/tokens.css";\n', /@import/u],
    ['@\\69 mport "./theme/tokens.css";\n', /x\.css uses unparsable CSS/u],
  ])(
    "N12: the stylesheet %s fails at C0",
    async (css, pattern) => {
      await rejects(release(sheet(css)), pattern);
    },
    30_000,
  );

  it("N12: an ?inline import fails at C0", async () => {
    await rejects(
      release({
        ...main('import css from "./x.css?inline";\nexport { css };'),
        "src/x.css": "@layer base { body { margin: 0 } }\n",
      }),
      /query or fragment|\?inline/u,
    );
  }, 30_000);

  it("N15: CSS from node_modules fails at C0", async () => {
    await rejects(
      release(main('import "katex/dist/katex.min.css";')),
      /katex.min.css is a stylesheet outside the project/u,
    );
  }, 30_000);

  it("N16: @property with a colour initial value fails at C0", async () => {
    await rejects(
      release(
        sheet(
          '@property --edge { syntax: "<color>"; inherits: false; initial-value: #fff; }\n',
        ),
      ),
      /x\.css uses the at-rule property/u,
    );
  }, 30_000);

  it.each([
    ["@layer base { body { --x: ButtonHighlight } }", /buttonhighlight/u],
    ["@layer base { body { color: ThreeDFace } }", /threedface/u],
    ["@layer base { body { --x: #0000 } }", /declares a colour outside/u],
    [
      "@layer base { body { --y: rgb(0 0 0 / 0) } }",
      /declares a colour outside/u,
    ],
  ])(
    "N22/N23: the stylesheet %s fails at C0",
    async (css, pattern) => {
      await rejects(release(sheet(`${css}\n`)), pattern);
    },
    30_000,
  );

  it("N22: tokens.css with a deprecated colour fails at generation", async () => {
    await rejects(
      release(tokens(tokenBlock("  :root { --bg: ThreeDFace; }"))),
      /threedface/u,
    );
  }, 30_000);

  // The registry is read from tokens.css, which C0 cannot rely on being bound first; A5 owns it.
  it.each([
    ["--space-a: 2rem", "--space-a: 1rem"],
    ["--font-ui: serif", "--font-ui: sans-serif"],
  ])(
    "N24: a module declaring %s fails at the A5 ledger check",
    async (decl, token) => {
      const name = decl.split(":")[0];
      await rejects(
        release({
          ...main(
            'import "./theme/tokens.css";\nimport s from "./x.module.css";\nexport const c = s.x;',
          ),
          "src/theme/tokens.css": tokensSheet.replace(
            "--bg: #fff;",
            `--bg: #fff;\n    ${token};`,
          ),
          "src/x.module.css": `@layer components { .x { ${decl} } }\n`,
        }),
        new RegExp(`declares the token ${name}`, "u"),
      );
    },
    30_000,
  );

  it("N26: a stylesheet reached through a link fails at C0", async () => {
    const { root } = fixture({
      ...main('import "./alias/x.css";'),
      "src/real/x.css": "@layer base { body { margin: 0 } }\n",
    });
    link(join(root, "src", "real"), join(root, "src", "alias"));
    await rejects(releaseRoot(root), /through a link or alias/u);
  }, 30_000);

  it("N26: a case alias of tokens.css never binds the token sheet", async () => {
    await rejects(
      release(
        {
          ...main('import "./theme/Tokens.css";'),
          "src/theme/tokens.css": tokensSheet,
        },
        { tokens: false },
      ),
      // A case-sensitive filesystem refuses the alias earlier, at module resolution.
      /through a link or alias|is not its own real path|did not resolve to a bundled module/u,
    );
  }, 30_000);
});

describe("Tool B table: generation", () => {
  it.each([
    ["light-dark()", "  :root { --bg: light-dark(#fff, #000); }"],
    ["a nested rule", "  :root { --bg: #fff; & .x { --line: #000; } }"],
    [
      "two rules minify merges into a union",
      "  :root { --bg: #fff; }\n  .work { --bg: #fff; }",
    ],
    ["a display-p3 token", "  :root { --p3: color(display-p3 1 0 0); }"],
  ])("N13/N19: tokens.css with %s fails at generation", (_name, body) => {
    expect(() => manifestOf(tokenBlock(body))).toThrow(
      /outside the model|nests|does not cover/u,
    );
  });

  it("N13: the merged-rule variant fails in an actual build", async () => {
    await rejects(
      release(
        tokens(tokenBlock("  :root { --bg: #fff; }\n  .work { --bg: #fff; }")),
      ),
      /outside the model at stage 1/u,
    );
  }, 30_000);

  it("N19: a display-p3 standard colour fails at generation", () => {
    expect(() =>
      manifestOf(
        tokenBlock("  :root { --bg: #fff; color: color(display-p3 1 0 0); }"),
      ),
    ).toThrow(/sets a colour on a standard property/u);
  });

  it("N23: a zero-alpha token is a literal entry, not an exception", () => {
    const manifest = manifestOf(tokenBlock("  :root { --line: #0000; }"));
    expect(manifest.entries.map((entry) => entry.name)).toEqual(["--line"]);
  });
});

describe("Tool B table: input stage (T 4.1)", () => {
  it.each([
    ["missing", (out, raw) => raw],
    ["doubled", (out) => layerPrelude + out],
    [
      "changed",
      (out) =>
        out.replace(
          layerPrelude,
          "@layer base, tokens, components, overrides;\n",
        ),
    ],
  ])(
    "a %s prepend fails at C1",
    async (_name, edit) => {
      const { run, state } = await harness(
        main("export {};"),
        editTokens(edit),
      );
      await rejects(run, /C1 compile input matches 0 C0 records/u);
      expect(state.edited).toBe(true);
    },
    30_000,
  );

  it("builds the entry's authored statement beside the prepend", async () => {
    const built = await release(main("export {};"));
    expect(
      tokensSheet.startsWith("@layer tokens, base, components, overrides;"),
    ).toBe(true);
    expect(built.ledger).toEqual([
      expect.objectContaining({ source: "src/theme/tokens.css", consumed: 1 }),
    ]);
  }, 30_000);

  it.each([
    ["missing", () => undefined, /reached C1 0 times/u],
    [
      "repeated",
      (original, found) => {
        original(found);
        return original(found);
      },
      /reached C1 2 times/u,
    ],
  ])(
    "a %s C1 invocation fails at the A5 ledger check",
    async (_name, edit, pattern) => {
      const { run, state } = await harness(
        markedSheet,
        editVisitor(marked, edit),
      );
      await rejects(run, pattern);
      expect(state.edited).toBe(true);
    },
    30_000,
  );
});

describe("Tool B table: A5 completeness", () => {
  it("a repeated C0 record fails at the ledger check", async () => {
    const { run } = await harness(markedSheet, (config) => {
      const guard = pluginNamed(config, "sharpladder:build-guard");
      const original = guard.transform;
      guard.transform = function transformHook(code, id) {
        if (id.endsWith("x.css")) original.call(this, code, id);
        return original.call(this, code, id);
      };
    });
    await rejects(run, /x\.css was bound 2 times/u);
  }, 30_000);

  it("an extra C0 record fails at the ledger check", async () => {
    const { run, root } = await harness(
      { ...markedSheet, "src/extra.css": "@layer base { p { margin: 0 } }\n" },
      (config) => {
        const guard = pluginNamed(config, "sharpladder:build-guard");
        const original = guard.transform;
        guard.transform = function transformHook(code, id) {
          if (id.endsWith("x.css")) {
            const extra = id.replace(/x\.css$/u, "extra.css");
            original.call(this, readFileSync(extra, "utf8"), extra);
          }
          return original.call(this, code, id);
        };
      },
    );
    expect(root).toBeTypeOf("string");
    await rejects(run, /extra\.css was bound but never bundled/u);
  }, 30_000);

  it("a missing C0 record fails at the ledger check", async () => {
    const { run } = await harness(markedSheet, (config) => {
      const guard = pluginNamed(config, "sharpladder:build-guard");
      const original = guard.transform;
      guard.transform = function transformHook(code, id) {
        if (id.endsWith("x.css"))
          return { code: layerPrelude + code, map: null };
        return original.call(this, code, id);
      };
      editVisitor(marked, () => undefined)(config);
    });
    await rejects(run, /x\.css reached the bundle unbound/u);
  }, 30_000);
});

describe("Tool B table: C2 and C3", () => {
  it("N21: chunk CSS altered before C2 fails at C2", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      const c2 = pluginNamed(config, "sharpladder:css-minify");
      const original = c2.generateBundle;
      c2.generateBundle = function generateHook(options, bundle) {
        for (const out of Object.values(bundle))
          if (out.fileName.endsWith(".css"))
            out.source = String(out.source).replace(
              "--bg: #fff;",
              "--bg: #fff;\n    --bg: #fff;",
            );
        return original.call(this, options, bundle);
      };
    });
    await rejects(run, /at C2 holds 2 colour occurrences, expected 1/u);
  }, 30_000);

  it("N21: Vite's own minify left on fails at config", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      config.build.cssMinify = "lightningcss";
    });
    await rejects(run, /build\.cssMinify is not false/u);
  }, 30_000);

  it("N25: a writeBundle rewrite of emitted CSS fails at the on-disk recheck", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      const guard = pluginNamed(config, "sharpladder:build-guard");
      const original = guard.writeBundle;
      guard.writeBundle = function writeHook(options, bundle) {
        for (const out of Object.values(bundle))
          if (out.fileName.endsWith(".css"))
            writeFileSync(join(options.dir, out.fileName), "@layer tokens{}");
        return original.call(this, options, bundle);
      };
    });
    await rejects(run, /differs from the snapshot/u);
  }, 30_000);

  it("N25: a closeBundle rewrite of emitted CSS fails at the on-disk recheck", async () => {
    const { run } = await harness(main("export {};"), (config) => {
      const guard = pluginNamed(config, "sharpladder:build-guard");
      let dir = null;
      const original = guard.writeBundle;
      guard.writeBundle = function writeHook(options, bundle) {
        dir = options.dir;
        return original.call(this, options, bundle);
      };
      guard.closeBundle = () => {
        const terminal = walkDist(dir);
        const [css] = [...terminal.keys()].filter((f) => f.endsWith(".css"));
        writeFileSync(join(dir, css), "@layer tokens{}");
      };
    });
    await rejects(run, /differs from the snapshot/u);
  }, 30_000);

  it("N25: emitted CSS changed after C3 fails at the release recheck", async () => {
    const built = await release(main("export {};"));
    const terminal = walkDist(built.outDir);
    const [css] = [...terminal.keys()].filter((f) => f.endsWith(".css"));
    expect(() => releaseRecheck(built.outDir, terminal)).not.toThrow();
    writeFileSync(join(built.outDir, css), "@layer tokens{}");
    expect(() => releaseRecheck(built.outDir, terminal)).toThrow(
      /differs from the snapshot/u,
    );
  }, 30_000);

  // The page approval rejects these routes before C3 in a build, so C3 is proved on the files.
  it("N17/N25: C3 fails every unshipped stylesheet route", async () => {
    const built = await release(main("export {};"));
    const terminal = walkDist(built.outDir);
    const [css] = [...terminal.keys()].filter((f) => f.endsWith(".css"));
    const page = terminal.get("index.html").bytes.toString("utf8");
    const [js] = [...terminal.keys()].filter((f) => f.endsWith(".js"));
    const withFile = (path, text) =>
      new Map(terminal).set(path, { bytes: Buffer.from(text) });
    const withPage = (from, to) =>
      withFile("index.html", page.replace(from, to));
    expect(routeViolations(terminal)).toEqual([]);
    const cases = [
      [
        withFile("assets/stray.css", "p{margin:0}"),
        /expected one stylesheet at C3, found 2/u,
      ],
      [
        withFile("public.css", "p{margin:0}"),
        /expected one stylesheet at C3, found 2/u,
      ],
      [
        withPage(
          "</head>",
          '<link rel="stylesheet" href="https://example.org/x.css"></head>',
        ),
        /links the stylesheet "https:\/\/example\.org\/x\.css"/u,
      ],
      [
        withPage(
          "</head>",
          '<link rel="stylesheet" href="/assets/unbuilt.css"></head>',
        ),
        /links the stylesheet "\/assets\/unbuilt\.css"/u,
      ],
      [
        withPage("</head>", "<style>p{margin:0}</style></head>"),
        /<style> element/u,
      ],
      [withPage("<body>", '<body style="margin:0">'), /style attribute/u],
      [
        withFile(
          css,
          `@import "x.css";${terminal.get(css).bytes.toString("utf8")}`,
        ),
        /uses the at-rule import/u,
      ],
      [
        withFile(
          js,
          `${terminal.get(js).bytes.toString("utf8")}\nexport const s = ":root{--bg:#000}";`,
        ),
        /carries a stylesheet as a string/u,
      ],
    ];
    for (const [files, pattern] of cases)
      expect(() => terminalProvenance(files, built.manifest)).toThrow(pattern);
  }, 30_000);
});

describe("Tool B table: configuration identity", () => {
  it("N18: another lightningcss binary or version fails at config", () => {
    expect(lightningViolations()).toEqual([]);
    expect(lightningVersion).toBe("1.33.0");
    const real = join(web, "node_modules", "lightningcss");
    expect(lightningViolations({ ours: real, theirs: join(web, "x") })).toEqual(
      ["the guard's lightningcss is not the one Vite loads"],
    );
    const other = fixture(
      {
        "node_modules-copy/package.json": '{ "version": "1.32.0" }\n',
      },
      { modules: false },
    );
    const copy = join(other.root, "node_modules-copy");
    expect(lightningViolations({ ours: copy, theirs: copy })).toEqual([
      "lightningcss is 1.32.0, not 1.33.0",
    ]);
  });
});

describe("Tool B table: positives", () => {
  it("P10: reversed imports still place every entry in layer tokens", async () => {
    const built = await release({
      ...main('import "./theme/base.css";\nimport "./theme/tokens.css";'),
      "src/theme/tokens.css": tokensSheet,
      "src/theme/base.css": "@layer base { body { margin: 0 } }\n",
    });
    expect(built.manifest.stage2.map((entry) => entry.context[0])).toEqual([
      "layer tokens",
    ]);
    expect(built.provenance.occurrences).toBe(1);
  }, 30_000);

  const production = manifestOf(
    readFileSync(join(web, "src/theme/tokens.css"), "utf8"),
  );
  const texts = (name) =>
    production.entries
      .filter((entry) => entry.name === name)
      .map((entry) => entry.text.value);

  it("P11: the header token is in all four contexts, serialised under 4.5 (a)", () => {
    expect(production.nameCount["--header-bg"]).toBe(4);
    expect(texts("--header-bg")).toEqual([
      "#f3f5f8e0",
      "#131517e0",
      "#131517e0",
      "#f3f5f8e0",
    ]);
  });

  it("P13: shadows and duplicate literals are one-to-one entries", () => {
    for (const name of ["--shadow-press", "--shadow-lift", "--shadow-pop"])
      expect(production.nameCount[name]).toBe(4);
    expect(texts("--ok")).toEqual(texts("--second"));
    expect(texts("--ok-soft")).toEqual(texts("--second-soft"));
  });

  it("records a readable selector and value beside each AST", () => {
    const [entry] = manifestOf(tokensSheet).entries;
    expect(entry.text).toEqual({ selector: ":root", value: "#fff" });
  });
});
