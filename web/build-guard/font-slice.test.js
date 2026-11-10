// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parse, walk } from "css-tree";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cssString, generateFaces } from "../asset-licence-check.js";
import { releaseRecheck, terminalAdmission } from "./build.mjs";
import { publicBase } from "./contract.js";
import {
  cleanUp,
  fixture,
  harness,
  inventoryFile,
  pluginNamed,
  releaseRoot,
  sliceRecordFile,
} from "./fixture.js";
import { walkDist } from "./output.js";
import { minifySheet } from "./provenance.js";

const web = join(import.meta.dirname, "..");
const repo = join(web, "..");
const production = JSON.parse(readFileSync(join(web, inventoryFile), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expected = generateFaces(production);

afterAll(cleanUp);

/** The production theme, inventory and fonts, so the fixture bundle has the production slice. */
function productionFiles() {
  const theme = (name) => readFileSync(join(web, "src", "theme", name));
  const files = {
    [inventoryFile]: readFileSync(join(web, inventoryFile)),
    [sliceRecordFile]: readFileSync(join(web, sliceRecordFile)),
    "src/theme/tokens.css": theme("tokens.css"),
    "src/theme/base.css": theme("base.css"),
    "src/theme/fonts.css": theme("fonts.css"),
    "src/main.tsx": [
      'import "./theme/tokens.css";',
      'import "./theme/base.css";',
      'import "./theme/fonts.css";',
      "",
    ].join("\n"),
  };
  const local = (path) => path.replace(/^web\//u, "");
  for (const asset of production.assets.filter((a) => a.shipped)) {
    const text = asset.licenceText.sourcePath;
    files[local(text)] = readFileSync(join(repo, text));
    for (const file of asset.distributedFiles)
      files[local(file.sourcePath)] = readFileSync(join(repo, file.sourcePath));
  }
  return files;
}

const failure = (promise) =>
  promise.then(
    () => null,
    (error) => error,
  );

// Each face in the minified bundle holds no brace, so the next } closes it.
function faceSpans(css) {
  const spans = [];
  for (let i = css.indexOf("@font-face{"); i !== -1;) {
    const end = css.indexOf("}", i) + 1;
    spans.push([i, end]);
    i = css.indexOf("@font-face{", end);
  }
  return spans;
}

const insertAt = (css, at, text) => css.slice(0, at) + text + css.slice(at);
const face = (css, n) => css.slice(...faceSpans(css)[n]);
const wrap = (css, n, open) => {
  const [s, e] = faceSpans(css)[n];
  return `${css.slice(0, s)}${open}${css.slice(s, e)}}${css.slice(e)}`;
};
const lastEnd = (css) => faceSpans(css)[2][1];
const loadingFace =
  '{font-family:x;src:url(/assets/noto-sans.woff2)format("woff2")}';

const DIFF = /@font-face bytes at \[\d+, \d+\) differ from the bound faces/u;
const TRAIL =
  /is not among the trailing children of the top-level @layer base/u;
const COUNT = /@font-face rules, 3 bound/u;
const CLOSE =
  /@layer base block is not closed right after the last @font-face/u;
const BEFORE =
  /byte before the first @font-face does not end the preceding rule/u;
const POLICY = /is outside the token policy/u;

// [name, mutation of the emitted stylesheet, admission pattern, pattern if an earlier stage wins]
const cases = [
  [
    "an NBSP weight",
    (css) => css.replace("font-weight:100 900", "font-weight:100\u00a0900"),
    DIFF,
  ],
  [
    "an NBSP stretch",
    (css) => css.replace("62.5% 100%", "62.5%\u00a0100%"),
    DIFF,
  ],
  [
    "font-display block",
    (css) => css.replace("font-display:swap", "font-display:block"),
    DIFF,
  ],
  [
    "an added size-adjust",
    (css) =>
      css.replace("font-display:swap", "font-display:swap;size-adjust:150%"),
    DIFF,
  ],
  [
    "an added ascent-override",
    (css) =>
      css.replace("font-display:swap", "font-display:swap;ascent-override:90%"),
    DIFF,
  ],
  [
    "an unknown descriptor",
    (css) => css.replace("font-display:swap", "font-display:swap;foo:bar"),
    DIFF,
  ],
  [
    "an escaped descriptor",
    (css) =>
      css.replace(
        "font-display:swap",
        "font-display:swap;\\66ont-display:block",
      ),
    DIFF,
  ],
  [
    "a garbage unicode-range",
    (css) =>
      css.replace(
        "font-display:swap",
        "font-display:swap;unicode-range:garbage",
      ),
    DIFF,
  ],
  [
    "a valid unicode-range",
    (css) =>
      css.replace(
        "font-display:swap",
        "font-display:swap;unicode-range:U+0-FF",
      ),
    DIFF,
  ],
  [
    "an @media not all wrapper",
    (css) => wrap(css, 1, "@media not all{"),
    TRAIL,
  ],
  [
    "a nested layer wrapper",
    (css) => wrap(css, 2, "@layer base{"),
    TRAIL,
    /nested @layer base/u,
  ],
  [
    "a face outside the layer",
    (css) => {
      const [s, e] = faceSpans(css)[2];
      return `${css.slice(0, s)}${css.slice(e)}${css.slice(s, e)}`;
    },
    TRAIL,
  ],
  [
    "reordered faces",
    (css) => {
      const [[a, b], [, c]] = faceSpans(css);
      return css.slice(0, a) + css.slice(b, c) + css.slice(a, b) + css.slice(c);
    },
    DIFF,
  ],
  [
    "a duplicate face",
    (css) => insertAt(css, lastEnd(css), face(css, 2)),
    COUNT,
  ],
  [
    "a missing face",
    (css) => {
      const [s, e] = faceSpans(css)[2];
      return css.slice(0, s) + css.slice(e);
    },
    /2 @font-face rules, 3 bound/u,
  ],
  [
    "an intervening rule",
    (css) => insertAt(css, faceSpans(css)[1][0], "a{color:red}"),
    TRAIL,
  ],
  [
    "a trailing rule",
    (css) => insertAt(css, lastEnd(css), "a{color:red}"),
    TRAIL,
  ],
  ["a trailing comment", (css) => insertAt(css, lastEnd(css), "/**/"), CLOSE],
  ["trailing whitespace", (css) => insertAt(css, lastEnd(css), " "), CLOSE],
  [
    "a space before the first face",
    (css) => insertAt(css, faceSpans(css)[0][0], " "),
    BEFORE,
  ],
  [
    "a comment before the first face",
    (css) => insertAt(css, faceSpans(css)[0][0], "/**/"),
    BEFORE,
  ],
  [
    "an escaped face name",
    (css) => css.replace("@font-face{", "@f\\6fnt-face{"),
    DIFF,
  ],
  [
    "an extra face behind an escaped name",
    (css) => `${css}@f\\6fnt-face${loadingFace}`,
    COUNT,
  ],
  [
    "an escaped layer name",
    (css) => css.replace("@layer base{", "@layer b\\61se{"),
    /@layer base header is not the canonical/u,
    /unknown layer/u,
  ],
  [
    "a second base block",
    (css) => `${css}@layer base{a{color:red}}`,
    /2 top-level @layer base blocks, not one/u,
  ],
  ["a string @import", (css) => `@import "x.css";${css}`, POLICY],
  ["a url() @import", (css) => `@import url(x.css);${css}`, POLICY],
  ["a leading byte-order mark", (css) => `\ufeff${css}`, /byte-order mark/u],
  ["a leading @charset", (css) => `@charset "utf-8";${css}`, /@charset/u],
  [
    "an escaped url()",
    (css) => `${css}a{background-image:u\\72l("https://e.example/x.png")}`,
    POLICY,
  ],
  [
    "an escaped image-set()",
    (css) => `${css}a{background-image:image-\\73 et("x.png" 1x)}`,
    POLICY,
  ],
  [
    "an extra src entry",
    (css) => css.replace('format("woff2");', 'format("woff2"),local(x);'),
    DIFF,
  ],
  [
    "a duplicate descriptor",
    (css) =>
      css.replace("font-display:swap", "font-display:swap;font-display:swap"),
    DIFF,
  ],
  [
    "a redundant equal-endpoint pair",
    (css) => css.replace("font-weight:400;", "font-weight:400 400;"),
    DIFF,
  ],
  [
    "a comment inside the slice",
    (css) => css.replace("font-weight:400;", "font-weight:/**/400;"),
    DIFF,
  ],
  [
    "whitespace inside the slice",
    (css) => css.replace("font-weight:400;", "font-weight: 400;"),
    DIFF,
  ],
  [
    "an unclosed layer block at the end",
    (css) => css.slice(0, lastEnd(css)),
    CLOSE,
    /Unclosed block/u,
  ],
  [
    "a nested at-rule inside a face",
    (css) => insertAt(css, lastEnd(css) - 1, ";@media all{}"),
    /not a closed block of declarations only/u,
  ],
  [
    "a nested rule the parser refuses inside a face",
    (css) => insertAt(css, lastEnd(css) - 1, ";@media all{a{color:red}}"),
    /does not parse/u,
  ],
  [
    "a unicode-range face outside the slice",
    (css) =>
      `${css}@font-face{font-family:x;src:url(/assets/noto-sans.woff2)format("woff2");unicode-range:U+0-FF}`,
    COUNT,
  ],
];

const append = (rule) => (css) => `${css}${rule}`;
const prepend = (rule) => (css) => `${rule}${css}`;
const faceEnd = (css) => lastEnd(css) + 1;
const UNCLOSED = /an unclosed block or function at byte \d+/u;
const BACKSLASH = /a backslash that starts no valid escape at byte \d+/u;
// The guard's layer check parses with postcss first, so a malformed sheet can fail there.
const POSTCSS = /unparsable output CSS/u;

// Section 8d: every carrier fails outside the slice, whatever property, context or spelling holds it.
const policyCases = [
  ["a cursor url()", append('a{cursor:url("https://e.example/c.cur"),auto}')],
  ["a cursor url with a hotspot", append("a{cursor:url(c.cur) 4 4,auto}")],
  ["an escaped cursor url", append("a{cursor:\\75 rl(c.cur),auto}")],
  ["list-style-image", append("a{list-style-image:url(x.png)}")],
  ["list-style", append("a{list-style:square url(x.png) inside}")],
  ["border-image", append("a{border-image:url(x.png) 30 round}")],
  ["border-image-source", append("a{border-image-source:url(x.png)}")],
  ["mask", append("a{mask:url(m.svg#m)}")],
  ["-webkit-mask", append("a{-webkit-mask:url(m.png)}")],
  ["mask-image", append("a{mask-image:url(m.png)}")],
  ["mask-border", append("a{mask-border:url(m.png) 30}")],
  ["filter url(#x)", append("a{filter:url(#x)}")],
  ["an external filter", append("a{filter:url(f.svg#x)}")],
  ["clip-path url(#x)", append("a{clip-path:url(#x)}")],
  ["an external clip-path", append("a{clip-path:url(c.svg#x)}")],
  ["fill url(#x)", append("a{fill:url(#x)}")],
  ["an external fill", append("a{fill:url(p.svg#x) red}")],
  ["stroke url(#x)", append("a{stroke:url(#x)}")],
  ["an external stroke", append("a{stroke:url(p.svg#x)}")],
  ["marker url(#x)", append("a{marker:url(#x)}")],
  ["an external marker", append("a{marker:url(m.svg#x)}")],
  ["content url()", append("a{content:url(x.png)}")],
  ["offset-path url()", append("a{offset-path:url(#p)}")],
  ["shape-outside url()", append("a{shape-outside:url(s.png)}")],
  ["behavior url()", append("a{behavior:url(x.htc)}")],
  ["a custom property url()", append("a{--x:url(x.png)}")],
  ["a custom property image-set()", append('a{--x:image-set("x.png" 1x)}')],
  ["image-set()", append('a{background:image-set("x.png" 1x)}')],
  [
    "-webkit-image-set()",
    append('a{background:-webkit-image-set("x.png" 1x)}'),
  ],
  ["image()", append('a{background:image("x.png")}')],
  ["cross-fade()", append('a{background:cross-fade("a.png" 50%,"b.png")}')],
  ["element()", append("a{background:element(#e)}")],
  ["-moz-element()", append("a{background:-moz-element(#e)}")],
  ["src()", append('a{background:src("x.png")}')],
  [
    "src() with escaped string contents",
    append('a{background:src("x\\2e png")}'),
  ],
  ["paint()", append("a{background:paint(worklet)}")],
  ["a string @import", prepend('@import "x.css";')],
  ["a url() @import", prepend("@import url(x.css);")],
  ["an escaped @import", prepend('@\\69mport "x.css";'), POLICY, POSTCSS],
  [
    "@namespace with url()",
    prepend("@namespace svg url(http://e.example/ns);"),
  ],
  ["@namespace with a string", prepend('@namespace "http://e.example/ns";')],
  [
    "@property initial-value",
    append(
      '@property --x{syntax:"<image>";inherits:false;initial-value:url(x.png)}',
    ),
  ],
  ["an unknown at-rule carrying url()", append("@foo url(x.png);")],
  ["an unknown at-rule with a string prelude", append('@foo "x.png";')],
  ["an unknown at-rule block", append("@foo{a{color:red}}")],
  [
    "url() inside @supports",
    append("@supports (background:url(x)){a{color:red}}"),
  ],
  ["an upper-case URL()", append("a{b:URL(x)}")],
  ["a mixed-case Url()", append('a{b:Url("x")}')],
  ["an escaped upper-case URL()", append('a{b:\\55 RL("x")}')],
  ['url( "x" )', append('a{b:url( "x" )}')],
  ["a bad url", append('a{b:url(x"y)}'), /a bad-url token at byte/u],
  ["an unclosed url( at the end", append("a{b:url(x"), UNCLOSED, POSTCSS],
  [
    "a url() just before the slice",
    (css) => insertAt(css, faceSpans(css)[0][0], "a{b:url(x)}"),
  ],
  [
    "a url() just after the slice",
    (css) => insertAt(css, faceEnd(css), "a{b:url(x)}"),
  ],
  ["an unknown function", append("a{b:foo(1)}")],
  ["a vendor-prefixed function", append("a{b:-webkit-calc(1px + 2px)}")],
  ["a custom function", append("a{b:--f(1)}")],
  ["url() inside var()", append("a{b:var(--x,url(x.png))}")],
  ["image() inside clamp()", append('a{b:clamp(1px,image("x"),2px)}')],
  ["src() inside a var() fallback", append('a{b:var(--x,src("x"))}')],
  ["an escaped image()", append('a{b:\\69mage("x")}')],
  ["a mixed-case escaped Image()", append('a{b:I\\6d AGE("x")}')],
  ["a hex escape ended by a space", append("a{b:\\75 rl(x)}")],
  ["a hex escape ended by LF", append("a{b:\\75\nrl(x)}")],
  ["a hex escape ended by CRLF", append("a{b:\\75\r\nrl(x)}")],
  ["a hex escape ended by CR", append("a{b:\\75\rrl(x)}")],
  ["a hex escape ended by FF", append("a{b:\\75\frl(x)}")],
  ["a hex escape ended by a tab", append("a{b:\\75\trl(x)}")],
  ["NBSP after an escape", append("a{b:\\76\u00a0ar(--x)}")],
  ["NBSP inside a function name", append("a{b:v\u00a0ar(--x)}")],
  ["NBSP inside url", append("a{b:u\u00a0rl(x)}")],
  ["src() with a CRLF string continuation", append('a{b:src("x\\\r\n.png")}')],
  ["a bad string", append('a{content:"x\ny"}'), /a bad-string token at byte/u],
  [
    "a string open at the end",
    append('a{content:"x'),
    /an unterminated string/u,
    POSTCSS,
  ],
  [
    "a comment open at the end",
    append("/* x"),
    /an unterminated comment/u,
    POSTCSS,
  ],
  ["a function open at the end", append("a{b:var(--x"), UNCLOSED, POSTCSS],
  ["a block open at the end", append("a{b:c"), UNCLOSED, POSTCSS],
  ["an unmatched closer", append("a{b:c)}"), /an unmatched \) at byte/u],
  [
    "invalid UTF-8",
    (css) => Buffer.concat([Buffer.from(css), Buffer.from([0xff])]),
    /not strict UTF-8/u,
    POSTCSS,
  ],
  ["NUL", append("a{b:c\u0000d}"), /U\+0000/u],
  ["a backslash before LF", append("a{--x:\\\n;}"), BACKSLASH],
  ["a backslash before CRLF", append("a{--x:\\\r\n;}"), BACKSLASH],
  ["a backslash before CR", append("a{--x:\\\r;}"), BACKSLASH],
  ["a backslash before FF", append("a{--x:\\\f;}"), BACKSLASH],
  ["a backslash at the end", append("\\"), BACKSLASH, POSTCSS],
  [
    "a string consuming both slice boundaries",
    (css) =>
      insertAt(
        insertAt(css, faceEnd(css), '"}'),
        faceSpans(css)[0][0],
        'a{content:"',
      ),
    /no emitted stylesheet holds the bound @font-face rules/u,
    POSTCSS,
  ],
  [
    "a comment consuming both slice boundaries",
    (css) =>
      insertAt(insertAt(css, lastEnd(css), "*/"), faceSpans(css)[0][0], "/*"),
    /no emitted stylesheet holds the bound @font-face rules/u,
  ],
  [
    "a url( opened before the slice and closed after it",
    (css) =>
      insertAt(
        insertAt(css, faceEnd(css), ")}"),
        faceSpans(css)[0][0],
        "a{b:url(",
      ),
    /a bad-url token at byte/u,
    POSTCSS,
  ],
];

const matrix = [
  ...cases,
  ...policyCases.map(([n, m, p = POLICY, e]) => [n, m, p, e]),
];

// Each allowed function and at-rule in its supported contexts, nested, escaped and in mixed case.
const allowedSyntax = [
  [
    "every allowed function and at-rule",
    append(
      '@media print{a:not([data-x="https://e.example/x.png"]){width:clamp(1px,var(--x,clamp(1px,2px,3px)),3px)}}@layer overrides{a{display:block}}',
    ),
  ],
  [
    "escaped and mixed-case allowed names",
    append(
      "a{b:V\\41R(--x);c:Clamp(1px,2px,3px)}@MEDIA print{a{display:block}}",
    ),
  ],
  [
    "a hex escape ended by CRLF in an allowed name",
    append("a{b:\\76\r\nar(--x)}"),
  ],
  [
    "URL-looking text in a closed comment",
    append('/* url(x.png) @import "y.css" image-set("z") */a{display:block}'),
  ],
  [
    "URL-looking text in an ordinary string",
    append('a{content:"url(https://e.example/x.png)"}'),
  ],
  ["a CRLF string continuation", append('a{content:"x\\\r\ny"}')],
];

// Non-ASCII, astral and CRLF text before the slice moves its byte offset past its UTF-16 offset.
const nonAscii = "/*\u00e9\u20ac\u{1F600}\r\n*/";
const withNonAscii = (css) =>
  css.replace("@layer base{", `@layer base{${nonAscii}`);

describe("font slice: the real bundle", () => {
  let built;
  beforeAll(async () => {
    built = await releaseRoot(fixture(productionFiles()).root);
  }, 60_000);

  it("records the generated faces for every platform", () => {
    const record = JSON.parse(readFileSync(join(web, sliceRecordFile), "utf8"));
    expect(expected.problems).toEqual([]);
    expect(record).toEqual({
      sha256: sha256(expected.bytes),
      byteLength: expected.bytes.length,
    });
  });

  it("equals the raw trailing slice of the production bundle", () => {
    const { path, start, end, sha256: hash } = built.fontSlice;
    const bytes =
      built.files.get(path) && walkDist(built.outDir).get(path).bytes;
    expect(bytes.subarray(start, end).equals(expected.bytes)).toBe(true);
    expect(bytes[start - 1]).toBe(0x7d);
    expect(bytes[end]).toBe(0x7d);
    expect(bytes.subarray(0, 3).toString("latin1")).not.toBe(
      "\u00ef\u00bb\u00bf",
    );
    expect(hash).toBe(sha256(expected.bytes));
    const evidence = JSON.parse(
      readFileSync(
        join(built.root, ".cache", "build-evidence", "provenance.json"),
        "utf8",
      ),
    );
    expect(evidence.fontSlice).toEqual(built.fontSlice);
  });

  it("never generates unicode-range", () => {
    expect(expected.bytes.toString("utf8")).not.toMatch(/unicode-range/iu);
  });

  describe("on-disk mutation after the terminal step", () => {
    const sheet = () =>
      [...walkDist(built.outDir).keys()].find((p) => p.endsWith(".css"));
    // The snapshot is forged to match, so only the face admission can refuse the bytes.
    async function admitOnDisk(mutate) {
      const file = join(built.outDir, ...sheet().split("/"));
      const original = readFileSync(file);
      writeFileSync(file, mutate(original.toString("utf8")));
      try {
        const terminal = walkDist(built.outDir);
        return await failure(
          terminalAdmission({ ...built, files: terminal }, terminal),
        );
      } finally {
        writeFileSync(file, original);
      }
    }

    it("admits the bytes as built", async () => {
      expect(await admitOnDisk((css) => css)).toBe(null);
    });

    it.each(allowedSyntax)("admits %s", async (_name, mutate) => {
      expect(await admitOnDisk(mutate)).toBe(null);
    });

    it("grants no exemption once the slice bytes differ", async () => {
      const error = await admitOnDisk((css) =>
        css.replace("font-display:swap", "font-display:block"),
      );
      expect(error?.message).toMatch(DIFF);
      expect(error?.message).toMatch(
        /function format\(\) at byte \d+ is outside/u,
      );
      expect(error?.message).toMatch(/a url token at byte \d+ is outside/u);
    });

    it.each(matrix)("fails %s", async (_name, mutate, pattern) => {
      const error = await admitOnDisk(mutate);
      expect(error?.message).toMatch(
        /build guard: terminal asset admission: /u,
      );
      expect(error?.message).toMatch(pattern);
      expect(error?.message).not.toMatch(/differs from its hash/u);
    });

    it("converts offsets to bytes past non-ASCII text", async () => {
      const css = readFileSync(
        join(built.outDir, ...sheet().split("/")),
        "utf8",
      );
      expect(await admitOnDisk(withNonAscii)).toBe(null);
      const moved = Buffer.from(withNonAscii(css));
      const start = built.fontSlice.start + Buffer.byteLength(nonAscii);
      expect(Buffer.byteLength(nonAscii)).toBeGreaterThan(nonAscii.length);
      expect(moved.subarray(start, start + expected.bytes.length)).toEqual(
        expected.bytes,
      );
    });

    it("fails a byte-identical stylesheet moved to another path", () => {
      const terminal = walkDist(built.outDir);
      const from = join(built.outDir, ...sheet().split("/"));
      const to = join(built.outDir, "assets", "moved.css");
      renameSync(from, to);
      try {
        expect(() => releaseRecheck(built.outDir, terminal)).toThrow(
          /is missing assets\/style-[\w-]+\.css/u,
        );
      } finally {
        renameSync(to, from);
      }
    });
  });
});

describe("font slice: post-C2 mutation in the pipeline", () => {
  // A6: the real C2 runs, then its output is changed the way a later stage could change it.
  const afterC2 = (rewrite) =>
    harness(productionFiles(), (config) => {
      const seen = { rewritten: false };
      const c2 = pluginNamed(config, "sharpladder:css-minify");
      const original = c2.generateBundle;
      c2.generateBundle = function generateBundle(options, bundle) {
        original.call(this, options, bundle);
        for (const asset of Object.values(bundle))
          if (asset.fileName.endsWith(".css")) {
            asset.source = rewrite(String(asset.source));
            seen.rewritten = true;
          }
      };
      return seen;
    });

  it.each(allowedSyntax)(
    "admits %s",
    async (_name, mutate) => {
      const { run } = await afterC2(mutate);
      const built = await run;
      expect(built.fontSlice.sha256).toBe(sha256(expected.bytes));
    },
    30_000,
  );

  it("grants no exemption once the slice bytes differ", async () => {
    const { run } = await afterC2((css) =>
      css.replace("font-display:swap", "font-display:block"),
    );
    const error = await failure(run);
    expect(error?.message).toMatch(DIFF);
    expect(error?.message).toMatch(/a url token at byte \d+ is outside/u);
  }, 30_000);

  it.each(matrix)(
    "fails %s",
    async (_name, mutate, pattern, earlier) => {
      const { run, state } = await afterC2(mutate);
      const error = await failure(run);
      expect(state.rewritten).toBe(true);
      expect(error?.message).toMatch(/build guard: /u);
      expect(error?.message).toMatch(earlier ?? pattern);
    },
    30_000,
  );

  it("admits non-ASCII text before the slice at its byte offset", async () => {
    const { run } = await afterC2(withNonAscii);
    const built = await run;
    const bytes = walkDist(built.outDir).get(built.fontSlice.path).bytes;
    const { start, end } = built.fontSlice;
    expect(bytes.subarray(start, end).equals(expected.bytes)).toBe(true);
    expect(start).toBeGreaterThan(
      bytes.toString("utf8").indexOf("@font-face{"),
    );
  }, 30_000);

  it("fails a byte-identical stylesheet emitted under another path", async () => {
    const { run } = await harness(productionFiles(), (config) => {
      const c2 = pluginNamed(config, "sharpladder:css-minify");
      const original = c2.generateBundle;
      c2.generateBundle = function generateBundle(options, bundle) {
        original.call(this, options, bundle);
        for (const [key, asset] of Object.entries(bundle))
          if (asset.fileName.endsWith(".css")) {
            delete bundle[key];
            asset.fileName = "assets/moved.css";
            bundle[asset.fileName] = asset;
          }
      };
    });
    const error = await failure(run);
    expect(error?.message).toMatch(/build guard: /u);
  }, 30_000);
});

/**
 * The authored fonts.css with each source URL resolved through the sourcePath-to-distPath
 * binding and the public base; only parsed URL values are replaced, nothing is rebound.
 */
function authoredFaces(css, inventory) {
  const problems = [];
  const bound = new Map();
  for (const asset of inventory.assets.filter((a) => a.shipped))
    for (const file of asset.distributedFiles)
      bound.set(file.sourcePath, file.distPath);
  const edits = [];
  const seen = new Set();
  walk(parse(css, { positions: true }), {
    visit: "Url",
    enter(node) {
      const { start, end } = node.loc;
      const raw = css.slice(start.offset, end.offset);
      if (raw.includes("\\")) {
        problems.push(`escaped source URL ${raw}`);
        return;
      }
      const source = posix.normalize(posix.join("web/src/theme", node.value));
      const dist = bound.get(source);
      if (dist === undefined) problems.push(`unknown source URL ${raw}`);
      else if (seen.has(source)) problems.push(`duplicate source URL ${raw}`);
      else edits.push([start.offset, end.offset, dist]);
      seen.add(source);
    },
  });
  for (const source of bound.keys())
    if (!seen.has(source)) problems.push(`no source URL loads ${source}`);
  let out = css;
  for (const [start, end, dist] of edits.reverse())
    out = `${out.slice(0, start)}url(${cssString(publicBase + dist)})${out.slice(end)}`;
  return { problems, css: minifySheet(out) };
}

describe("font slice: authored source loop", () => {
  const fontsCss = readFileSync(join(web, "src", "theme", "fonts.css"), "utf8");
  const wrapped = `@layer base{${expected.bytes.toString("utf8")}}`;

  it("closes: authored faces with URLs substituted equal the generated faces", () => {
    const { problems, css } = authoredFaces(fontsCss, production);
    expect(problems).toEqual([]);
    expect(css).toBe(wrapped);
  });

  it.each([
    [
      "an unknown URL",
      fontsCss.replace("./fonts/noto-sans.woff2", "./fonts/other.woff2"),
      /unknown source URL/u,
    ],
    [
      "a duplicate URL",
      fontsCss.replace(
        "./fonts/noto-sans-display.woff2",
        "./fonts/noto-sans.woff2",
      ),
      /duplicate source URL/u,
    ],
    [
      "an escaped URL",
      fontsCss.replace(
        "./fonts/noto-sans.woff2",
        "./fonts/noto\\2d sans.woff2",
      ),
      /escaped source URL/u,
    ],
  ])("fails %s", (_name, css, pattern) => {
    expect(authoredFaces(css, production).problems.join("\n")).toMatch(pattern);
  });

  it("fails a URL bound to another face's file", () => {
    const swapped = fontsCss
      .replace("./fonts/noto-sans.woff2", "./fonts/SWAP")
      .replace("./fonts/noto-sans-display.woff2", "./fonts/noto-sans.woff2")
      .replace("./fonts/SWAP", "./fonts/noto-sans-display.woff2");
    const { problems, css } = authoredFaces(swapped, production);
    expect(problems).toEqual([]);
    expect(css).not.toBe(wrapped);
  });

  it("keeps the expectation when the source or the output changes", () => {
    const before = Buffer.from(generateFaces(production).bytes);
    authoredFaces(
      fontsCss.replace("font-weight: 400", "font-weight: 700"),
      production,
    );
    expect(generateFaces(production).bytes.equals(before)).toBe(true);
    expect(generateFaces.length).toBe(1);
  });
});

describe("font slice: generator input validation", () => {
  const changed = (change) => {
    const copy = structuredClone(production);
    change(copy.assets[2].distributedFiles[0], copy);
    return generateFaces(copy);
  };

  it("encodes family text as a CSS string, never as syntax", () => {
    const hostile = 'x";}@import "y.css";@font-face{a:b\\';
    const result = changed((file) => (file.face.familyAlias = hostile));
    expect(result.problems).toEqual([]);
    const ast = parse(result.bytes.toString("utf8"));
    const names = [];
    walk(ast, { visit: "Atrule", enter: (node) => names.push(node.name) });
    expect(names).toEqual(["font-face", "font-face", "font-face"]);
  });

  it("states an equal-endpoint pair as one number and an unequal one as two", () => {
    const text = expected.bytes.toString("utf8");
    expect(text).toContain("font-weight:400;");
    expect(text).toContain("font-stretch:100%;");
    expect(text).toContain("font-weight:100 900;");
    expect(text).toContain("font-stretch:62.5% 100%;");
    const pair = changed((file) => (file.face.stretch = [100, 100]));
    expect(pair.bytes.equals(expected.bytes)).toBe(true);
  });

  it.each([
    [
      "a control character",
      (f) => (f.face.familyAlias = "SL\nCode"),
      /not plain text/u,
    ],
    ["an empty family", (f) => (f.face.familyAlias = ""), /not plain text/u],
    [
      "a lone surrogate",
      (f) => (f.face.familyAlias = "SL\ud800"),
      /not plain text/u,
    ],
    [
      "a NaN weight",
      (f) => (f.face.weightRange = [Number.NaN, 400]),
      /weight is not/u,
    ],
    [
      "an infinite weight",
      (f) => (f.face.weightRange = [400, Infinity]),
      /weight is not/u,
    ],
    [
      "a reversed weight",
      (f) => (f.face.weightRange = [700, 400]),
      /weight is not/u,
    ],
    [
      "a weight out of bounds",
      (f) => (f.face.weightRange = [0, 400]),
      /weight is not/u,
    ],
    [
      "a reversed stretch",
      (f) => (f.face.stretch = [100, 62.5]),
      /stretch is not/u,
    ],
    [
      "a stretch out of bounds",
      (f) => (f.face.stretch = 300),
      /stretch is not/u,
    ],
    [
      "an unsupported style",
      (f) => (f.face.style = "oblique"),
      /style oblique/u,
    ],
    ["an unsupported format", (f) => (f.face.format = "woff"), /format woff/u],
    [
      "a dot segment",
      (f) => (f.distPath = "assets/../x.woff2"),
      /no plain URL/u,
    ],
    ["a query", (f) => (f.distPath = "assets/x.woff2?v=1"), /no plain URL/u],
    [
      "a duplicate binding",
      (f, inv) => (f.distPath = inv.assets[0].distributedFiles[0].distPath),
      /bound twice/u,
    ],
  ])("refuses %s", (_name, change, pattern) => {
    const result = changed(change);
    expect(result.bytes).toBe(null);
    expect(result.problems.join("\n")).toMatch(pattern);
  });
});
