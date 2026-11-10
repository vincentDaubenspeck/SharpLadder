// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ident, tokenize, tokenTypes } from "css-tree";
import { describe, expect, it } from "vitest";
import { generateFaces } from "../asset-licence-check.js";
import { inventoryFile } from "./fixture.js";
import {
  allowedAtRules,
  allowedFunctions,
  tokenPolicyProblems,
} from "./token-policy.js";

const web = join(import.meta.dirname, "..");
const faces = generateFaces(
  JSON.parse(readFileSync(join(web, inventoryFile), "utf8")),
).bytes;
const policy = (text, exempt = null) =>
  tokenPolicyProblems(Buffer.from(text), exempt);

/** A sheet shaped like the bundle, with the exact byte range of its faces. */
function sheet(before = "") {
  const head = Buffer.from(`@layer base{${before}a{b:c}`);
  const bytes = Buffer.concat([head, faces, Buffer.from("}")]);
  return {
    bytes,
    slice: { start: head.length, end: head.length + faces.length },
  };
}

describe("token policy: the reviewed lists", () => {
  it("holds exactly the names the production bundle uses, each with a reason", () => {
    expect([...allowedFunctions.keys()]).toEqual(["var", "clamp", "not"]);
    expect([...allowedAtRules.keys()]).toEqual(["layer", "media"]);
    for (const reason of [
      ...allowedFunctions.values(),
      ...allowedAtRules.values(),
    ])
      expect(reason.length).toBeGreaterThan(20);
    for (const name of [
      "import",
      "namespace",
      "font-face",
      "charset",
      "property",
    ])
      expect(allowedAtRules.has(name)).toBe(false);
  });

  it.each([
    "@layer base{a{b:var(--x)}}",
    "@layer tokens,base;",
    "@media (prefers-color-scheme:dark){a{b:clamp(1px,2vw,3px)}}",
    ':root:not([data-theme="dark"]){b:c}',
    "a{b:clamp(1px,var(--x,clamp(1px,2px,3px)),3px)}",
    "a{b:c}/* a closed trailing comment */",
    "a{b:V\\41R(--x);c:CLAMP(1px,2px,3px)}@MeDiA print{a{b:c}}",
  ])("admits %s", (text) => {
    expect(policy(text)).toEqual([]);
  });
});

describe("token policy: CSS escape handling", () => {
  // Expected names follow CSS Syntax 3: a hex escape takes one following whitespace, with CRLF as one.
  it.each([
    ["\\75 rl(x)", "url"],
    ["\\75\nrl(x)", "url"],
    ["\\75\r\nrl(x)", "url"],
    ["\\75\rrl(x)", "url"],
    ["\\75\frl(x)", "url"],
    ["\\75\trl(x)", "url"],
    ["\\000075rl(x)", "url"],
    ["\\76\r\nar(--x)", "var"],
    ["\\76\u00a0ar(--x)", "v\u00a0ar"],
    ["v\u00a0ar(--x)", "v\u00a0ar"],
    ["I\\6d AGE(x)", "ImAGE"],
    ["I\\6dAGE(x)", "I\u06daGE"],
  ])("decodes %j as the function %j", (value, name) => {
    const text = `a{b:${value}}`;
    const found = [];
    tokenize(text, (type, start, end) => {
      if (type === tokenTypes.Function)
        found.push(ident.decode(text.slice(start, end - 1)));
    });
    expect(found).toEqual([name]);
    const allowed = allowedFunctions.has(name.toLowerCase());
    expect(policy(text)).toEqual(
      allowed
        ? []
        : [
            `function ${name.toLowerCase()}() at byte 4 is outside the token policy`,
          ],
    );
  });

  it.each([["\n"], ["\r\n"], ["\r"], ["\f"]])(
    "reads a string continuation over %j as one string",
    (newline) => {
      const text = `a{content:"x\\${newline}y"}`;
      const strings = [];
      tokenize(text, (type, start, end) => {
        if (type === tokenTypes.String) strings.push(text.slice(start, end));
      });
      expect(strings).toEqual([`"x\\${newline}y"`]);
      expect(policy(text)).toEqual([]);
    },
  );

  it("reads a raw newline in a string as a bad string", () => {
    expect(policy('a{content:"x\ny"}')).toContain(
      "a bad-string token at byte 10",
    );
  });
});

describe("token policy: fail-closed", () => {
  it.each([
    ['a{b:"x', /an unterminated string at byte 4/u],
    ['a{b:"x\\"', /an unterminated string at byte 4/u],
    ["a{b:c}/* x", /an unterminated comment at byte 6/u],
    ["a{b:url(x", /an unclosed block or function at byte 1/u],
    ["a{b:url(x\\)}", /an unterminated url at byte 4/u],
    ["a{b:var(--x", /an unclosed block or function at byte 4/u],
    ["a{b:c", /an unclosed block or function at byte 1/u],
    ["a{b:c)}", /an unmatched \) at byte 5/u],
    ["a{b:[c}", /an unmatched \} at byte 6/u],
    ["a{b:c}x", /the input does not end with \} or ;/u],
    ['a{b:url(x"y)}', /a bad-url token at byte 4/u],
    ["a{b:c\u0000d}", /U\+0000/u],
  ])("fails %j", (text, pattern) => {
    expect(policy(text).join("\n")).toMatch(pattern);
  });

  it.each([
    ["LF", "a{--x:\\\n;}"],
    ["CRLF", "a{--x:\\\r\n;}"],
    ["CR", "a{--x:\\\r;}"],
    ["FF", "a{--x:\\\f;}"],
  ])("fails a backslash before %s", (_name, text) => {
    expect(policy(text)).toEqual([
      "a backslash that starts no valid escape at byte 6",
    ]);
  });

  it("fails a backslash at the end of the input", () => {
    expect(policy("a{b:c}\\")).toEqual([
      "a backslash that starts no valid escape at byte 6",
      "the input does not end with } or ;",
    ]);
  });

  it("fails a backslash that starts no valid escape inside the exempt range", () => {
    const text = "a{b:c}a{--x:\\\n;}";
    expect(policy(text, { start: 6, end: text.length })).toEqual([
      "a backslash that starts no valid escape at byte 12",
    ]);
  });

  it("fails invalid UTF-8", () => {
    const bytes = Buffer.concat([Buffer.from("a{b:c}"), Buffer.from([0xc3])]);
    expect(tokenPolicyProblems(bytes)).toEqual(["not strict UTF-8"]);
  });
});

describe("token policy: the admitted slice", () => {
  it("exempts the exact slice and nothing else", () => {
    const { bytes, slice } = sheet();
    expect(tokenPolicyProblems(bytes, slice)).toEqual([]);
    const bare = tokenPolicyProblems(bytes).join("\n");
    expect(bare).toMatch(/@font-face at byte \d+ is outside/u);
    expect(bare).toMatch(/a url token at byte \d+ is outside/u);
    expect(bare).toMatch(/function format\(\) at byte \d+ is outside/u);
  });

  it("exempts nothing outside the slice", () => {
    const { bytes, slice } = sheet("a{b:url(x)}");
    expect(tokenPolicyProblems(bytes, slice)).toEqual([
      "a url token at byte 16 is outside the token policy",
    ]);
  });

  it.each([
    ["a start inside a token", ({ start, end }) => ({ start: start + 1, end })],
    ["an end inside a token", ({ start, end }) => ({ start, end: end - 3 })],
  ])("fails %s", (_name, move) => {
    const { bytes, slice } = sheet();
    expect(tokenPolicyProblems(bytes, move(slice)).join("\n")).toMatch(
      /crosses the admitted slice|token boundaries/u,
    );
  });

  it("reports byte offsets past non-ASCII, astral and CRLF text", () => {
    const before = "/*\u00e9\u20ac\u{1F600}\r\n*/a{b:url(x)}";
    const { bytes, slice } = sheet(before);
    const at = bytes.indexOf("url(x)");
    expect(at).toBeGreaterThan(bytes.toString("utf8").indexOf("url(x)"));
    expect(tokenPolicyProblems(bytes, slice)).toEqual([
      `a url token at byte ${at} is outside the token policy`,
    ]);
  });
});
