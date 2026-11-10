// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assetAdmission, generateFaces } from "../asset-licence-check.js";
import { limits, measure, releaseRecheck } from "./build.mjs";
import { cleanUp, fixture, inventoryFile, releaseRoot } from "./fixture.js";
import { walkDist } from "./output.js";

const web = join(import.meta.dirname, "..");
const production = JSON.parse(readFileSync(join(web, inventoryFile), "utf8"));
const record = production.assets.find((asset) => asset.id === "cascadia-code");
const [file] = record.distributedFiles;
const fontName = "cascadia-code-regular.woff2";
const fontBytes = readFileSync(join(web, "src", "theme", "fonts", fontName));
const licence = readFileSync(
  join(web, "assets", "licences", "cascadia-code", "OFL.txt"),
);

afterAll(cleanUp);

const face = ({
  url = `"./theme/fonts/${fontName}"`,
  weight = "400",
  stretch = "100%",
  family = '"SL Code"',
} = {}) => `@layer base {
  @font-face {
    font-family: ${family};
    src: url(${url}) format("woff2");
    font-weight: ${weight};
    font-style: normal;
    font-stretch: ${stretch};
    font-display: swap;
  }
}
`;

const inventory = (assets) =>
  `${JSON.stringify({ ...production, assets }, null, 2)}\n`;

// One shipped record, Cascadia Code, the smallest of the three production fonts.
function fontFiles({ css = face(), assets = [record], extra = {} } = {}) {
  return {
    [inventoryFile]: inventory(assets),
    "assets/licences/cascadia-code/OFL.txt": licence,
    [`src/theme/fonts/${fontName}`]: fontBytes,
    "src/fonts.css": css,
    "src/main.tsx": 'import "./fonts.css";\n',
    ...extra,
  };
}

const release = (files, ceiling) =>
  releaseRoot(fixture(files).root, {}, { ceiling });

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

// Suites timed at 30_000 run a real Vite build, which loads Vite cold the first time.

describe("asset admission: actual builds", () => {
  it("ships the bound font and its licence text, and reports them", async () => {
    const built = await release(fontFiles());
    expect([...built.files.keys()].sort()).toEqual([
      `assets/${fontName}`,
      expect.stringMatching(/^assets\/index-[\w-]+\.js$/u),
      "assets/licences/cascadia-code/OFL.txt",
      expect.stringMatching(/^assets\/style-[\w-]+\.css$/u),
      "index.html",
    ]);
    expect(built.report.fonts).toEqual([
      { path: `assets/${fontName}`, bytes: fontBytes.length },
    ]);
    expect(built.report.fontTotal).toBe(fontBytes.length);
    const evidence = JSON.parse(
      readFileSync(
        join(built.root, ".cache", "build-evidence", "provenance.json"),
        "utf8",
      ),
    );
    expect(evidence.files[`assets/${fontName}`]).toBe(file.sha256);
    expect(evidence.ledger).toEqual([
      {
        source: "src/fonts.css",
        sha256: expect.any(String),
        bound: 1,
        consumed: 1,
      },
      {
        source: "src/theme/tokens.css",
        sha256: expect.any(String),
        bound: 1,
        consumed: 1,
      },
    ]);
    expect(evidence.manifest.sha256).toBe(built.manifestSha256);
    expect(evidence.provenance).toEqual(built.provenance);
    expect(walkDist(built.outDir).has("provenance.json")).toBe(false);
  }, 30_000);

  it("fails a face that states another weight than the bound file", async () => {
    await rejects(
      release(fontFiles({ css: face({ weight: "700" }) })),
      /@font-face bytes at \[\d+, \d+\) differ from the bound faces/u,
    );
  }, 30_000);

  it("fails a face that states another family than the bound file", async () => {
    await rejects(
      release(fontFiles({ css: face({ family: '"Other"' }) })),
      /@font-face bytes at \[\d+, \d+\) differ from the bound faces/u,
    );
  }, 30_000);

  it("fails a shipped font no stylesheet loads", async () => {
    await rejects(
      release(fontFiles({ css: "@layer base { body { margin: 0 } }\n" })),
      /output is missing assets\/cascadia-code-regular\.woff2/u,
    );
  }, 30_000);

  it("fails an extra font the inventory does not ship", async () => {
    const css = `${face()}${face({ url: '"./theme/fonts/extra.woff2"', family: '"Extra"' })}`;
    await rejects(
      release(
        fontFiles({ css, extra: { "src/theme/fonts/extra.woff2": fontBytes } }),
      ),
      /unowned file assets\/extra\.woff2/u,
    );
  }, 30_000);

  it("fails a font loaded while its record is unshipped", async () => {
    const unshipped = { ...record, shipped: false };
    delete unshipped.distributedFamilyName;
    const error = await failure(release(fontFiles({ assets: [unshipped] })));
    expect(error?.message).toMatch(/build guard: /u);
  }, 30_000);

  it("fails fonts above a lowered aggregate ceiling", async () => {
    await rejects(
      release(fontFiles(), { ...limits, fontTotal: fontBytes.length - 1 }),
      new RegExp(`fonts total ${fontBytes.length} bytes, over the`, "u"),
    );
  }, 30_000);

  it("fails a stylesheet above a lowered gzip budget", async () => {
    await rejects(
      release(fontFiles(), { ...limits, cssGzip: 10 }),
      /gzip bytes, over the 10 budget/u,
    );
  }, 30_000);
});

describe("asset admission: release recheck after the terminal step", () => {
  const cases = [
    [
      "font bytes altered",
      (dir) => writeFileSync(join(dir, "assets", fontName), "x"),
      /differs from the snapshot/u,
    ],
    [
      "font added",
      (dir) => writeFileSync(join(dir, "assets", "added.woff2"), fontBytes),
      /extra file assets\/added\.woff2/u,
    ],
    [
      "font removed",
      (dir) => unlinkSync(join(dir, "assets", fontName)),
      /is missing assets\/cascadia-code-regular\.woff2/u,
    ],
    [
      "licence removed",
      (dir) => rmSync(join(dir, "assets", "licences"), { recursive: true }),
      /is missing assets\/licences/u,
    ],
  ];
  for (const [name, mutate, pattern] of cases) {
    it(`fails when a ${name} after verification`, async () => {
      const built = await release(fontFiles());
      const terminal = walkDist(built.outDir);
      expect(() => releaseRecheck(built.outDir, terminal)).not.toThrow();
      mutate(built.outDir);
      expect(() => releaseRecheck(built.outDir, terminal)).toThrow(pattern);
    }, 30_000);
  }
});

describe("asset admission: emitted stylesheet", () => {
  const sheet = "assets/style-a.css";
  const faces = generateFaces(JSON.parse(inventory([record]))).bytes.toString(
    "utf8",
  );
  // The bound face as the merged bundle places it: the trailing child of @layer base.
  const emitted = (slice = faces, rest = "") =>
    `@layer base{a{color:red}${slice}}${rest}`;

  async function admission() {
    const { base } = fixture(fontFiles(), { modules: false });
    const admitted = await assetAdmission({ root: base });
    expect(admitted.problems).toEqual([]);
    return admitted;
  }

  const outputs = (css, font = fontBytes) =>
    new Map([
      [sheet, Buffer.from(css)],
      [`assets/${fontName}`, font],
      ["assets/licences/cascadia-code/OFL.txt", licence],
    ]);
  // The guard owns the stylesheet, so its hash is whatever the fixture emitted.
  const owned = (css) =>
    new Map([
      [sheet, createHash("sha256").update(Buffer.from(css)).digest("hex")],
    ]);
  const problemsOf = async (css) => {
    const { check } = await admission();
    return check(outputs(css), owned(css)).join("\n");
  };

  it("admits the generated face as the trailing child of @layer base", async () => {
    const css = emitted();
    const { admit } = await admission();
    const { problems, slice } = admit(outputs(css), owned(css));
    expect(problems).toEqual([]);
    expect(slice).toEqual({
      path: sheet,
      start: css.indexOf("@font-face"),
      end: css.length - 1,
      byteLength: faces.length,
      sha256: createHash("sha256").update(faces).digest("hex"),
    });
  });

  it("admits the face as the first child of the layer block", async () => {
    expect(await problemsOf(`@layer base{${faces}}`)).toBe("");
  });

  it("admits a preceding statement ended by a semicolon", async () => {
    expect(await problemsOf(`@layer base{@layer x;${faces}}`)).toBe("");
  });

  const forms = [
    ["an external URL", "https://cdn.example/cascadia-code-regular.woff2"],
    [
      "a protocol-relative URL",
      "//cdn.example/assets/cascadia-code-regular.woff2",
    ],
    ["a data URL", "data:font/woff2;base64,AAAA"],
    ["a query", "/assets/cascadia-code-regular.woff2?v=1"],
    ["a fragment", "/assets/cascadia-code-regular.woff2#x"],
    ["percent encoding", "/assets/cascadia%2Dcode-regular.woff2"],
    ["a relative URL", "cascadia-code-regular.woff2"],
    ["another dist path", "/other/cascadia-code-regular.woff2"],
  ];
  for (const [name, url] of forms) {
    it(`fails ${name}`, async () => {
      const slice = faces.replace("/assets/cascadia-code-regular.woff2", url);
      expect(await problemsOf(emitted(slice))).toMatch(
        /differ from the bound faces/u,
      );
    });
  }

  it("fails altered font bytes", async () => {
    const css = emitted();
    const { check } = await admission();
    const altered = Buffer.from(fontBytes);
    altered[altered.length - 1] ^= 1;
    expect(check(outputs(css, altered), owned(css))).toContain(
      `output assets/${fontName} differs from its hash`,
    );
  });

  it("fails a shipped font with no emitted face", async () => {
    expect(await problemsOf("@layer base{a{color:red}}")).toMatch(
      /no emitted stylesheet holds the bound @font-face rules/u,
    );
  });

  it("fails faces split across two stylesheets", async () => {
    const css = emitted();
    const { check } = await admission();
    const actual = outputs(css);
    actual.set("assets/style-b.css", Buffer.from(css));
    const both = new Map([
      ...owned(css),
      ["assets/style-b.css", owned(css).get(sheet)],
    ]);
    expect(check(actual, both).join("\n")).toMatch(
      /@font-face rules are emitted in assets\/style-a\.css, assets\/style-b\.css/u,
    );
  });

  it("fails a stylesheet that is not strict UTF-8", async () => {
    const css = Buffer.concat([Buffer.from(emitted()), Buffer.from([0xff])]);
    const { check } = await admission();
    const actual = outputs("");
    actual.set(sheet, css);
    const hash = createHash("sha256").update(css).digest("hex");
    expect(check(actual, new Map([[sheet, hash]])).join("\n")).toMatch(
      /is not strict UTF-8/u,
    );
  });

  it("fails an @charset rule after the start", async () => {
    expect(await problemsOf(emitted(faces, '@charset "utf-8";'))).toMatch(
      /@charset/u,
    );
  });

  it("fails a url() outside a font face", async () => {
    const css = emitted(
      faces,
      'body { background: url("/assets/cascadia-code-regular.woff2") }\n',
    );
    expect(await problemsOf(css)).toContain(
      `output ${sheet}: function url() at byte ${css.lastIndexOf("url(")} is outside the token policy`,
    );
  });

  it.each([
    ["url", "a{background-image:url(https://e.example/x.png)}"],
    ["escaped url", 'a{background-image:u\\72l("https://e.example/x.png")}'],
    [
      "escaped url, space",
      'a{background-image:u\\72 l("https://e.example/x.png")}',
    ],
    [
      "escaped URL, uppercase",
      'a{background-image:U\\52L("https://e.example/x.png")}',
    ],
    [
      "escaped url, every letter",
      'a{background-image:\\75\\72\\6c("https://e.example/x.png")}',
    ],
    [
      "escaped url, mixed",
      'a{background-image:\\55 r\\4C("https://e.example/x.png")}',
    ],
    [
      "escaped url, six digits",
      'a{background-image:\\000075rl("https://e.example/x.png")}',
    ],
    ["image-set", 'a{background-image:image-set("x.png" 1x)}'],
    [
      "escaped image-set",
      'a{background-image:image-\\73 et("https://e.example/x.png" 1x)}',
    ],
    [
      "escaped -webkit-image-set",
      'a{background-image:-webkit-image-\\73 et("x.png" 1x)}',
    ],
    ["escaped image()", 'a{background-image:\\69mage("x.png")}'],
    ["escaped src()", 'a{background-image:s\\72 c("x.png")}'],
    ["url in a custom property", "a{--x:u\\72l(x.png)}"],
    ["url behind an escaped property name", "a{\\6d ask:u\\72l(x.png)}"],
    ["@import", '@import "x.css";'],
    ["@import url()", "@import url(x.css);"],
    ["escaped @import", '@\\69mport "x.css";'],
  ])(
    "fails a resource load through %s",
    async (_name, rest, pattern = /is outside the token policy/u) => {
      const css = rest.startsWith("@")
        ? `${rest}${emitted()}`
        : emitted(faces, rest);
      expect(await problemsOf(css)).toMatch(pattern);
    },
  );
});

describe("asset admission: measurement", () => {
  it("gzips each stylesheet at level 9 and totals the fonts", () => {
    const files = new Map([
      ["assets/a.css", { bytes: Buffer.from("a{}".repeat(100)) }],
      ["assets/x.woff2", { bytes: Buffer.alloc(10) }],
      ["assets/y.woff2", { bytes: Buffer.alloc(5) }],
    ]);
    const report = measure(files, { cssGzip: 30000, fontTotal: 15 });
    expect(report.problems).toEqual([]);
    expect(report.fontTotal).toBe(15);
    expect(report.css[0].gzip).toBeGreaterThan(0);
    expect(measure(files, { cssGzip: 30000, fontTotal: 14 }).problems).toEqual([
      "shipped fonts total 15 bytes, over the 14 ceiling",
    ]);
  });
});
