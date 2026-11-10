// @vitest-environment node
import { copyFileSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fontFace,
  fontsSheet,
  lintAs,
  lintComposed,
  makeRoot,
  productionInventory,
  shippedFonts,
  write,
} from "./harness.js";

const [sans, display, code] = shippedFonts;
const faces = (overrides = {}) =>
  shippedFonts.map((f) => fontFace(f, overrides[f] ?? {}));

/** Lints one sheet in a fresh root; returns every warning text, joined. */
async function lintFonts(sheet, { inventory, at, prepare } = {}) {
  const { paths } = makeRoot({ inventory });
  prepare?.(paths);
  const target = at ? at(paths) : paths.fontsFile;
  write(target, sheet);
  const r = await lintAs(paths, target, sheet);
  expect(r.invalid).toEqual([]);
  return r.all.map((w) => w.text).join("\n");
}

const passes = async (sheet, options) =>
  expect(await lintFonts(sheet, options)).toBe("");
const fails = async (sheet, pattern, options) =>
  expect(await lintFonts(sheet, options)).toMatch(pattern);
const withCode = (descriptors) => fontsSheet(faces({ [code]: descriptors }));

const inventoryWith = (change) => {
  const inventory = productionInventory();
  change(inventory.assets.find((a) => a.id === "cascadia-code"));
  return inventory;
};

describe("F1 @font-face admission", () => {
  it("A98 fonts.css with every admitted descriptor passes, with and without unicode-range", async () => {
    await passes(fontsSheet());
    const coverage = productionInventory()
      .assets.find((a) => a.id === "cascadia-code")
      .distributedFiles[0].coverage.join(", ");
    await passes(withCode({ "unicode-range": coverage }));
    const composed = await lintComposed((p) => p.fontsFile, fontsSheet());
    expect(composed).toEqual({ state: "pass", lines: [] });
  }, 120_000);

  it("A99 @font-face in another file fails", async () => {
    await fails(fontsSheet(), /@font-face is allowed only in fonts.css/u, {
      at: (p) => join(p.src, "theme", "base.css"),
    });
  });

  it("A100 @font-face outside the @layer base block fails", async () => {
    const bare = `${fontFace(code)}\n`;
    await fails(bare, /direct child of the @layer base block/u);
    const other = `@layer overrides {\n${fontFace(code)}\n}\n`;
    await fails(other, /direct child of the @layer base block/u);
  });

  it("A101 a nested rule in the block or inside an @font-face fails", async () => {
    const inBlock = fontsSheet([
      ...faces(),
      "  .x {\n    color: var(--text);\n  }",
    ]);
    await fails(inBlock, /fonts.css holds only @font-face rules/u);
    const inFace = fontsSheet(faces()).replace(
      "font-display: swap;",
      "font-display: swap;\n    .x { color: var(--text); }",
    );
    await fails(inFace, /nested rule inside @font-face/u);
  });

  it("A102 !important on a descriptor fails", async () => {
    await fails(withCode({ "font-display": "swap !important" }), /!important/u);
  });

  it("A103 a declaration rule in fonts.css fails", async () => {
    const rule = fontsSheet([
      ...faces(),
      "  html {\n    color: var(--text);\n  }",
    ]);
    await fails(rule, /fonts.css holds only @font-face rules/u);
  });

  it.each([
    "font-family",
    "src",
    "font-weight",
    "font-style",
    "font-stretch",
    "font-display",
  ])("A104 a missing %s fails", async (name) => {
    await fails(
      withCode({ [name]: null }),
      new RegExp(`descriptor ${name} is missing`, "u"),
    );
  });

  it("A105 a repeated descriptor fails", async () => {
    await fails(
      withCode({ "font-display": "swap;\n    font-display: swap" }),
      /descriptor font-display is repeated/u,
    );
  });

  it.each([
    ["size-adjust", "100%"],
    ["font-feature-settings", '"liga" 0'],
    ["ascent-override", "90%"],
    ["font-variation-settings", '"wght" 400'],
    ["font-named-instance", '"Regular"'],
  ])("A106 the unknown descriptor %s fails", async (name, value) => {
    await fails(
      withCode({ [name]: value }),
      new RegExp(`descriptor ${name} is not admitted`, "u"),
    );
  });

  it.each([
    ["font-weight", "bold"],
    ["font-weight", "0"],
    ["font-weight", "1001"],
    ["font-weight", "900 100"],
    ["font-stretch", "100"],
    ["font-stretch", "40%"],
    ["font-stretch", "100% 62.5%"],
  ])(
    "A107 an invalid, out-of-range or reversed %s %s fails",
    async (name, value) => {
      await fails(
        withCode({ [name]: value }),
        new RegExp(`${name} must be`, "u"),
      );
    },
  );

  it.each([
    ["font-weight", "700", /font-weight differs from the bound face/u],
    ["font-style", "italic", /font-style differs from the bound face/u],
    ["font-stretch", "75%", /font-stretch differs from the bound face/u],
  ])(
    "A108 %s %s not matching the bound face fails",
    async (name, value, pattern) => {
      await fails(withCode({ [name]: value }), pattern);
    },
  );

  it("A108b a face the inventory and the CSS agree on still fails against the font", async () => {
    const inventory = inventoryWith((a) => {
      a.distributedFiles[0].face.weightRange = [400, 700];
    });
    await fails(
      withCode({ "font-weight": "400 700" }),
      /face weightRange .* differs from the font/u,
      {
        inventory,
      },
    );
  });

  it("A109 a width range on a static face without a width axis fails", async () => {
    await fails(
      withCode({ "font-stretch": "62.5% 100%" }),
      /font-stretch differs from the bound face/u,
    );
  });

  it("A110 unicode-range differing from the declared coverage fails", async () => {
    await fails(
      withCode({ "unicode-range": "U+0000-00FF" }),
      /unicode-range differs from the declared coverage/u,
    );
  });

  it("A111 a family other than the bound face alias fails", async () => {
    await fails(
      withCode({ "font-family": '"Cascadia Code"' }),
      /is not the bound face alias/u,
    );
  });

  it("A112 the family of an unshipped record fails", async () => {
    const inventory = inventoryWith((a) => {
      a.shipped = false;
    });
    await fails(
      fontsSheet(),
      /belongs to the unshipped record cascadia-code/u,
      { inventory },
    );
  });

  it("A113 an escaped @font-face fails", async () => {
    const escaped = fontsSheet().replace("@font-face", "@font\\-face");
    await fails(escaped, /escape in an at-rule/u);
  });

  it.each(["optional", "block", "auto"])(
    "A114 font-display %s fails",
    async (value) => {
      await fails(
        withCode({ "font-display": value }),
        /font-display must be swap/u,
      );
    },
  );

  it("A115 two faces with the same family, weight, style and stretch fail", async () => {
    const twin = fontFace(sans, {
      src: `url("./fonts/${display}") format("woff2")`,
    });
    await fails(
      fontsSheet([...faces(), twin]),
      /share family, weight, style and stretch/u,
    );
  });

  it("A116 a shipped file with no face binding fails", async () => {
    await fails(
      fontsSheet(faces().slice(0, 2)),
      /cascadia-code-regular.woff2 has no @font-face binding/u,
    );
  });

  it("A117 one file bound by two faces fails", async () => {
    const again = fontFace(code, {
      "font-family": '"SL Code"',
      "font-weight": "400",
    });
    await fails(
      fontsSheet([...faces(), again]),
      /is bound by two @font-face rules/u,
    );
  });

  it("A118 existing at-rule bans stay: @import and @supports still fail", async () => {
    await fails(
      `@import "./tokens.css";\n${fontsSheet()}`,
      /@import is not allowed/u,
    );
    await fails(
      fontsSheet().replace(
        "@layer base {",
        "@supports (display: grid) {\n@layer base {",
      ) + "}\n",
      /at-rule-allowed-list|Unexpected at-rule/u,
    );
  });
});

describe("F2 url() admission in src", () => {
  const src = (value) => withCode({ src: value });

  it.each([
    [
      "a scheme",
      'url("https://example.com/a.woff2") format("woff2")',
      /a scheme/u,
    ],
    [
      "a protocol-relative path",
      'url("//example.com/a.woff2") format("woff2")',
      /protocol-relative/u,
    ],
    [
      "an absolute path",
      'url("/fonts/a.woff2") format("woff2")',
      /an absolute path/u,
    ],
    [
      "a query",
      'url("./fonts/cascadia-code-regular.woff2?v=1") format("woff2")',
      /a query/u,
    ],
    [
      "a fragment",
      'url("./fonts/cascadia-code-regular.woff2#x") format("woff2")',
      /a fragment/u,
    ],
    [
      "a .. segment",
      'url("./fonts/../fonts/cascadia-code-regular.woff2") format("woff2")',
      /a \.\. segment/u,
    ],
    [
      "a backslash",
      'url("./fonts\\\\cascadia-code-regular.woff2") format("woff2")',
      /escape in src|a backslash/u,
    ],
    [
      "a CSS escape",
      'url("./fonts/cascadia\\2d code-regular.woff2") format("woff2")',
      /escape in src/u,
    ],
    [
      "a percent escape",
      'url("./fonts/cascadia%2Dcode-regular.woff2") format("woff2")',
      /a percent escape/u,
    ],
    [
      "a URL-control character",
      'url("./fonts/cascadia\tcode.woff2") format("woff2")',
      /URL-control character/u,
    ],
    [
      "an unquoted URL",
      'url(./fonts/cascadia-code-regular.woff2) format("woff2")',
      /one quoted path/u,
    ],
    [
      "a data URL",
      'url("data:font/woff2;base64,AAAA") format("woff2")',
      /a scheme/u,
    ],
    ["local()", 'local("Cascadia Code")', /src must start with url\(\)/u],
    [
      "two sources",
      'url("./fonts/cascadia-code-regular.woff2") format("woff2"), url("./fonts/noto-sans.woff2") format("woff2")',
      /exactly one source/u,
    ],
    [
      "format(woff)",
      'url("./fonts/cascadia-code-regular.woff2") format("woff")',
      /format\("woff2"\)/u,
    ],
    [
      "format(truetype)",
      'url("./fonts/cascadia-code-regular.woff2") format("truetype")',
      /format\("woff2"\)/u,
    ],
    [
      "no format()",
      'url("./fonts/cascadia-code-regular.woff2")',
      /format\("woff2"\)/u,
    ],
    [
      "tech()",
      'url("./fonts/cascadia-code-regular.woff2") tech(variations)',
      /format\("woff2"\)/u,
    ],
  ])("A119 a src with %s fails", async (_, value, pattern) => {
    await fails(src(value), pattern);
  });

  it('A120 a non-WOFF2 file labelled format("woff2") fails', async () => {
    const ttf = join(
      import.meta.dirname,
      "..",
      "assets",
      "fonts",
      "noto-sans",
      "variable.ttf",
    );
    const inventory = productionInventory();
    const entry = inventory.assets.find((a) => a.id === "noto-sans")
      .distributedFiles[0];
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const bytes = readFileSync(ttf);
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
    entry.byteLength = bytes.length;
    await fails(fontsSheet(), /container is ttf, not woff2|container/u, {
      inventory,
      prepare: (p) => copyFileSync(ttf, join(p.src, "theme", "fonts", sans)),
    });
  });

  it("A121 a file whose hash is not in the inventory fails", async () => {
    await fails(fontsSheet(), /does not match its inventory hash/u, {
      prepare: (p) =>
        copyFileSync(
          join(p.src, "theme", "fonts", display),
          join(p.src, "theme", "fonts", code),
        ),
    });
  });

  it("A122 a path that is no distributed file fails", async () => {
    await fails(
      src('url("./fonts/unknown.woff2") format("woff2")'),
      /not a distributed file in the asset inventory/u,
    );
  });

  it("A123 a path bound to another face's record fails", async () => {
    const swapped = fontFace(sans, {
      src: `url("./fonts/${display}") format("woff2")`,
    });
    const rest = faces().slice(1);
    await fails(
      fontsSheet([swapped, ...rest]),
      /is not the bound face alias|bound by two/u,
    );
  });

  it("A124 a path through a parent-directory link fails", async () => {
    await fails(fontsSheet(), /passes through a link or junction/u, {
      prepare: (p) => {
        const fonts = join(p.src, "theme", "fonts");
        const moved = join(p.src, "theme", "real-fonts");
        renameSync(fonts, moved);
        symlinkSync(moved, fonts, "junction");
      },
    });
  });

  it("A125 a symlinked font file fails where the platform allows a file link", async (ctx) => {
    let linked = true;
    const result = await lintFonts(fontsSheet(), {
      prepare: (p) => {
        const fonts = join(p.src, "theme", "fonts");
        const elsewhere = join(p.src, "elsewhere");
        mkdirSync(elsewhere);
        renameSync(join(fonts, code), join(elsewhere, code));
        try {
          symlinkSync(join(elsewhere, code), join(fonts, code), "file");
        } catch (error) {
          if (error.code !== "EPERM") throw error;
          linked = false;
        }
      },
    });
    // Without the privilege the file is missing, which must fail closed as well.
    expect(result).toMatch(
      linked ? /passes through a link or junction/u : /cannot be read/u,
    );
    if (!linked)
      ctx.annotate("file symlink needs a privilege here; Linux covers it");
  });
});
