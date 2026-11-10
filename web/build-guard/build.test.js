// @vitest-environment node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import config from "../vite.config.ts";
import {
  approvedHtml,
  buildFixture,
  buildRoot,
  cleanUp,
  fixture,
  link,
  outputFiles,
} from "./fixture.js";
import { guard } from "./index.js";

afterAll(cleanUp);

// Only suites that run a real Vite build are timed at 30_000; Vite loads cold at first.

describe("build guard: configuration", () => {
  it("guards every worker bundle and copies no public folder", () => {
    expect(config.publicDir).toBe(false);
    expect(config.plugins[0].name).toBe("sharpladder:build-guard");
    expect(config.worker.plugins().map(({ name }) => name)).toEqual([
      "sharpladder:build-guard",
    ]);
  });

  it("fails any worker build", async () => {
    const context = {
      error: (text) => {
        throw new Error(text);
      },
    };
    await expect(
      guard({ worker: true }).buildStart.call(context),
    ).rejects.toThrow(/unexpected worker build/u);
  });
});

const main = (code) => ({ "src/main.tsx": `${code}\n` });
const page = (from, to) => approvedHtml.replace(from, to);
const head = "    <title>Fixture</title>\n";
const body = '    <div id="root"></div>\n';

// Every failure must come from the guard, never from a later plugin that happened to choke.
async function rejects(files, pattern, options) {
  const error = await buildFixture(files, options).then(
    () => null,
    (e) => e,
  );
  expect(error?.message).toMatch(/build guard: /u);
  expect(error?.message).toMatch(pattern);
}

describe("build guard: module ids", () => {
  it("fails on a wrapper outside the project", async () => {
    await rejects(
      {
        ...main('import "../../outside/w.js";'),
        "../outside/w.js": "export {};\n",
      },
      /outside src and node_modules/u,
    );
  });

  it("fails on a link inside src that leads outside", async () => {
    const { base, root } = fixture({
      ...main('import "./lib/w.ts";'),
      "../outside/w.ts": "export {};\n",
    });
    link(join(base, "outside"), join(root, "src", "lib"));
    await expect(buildRoot(root)).rejects.toThrow(
      /build guard: id outside src and node_modules/u,
    );
  });

  it("fails when src itself is a link", async () => {
    const { base, root } = fixture({ "../outside/main.tsx": "export {};\n" });
    link(join(base, "outside"), join(root, "src"));
    await expect(buildRoot(root)).rejects.toThrow(
      /build guard: src resolves outside/u,
    );
  });

  it.each(["w.jsx", "w.mts", "w.js"])(
    "fails on first-party %s",
    async (name) => {
      await rejects(
        { ...main(`import "./${name}";`), [`src/${name}`]: "export {};\n" },
        /is not \.ts, \.tsx or \.css/u,
      );
    },
  );

  it.each(["?#x", "?inline"])(
    "fails on a query or fragment %s",
    async (suffix) => {
      await rejects(
        {
          ...main(`import "./Card.module.css${suffix}";`),
          "src/Card.module.css": ".card { margin: 0 }\n",
        },
        /query or fragment/u,
      );
    },
  );

  it.each(["pcss", "postcss"])(
    "fails on a .module.%s stylesheet",
    async (ext) => {
      await rejects(
        {
          ...main(`import "./a.module.${ext}";`),
          [`src/a.module.${ext}`]: ".card { margin: 0 }\n",
        },
        /must be \.module\.css|is not \.ts, \.tsx or \.css/u,
      );
    },
  );

  it.each([
    ["\\0vite/modulepreload-polyfill", /reserved specifier/u],
    ["vite/modulepreload-polyfill", /reserved specifier/u],
  ])("fails on an authored import of %s", async (specifier, pattern) => {
    await rejects(main(`import "${specifier}";`), pattern);
  });
}, 30_000);

describe("build guard: source constructs", () => {
  const css = {
    "src/a.module.css": ".a { margin: 0 }\n",
    "src/a.ts": "export {};\n",
  };

  it.each([
    [
      "eager glob",
      'import.meta.glob("./*.css", { eager: true });',
      /import\.meta/u,
    ],
    ["lazy glob", 'import.meta.glob("./*.css");', /import\.meta/u],
    [
      "computed import()",
      'const x = "./a.ts";\nvoid import(x);',
      /import\(\)/u,
    ],
    ["literal import()", 'void import("./a.ts");', /import\(\)/u],
    ["new URL", 'new URL("./a.module.css", import.meta.url);', /import\.meta/u],
    [
      "new Worker",
      'new Worker(new URL("./a.ts", import.meta.url));',
      /reference to Worker/u,
    ],
    [
      "Worker binding",
      "const W = Worker;\nconsole.log(W);",
      /reference to Worker/u,
    ],
    [
      "SharedWorker global",
      "console.log(globalThis.SharedWorker);",
      /reference to SharedWorker/u,
    ],
    [
      "import attribute",
      'import a from "./a.ts" with { type: "json" };\nconsole.log(a);',
      /import attributes/u,
    ],
  ])("fails on %s", async (_name, code, pattern) => {
    await rejects({ ...css, ...main(code) }, pattern);
  });

  it.each([
    ['.a { composes: b from "./o.module.css"; }', /composes/u],
    [".a { composes: b; } .b { margin: 0 }", /composes/u],
    [".a { COMPOSES: b from global; }", /composes/u],
    ['@import "./x.css";\n.a { margin: 0 }', /@import/u],
    [".a { compos\\65s: b; }", /escaped property/u],
  ])("fails on the stylesheet %s", async (sheet, pattern) => {
    await rejects(
      {
        ...main('import "./a.module.css";'),
        "src/a.module.css": `${sheet}\n`,
        "src/o.module.css": ".b { margin: 0 }\n",
        "src/x.css": "body { margin: 0 }\n",
      },
      pattern,
    );
  });
}, 30_000);

describe("build guard: index.html", () => {
  it.each([
    [
      "link stylesheet",
      head,
      `${head}    <link rel="stylesheet" href="/x.css" />\n`,
    ],
    [
      "link modulepreload",
      head,
      `${head}    <link rel="modulepreload" href="/src/a.ts" />\n`,
    ],
    ["iframe", body, `${body}    <iframe src="/x.html"></iframe>\n`],
    ["base", head, `${head}    <base href="/" />\n`],
    [
      "meta refresh",
      head,
      `${head}    <meta http-equiv="refresh" content="0" />\n`,
    ],
    [
      "inline script",
      body,
      `${body}    <script type="module">console.log(1)</script>\n`,
    ],
    [
      "second script",
      body,
      `${body}    <script type="module" src="/src/a.ts"></script>\n`,
    ],
    ["onload attribute", "<body>", '<body onload="go()">'],
    [
      "style attribute",
      '<div id="root">',
      '<div id="root" style="color: red">',
    ],
  ])("fails with %s", async (_name, from, to) => {
    await rejects(
      {
        ...main("export {};"),
        "src/a.ts": "export {};\n",
        "index.html": page(from, to),
      },
      /not the approved page/u,
    );
  });

  it("fails on a public script tag", async () => {
    await rejects(
      {
        ...main("export {};"),
        "public/x.js": "console.log(1);\n",
        "index.html": page(body, `${body}    <script src="/x.js"></script>\n`),
      },
      /not the approved page/u,
    );
  });

  // Public files are copied only when the build writes, so this build writes to a temp folder.
  it("copies no planted public file", async () => {
    const { base, root } = fixture({
      ...main("export {};"),
      "public/x.js": "console.log(1);\n",
    });
    const outDir = join(base, "out");
    await buildRoot(root, {
      build: { write: true, outDir, emptyOutDir: true },
    });
    expect(existsSync(join(outDir, "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "x.js"))).toBe(false);
  });

  it("fails when a public folder is enabled", async () => {
    await expect(
      buildRoot(fixture(main("export {};")).root, { publicDir: "public" }),
    ).rejects.toThrow(/build guard: publicDir is not false/u);
  });
}, 30_000);

describe("build guard: clean builds", () => {
  it("builds the real app with its fonts and licence texts", async () => {
    const files = outputFiles(await buildRoot(join(import.meta.dirname, "..")));
    expect(files).toEqual(
      expect.arrayContaining([
        "index.html",
        "assets/noto-sans.woff2",
        "assets/noto-sans-display.woff2",
        "assets/cascadia-code-regular.woff2",
        "assets/licences/noto-sans/OFL.txt",
        "assets/licences/noto-sans-display/OFL.txt",
        "assets/licences/cascadia-code/OFL.txt",
      ]),
    );
    expect(files).toHaveLength(9);
  });

  it("builds a component that reads a CSS module", async () => {
    const files = outputFiles(
      await buildFixture({
        ...main(
          [
            'import { createRoot } from "react-dom/client";',
            'import { App } from "./App.tsx";',
            'createRoot(document.getElementById("root") as HTMLElement).render(<App />);',
          ].join("\n"),
        ),
        "src/App.tsx": [
          'import styles from "./Card.module.css";',
          "export function App() {",
          "  return <p className={styles.card}>Card</p>;",
          "}",
          "",
        ].join("\n"),
        "src/Card.module.css": ".card { margin: 0 }\n",
      }),
    );
    expect(files.some((f) => f.endsWith(".css"))).toBe(true);
  });

  it("builds a plain global stylesheet", async () => {
    const { root } = fixture(main('import "./global.css";'));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "global.css"), "body { margin: 0 }\n");
    const files = outputFiles(await buildRoot(root));
    expect(files.some((f) => f.endsWith(".css"))).toBe(true);
  });
}, 30_000);

describe("build guard: stylesheet bytes", () => {
  const sheet = (bytes) => ({
    ...main('import "./a.css";'),
    "src/a.css": Buffer.from(bytes),
  });
  const cases = [
    [
      "a BOM followed by a newline",
      "﻿\n.a { margin: 0 }\n",
      /a\.css starts with a byte order mark at byte 0/u,
    ],
    [
      "a BOM followed by an at-rule",
      "﻿@layer base { .a { margin: 0 } }\n",
      /a\.css starts with a byte order mark at byte 0/u,
    ],
    [
      "CRLF line ends",
      ".a {\r\n  margin: 0;\r\n}\r\n",
      /a\.css holds a carriage return at byte 4/u,
    ],
    [
      "a lone CR",
      ".a { margin: 0 }\r.b { margin: 0 }\n",
      /a\.css holds a carriage return at byte 16/u,
    ],
  ];
  for (const [name, text, pattern] of cases) {
    it(`fails ${name} before compiling`, async () => {
      await rejects(sheet(text), pattern);
    });
  }

  it("keeps an interior U+FEFF outside the byte rule", async () => {
    const files = outputFiles(
      await buildFixture(sheet('.a { content: "﻿" }\n')),
    );
    expect(files).toContain("index.html");
  });
}, 30_000);
