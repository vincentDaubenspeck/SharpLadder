// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  classifyId,
  cssViolations,
  guardContext,
  htmlViolations,
  isReservedSpecifier,
  scriptViolations,
} from "./classify.js";
import { approvedHtml, cleanUp, fixture } from "./fixture.js";

afterAll(cleanUp);

// A project whose node_modules is real, so package ownership can be planted per case.
function project() {
  const { root } = fixture(
    { "src/main.tsx": "export {};\n", "src/a.module.css": "", "src/x.mts": "" },
    { modules: false },
  );
  const put = (path, content) => {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
    return file;
  };
  put("node_modules/good/package.json", '{ "name": "good" }');
  put("node_modules/good/lib/package.json", '{ "type": "module" }');
  put("node_modules/@scope/pkg/package.json", '{ "name": "@scope/pkg" }');
  put("node_modules/liar/package.json", '{ "name": "other" }');
  put("node_modules/inner/package.json", '{ "name": "inner" }');
  put("node_modules/inner/sub/package.json", '{ "name": "sub" }');
  put("node_modules/broken/package.json", "{");
  return { root, ctx: guardContext(root), put };
}

describe("classifyId", () => {
  const { root, ctx, put } = project();
  const at = (path) => join(root, path);

  it("admits virtual ids only in their observed hooks", () => {
    expect(
      classifyId(ctx, "\0vite/modulepreload-polyfill.js", "load").kind,
    ).toBe("virtual");
    expect(classifyId(ctx, "\0rolldown/runtime.js", "transform").kind).toBe(
      "virtual",
    );
    expect(() => classifyId(ctx, "\0rolldown/runtime.js", "load")).toThrow(
      /not allowed/u,
    );
    expect(() => classifyId(ctx, "\0other", "load")).toThrow(/not allowed/u);
  });

  it("classifies first-party source by extension", () => {
    expect(classifyId(ctx, at("src/main.tsx"), "load")).toEqual({
      kind: "first-party",
      lang: "tsx",
    });
    expect(classifyId(ctx, at("src/a.module.css"), "load").lang).toBe("css");
    expect(() => classifyId(ctx, at("src/x.mts"), "load")).toThrow(
      /is not \.ts/u,
    );
  });

  it("refuses queries, fragments, relative and missing ids", () => {
    expect(() => classifyId(ctx, `${at("src/main.tsx")}?raw`, "load")).toThrow(
      /query/u,
    );
    expect(() => classifyId(ctx, `${at("src/main.tsx")}#x`, "load")).toThrow(
      /fragment/u,
    );
    expect(() => classifyId(ctx, "src/main.tsx", "load")).toThrow(/absolute/u);
    expect(() => classifyId(ctx, at("src/none.ts"), "load")).toThrow(
      /cannot canonicalise/u,
    );
    expect(() => classifyId(ctx, null, "load")).toThrow(/unresolved/u);
  });

  it("knows the page and rejects other project files", () => {
    expect(classifyId(ctx, at("index.html"), "load").kind).toBe("html");
    expect(() => classifyId(ctx, put("vite.extra.ts", ""), "load")).toThrow(
      /outside src/u,
    );
  });

  it("admits dependencies by the owning package.json", () => {
    expect(
      classifyId(ctx, put("node_modules/good/lib/i.js", ""), "load").name,
    ).toBe("good");
    expect(
      classifyId(ctx, put("node_modules/@scope/pkg/i.js", ""), "load").name,
    ).toBe("@scope/pkg");
  });

  it.each([
    ["node_modules/liar/i.js", /owned by "other"/u],
    ["node_modules/inner/sub/i.js", /owned by "sub"/u],
    ["node_modules/orphan/i.js", /no package\.json/u],
    ["node_modules/broken/i.js", /cannot read/u],
    ["node_modules/good/node_modules/x/i.js", /outside a top-level package/u],
    ["node_modules/.vite/i.js", /outside a top-level package/u],
  ])("refuses the dependency file %s", (path, pattern) => {
    expect(() => classifyId(ctx, put(path, ""), "load")).toThrow(pattern);
  });

  it("names reserved specifiers", () => {
    expect(isReservedSpecifier("\0x")).toBe(true);
    expect(isReservedSpecifier("vite/modulepreload-polyfill")).toBe(true);
    expect(isReservedSpecifier("react")).toBe(false);
  });
});

// Timed at 30_000: it parses with typescript-eslint, which is cold the first time.
describe("scriptViolations", () => {
  const scan = (code) => scriptViolations(code, "src/Probe.tsx");

  it.each([
    "const p = job.Worker;",
    "const o = { Worker: 1 };",
    "const e = <Card Worker={1} />;",
    "let w: Worker;",
    "type T = typeof globalThis;",
  ])("allows %s", (code) => {
    expect(scan(code)).toEqual([]);
  });

  it.each([
    ["window.Worker;", /Worker/u],
    ['self["SharedWorker"];', /SharedWorker/u],
    ["thing[`Worker`];", /Worker/u],
    ["const o = { Worker };", /Worker/u],
    ["const e = <Worker />;", /Worker/u],
    ["const t = typeof globalThis;", /globalThis/u],
    ["console.log(import.meta.env);", /import\.meta/u],
    ['export * from "./a.ts" with { type: "json" };', /import attributes/u],
    ['import x = require("./a");', /require/u],
  ])("refuses %s", (code, pattern) => {
    expect(scan(code).join(" ")).toMatch(pattern);
  });
}, 30_000);

describe("cssViolations", () => {
  it.each([
    ["@IMPORT url(x.css);", /@import/u],
    ["@\\69mport 'x.css';", /escaped at-rule|unparsable/u],
    [".a { Composes: b; }", /composes/u],
    [".a {", /unparsable/u],
  ])("refuses %s", (sheet, pattern) => {
    expect(cssViolations(sheet, "a.css").join(" ")).toMatch(pattern);
  });

  it("allows ordinary rules", () => {
    expect(cssViolations(".a { color: red }", "a.css")).toEqual([]);
  });
});

describe("htmlViolations", () => {
  it("accepts the approved page and the real one", () => {
    expect(htmlViolations(approvedHtml)).toEqual([]);
    const real = readFileSync(
      join(import.meta.dirname, "..", "index.html"),
      "utf8",
    );
    expect(htmlViolations(real)).toEqual([]);
  });

  it.each([
    ["no doctype", approvedHtml.replace("<!doctype html>\n", "")],
    ["another lang", approvedHtml.replace('lang="en"', 'lang="de"')],
    [
      "an extra attribute",
      approvedHtml.replace('<html lang="en">', '<html lang="en" dir="ltr">'),
    ],
    ["a comment", approvedHtml.replace("<body>", "<body><!-- x -->")],
    [
      "text in root",
      approvedHtml.replace('<div id="root">', '<div id="root">x'),
    ],
    [
      "a script src change",
      approvedHtml.replace("/src/main.tsx", "/src/main.ts"),
    ],
    [
      "a script attribute",
      approvedHtml.replace('type="module" ', 'type="module" defer '),
    ],
    ["trailing content", `${approvedHtml}<script src="/x.js"></script>`],
  ])("refuses %s", (_name, html) => {
    expect(htmlViolations(html)).not.toEqual([]);
  });
});
