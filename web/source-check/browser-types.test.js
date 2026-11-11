// @vitest-environment node
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const parsed = ts.getParsedCommandLineOfConfigFile(
  join(web, "tsconfig.browser.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
);

// Unchanged files parse to the same trees in every case, so each is parsed once per file.
const unchanged = new Map();

/**
 * Diagnostics of the browser program with one module's text replaced in memory: of the whole
 * program, or of the replaced module alone where a case asserts only what that module reports.
 */
function diagnostics(file, from, to, { targetOnly = false } = {}) {
  const target = resolve(web, "browser", file);
  const host = ts.createCompilerHost(parsed.options);
  const read = host.getSourceFile.bind(host);
  let swapped = from === undefined;
  host.getSourceFile = (name, language, ...rest) => {
    if (from === undefined || resolve(name) !== target) {
      const key = `${resolve(name)}\n${JSON.stringify(language)}`;
      if (!unchanged.has(key))
        unchanged.set(key, read(name, language, ...rest));
      return unchanged.get(key);
    }
    const text = ts.sys.readFile(name) ?? "";
    swapped = text.includes(from);
    return ts.createSourceFile(name, text.replace(from, to), language);
  };
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host,
  });
  const only = targetOnly
    ? program.getSourceFiles().find((f) => resolve(f.fileName) === target)
    : undefined;
  if (targetOnly && only === undefined)
    throw new Error(`${file} is not in the program`);
  const found = ts
    .getPreEmitDiagnostics(program, only)
    .map(
      (d) =>
        `${d.file ? resolve(d.file.fileName) === target : false}:TS${String(d.code)}`,
    );
  return { swapped, found };
}

// Each case builds the whole browser program with the real TypeScript compiler.

describe("browser modules are type-checked", () => {
  it("passes the unchanged browser program", () => {
    expect(diagnostics("pins.ts").found).toEqual([]);
  });

  it.each([
    ["pins.ts", "chromium: builds.chromium.browserVersion,", "chromium: 1,"],
    [
      "catalogue.ts",
      "return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);",
      "return String((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05));",
    ],
    ["fonts.ts", "  return actual;\n", "  return bytes.length;\n"],
  ])("fails a wrong return type in %s", (file, from, to) => {
    const { swapped, found } = diagnostics(file, from, to, {
      targetOnly: true,
    });
    expect(swapped).toBe(true);
    expect(found).toContain("true:TS2322");
  });

  const body = "      const bytes = await response.body();\n";
  it.each([
    [
      "a string target",
      "      const bytes: string = await response.body();\n",
      "TS2322",
    ],
    [
      "a missing member",
      "      const bytes = await response.bodyBytes();\n",
      "TS2339",
    ],
  ])("types the response body as the real Buffer: %s", (_, to, code) => {
    const { swapped, found } = diagnostics("fonts.pw.ts", body, to, {
      targetOnly: true,
    });
    expect(swapped).toBe(true);
    expect(found).toContain(`true:${code}`);
  });

  it("does not type the response body as any", () => {
    const check = (verdict) =>
      `${body}      type IsAny<T> = 0 extends 1 & T ? true : false;\n      const notAny: IsAny<Awaited<ReturnType<import("@playwright/test").APIResponse["body"]>>> = ${verdict};\n      void notAny;\n`;
    expect(diagnostics("fonts.pw.ts", body, check("false")).found).toEqual([]);
    expect(
      diagnostics("fonts.pw.ts", body, check("true"), { targetOnly: true })
        .found,
    ).toContain("true:TS2322");
  });

  it("compiles DOM fetch types beside the Node declarations", () => {
    const from = "export const ports";
    const { swapped, found } = diagnostics(
      "pins.ts",
      from,
      'export async function probeFetch(): Promise<number> {\n  const request = new Request("http://127.0.0.1/");\n  const response: Response = await fetch(request);\n  return response.status;\n}\n' +
        from,
    );
    expect(swapped).toBe(true);
    expect(found).toEqual([]);
  });
}, 60_000);
