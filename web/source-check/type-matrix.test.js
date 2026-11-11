// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const folder = join(web, "type-tests");
const { rows } = JSON.parse(readFileSync(join(folder, "matrix.json"), "utf8"));
const modules = [...new Set(rows.map((row) => row.module))];
const directive = "// @ts-expect-error ";

const parsed = ts.getParsedCommandLineOfConfigFile(
  join(web, "tsconfig.type-tests.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
);
const key = (name) =>
  ts.sys.resolvePath(name).replaceAll("\\", "/").toLowerCase();

// Compiles the type-test program with some files replaced or added in memory.
function compile(texts, roots = parsed.fileNames) {
  const replaced = new Map(
    Object.entries(texts).map(([name, text]) => [key(name), text]),
  );
  const host = ts.createCompilerHost(parsed.options);
  const read = host.getSourceFile;
  host.getSourceFile = (name, language, ...rest) =>
    replaced.has(key(name))
      ? ts.createSourceFile(name, replaced.get(key(name)), language, true)
      : read(name, language, ...rest);
  const exists = host.fileExists;
  host.fileExists = (name) => replaced.has(key(name)) || exists(name);
  const program = ts.createProgram(
    [...new Set([...roots, ...Object.keys(texts)])],
    parsed.options,
    host,
  );
  return { program, diagnostics: ts.getPreEmitDiagnostics(program) };
}

// Every comment token from the TypeScript scanner, never a text search.
function comments(text) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const found = [];
  for (
    let kind = scanner.scan();
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = scanner.scan()
  ) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    )
      found.push({
        kind,
        start: scanner.getTokenStart(),
        text: scanner.getTokenText(),
      });
  }
  return found;
}

const directives = (text) =>
  comments(text).filter((comment) => comment.text.includes("@ts-expect-error"));

// Blanks each directive with spaces so every other position stays where it was.
const strip = (text) =>
  directives(text).reduce(
    (out, { start, text: comment }) =>
      out.slice(0, start) +
      " ".repeat(comment.length) +
      out.slice(start + comment.length),
    text,
  );

const lineOf = (file, position) =>
  file.getLineAndCharacterOfPosition(position).line;

function exportedRows(file) {
  const found = new Map();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      found.set(declaration.name.getText(file), { statement, declaration });
  }
  return found;
}

const omitted = Symbol("omitted");

// The JSON value a row literal denotes; undefined properties are left out, as in JSON.
function literalValue(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      )
        throw new Error(`unsupported property: ${property.getText()}`);
      const inner = literalValue(property.initializer);
      if (inner !== omitted) value[property.name.text] = inner;
    }
    return value;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalValue);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isIdentifier(node) && node.text === "undefined") return omitted;
  throw new Error(`unsupported value: ${node.getText()}`);
}

function satisfied(declaration) {
  const init = declaration.initializer;
  if (
    !init ||
    !ts.isSatisfiesExpression(init) ||
    init.type.getText() !== "ContentDoc"
  )
    throw new Error(
      `${declaration.name.getText()}: not a satisfies ContentDoc literal`,
    );
  return init.expression;
}

const sources = Object.fromEntries(
  modules.map((module) => [module, readFileSync(join(folder, module), "utf8")]),
);
const message = (diagnostic) =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
const shown = (diagnostic) => `TS${diagnostic.code} ${message(diagnostic)}`;

describe("type-test matrix records", () => {
  it("lists every module, row and JSON fixture exactly once", () => {
    const names = rows.map((row) => row.name);
    expect(new Set(names).size).toBe(names.length);
    const tsFiles = readdirSync(folder).filter((name) => name.endsWith(".ts"));
    expect(tsFiles.toSorted()).toEqual(modules.toSorted());
    expect(readdirSync(join(folder, "json")).toSorted()).toEqual(
      rows.map((row) => row.json.slice("json/".length)).toSorted(),
    );
    for (const module of modules) {
      const file = ts.createSourceFile(
        module,
        sources[module],
        ts.ScriptTarget.Latest,
        true,
      );
      expect([...exportedRows(file).keys()].toSorted()).toEqual(
        rows
          .filter((row) => row.module === module)
          .map((row) => row.name)
          .toSorted(),
      );
    }
  });

  it("records 18 type-expressible negatives, 7 schema-only rows and the positives", () => {
    const negative = rows.filter((row) => row.typescript);
    expect(negative).toHaveLength(18);
    expect(negative.filter((row) => row.validator === "refused")).toHaveLength(
      17,
    );
    expect(
      rows.filter((row) => !row.typescript && row.validator === "refused"),
    ).toHaveLength(7);
    expect(rows.filter((row) => row.name.startsWith("p"))).toHaveLength(4);
  });

  it.each(rows.map((row) => [row.name, row]))(
    "%s literal denotes exactly its JSON fixture",
    (name, row) => {
      const file = ts.createSourceFile(
        row.module,
        sources[row.module],
        ts.ScriptTarget.Latest,
        true,
      );
      const { declaration } = exportedRows(file).get(name);
      const json = JSON.parse(readFileSync(join(folder, row.json), "utf8"));
      expect(literalValue(satisfied(declaration))).toStrictEqual(json);
    },
  );
});

describe("type-test program", () => {
  it("compiles with every directive in use", () => {
    expect(compile({}).diagnostics.map(shown)).toEqual([]);
  });

  it("has directives only as single-line comments in the rejected rows", () => {
    for (const module of modules) {
      const found = directives(sources[module]);
      for (const comment of found) {
        expect(comment.kind).toBe(ts.SyntaxKind.SingleLineCommentTrivia);
        expect(comment.text.startsWith(directive)).toBe(true);
      }
      const expected = rows.filter(
        (row) => row.module === module && row.typescript,
      ).length;
      expect(found).toHaveLength(expected);
    }
  });

  const stripped = compile(
    Object.fromEntries(
      modules.map((module) => [join(folder, module), strip(sources[module])]),
    ),
  );

  it.each(rows.map((row) => [row.name, row]))(
    "%s fails for its recorded reason once directives are removed",
    (name, row) => {
      const file = stripped.program.getSourceFile(join(folder, row.module));
      const { statement } = exportedRows(file).get(name);
      const inside = stripped.diagnostics.filter(
        (d) =>
          d.file === file &&
          d.start >= statement.pos &&
          d.start < statement.end,
      );
      if (!row.typescript) {
        expect(inside.map(shown)).toEqual([]);
        return;
      }
      expect(inside.map(shown)).toHaveLength(1);
      expect(inside[0].code).toBe(row.typescript.code);
      expect(message(inside[0])).toContain(row.typescript.text);
      const owned = directives(sources[row.module]).filter(
        (comment) =>
          comment.start >= statement.pos && comment.start < statement.end,
      );
      expect(owned).toHaveLength(1);
      expect(lineOf(file, inside[0].start)).toBe(
        lineOf(file, owned[0].start) + 1,
      );
      expect(owned[0].text).toContain(`Row ${Number(name.slice(3))}: `);
    },
  );

  it("reports nothing outside the rows", () => {
    const outside = stripped.diagnostics.filter((d) => {
      if (!d.file) return true;
      const module = modules.find(
        (m) => key(join(folder, m)) === key(d.file.fileName),
      );
      if (!module) return true;
      return ![...exportedRows(d.file).values()].some(
        ({ statement }) => d.start >= statement.pos && d.start < statement.end,
      );
    });
    expect(outside.map(shown)).toEqual([]);
  });
});

describe("witness mutations", () => {
  const witness = join(
    web,
    "src",
    "generated",
    "witness",
    "chapters",
    "fixture-basics",
    "syntax.ts",
  );
  const original = readFileSync(witness, "utf8");
  const file = ts.createSourceFile(
    witness,
    original,
    ts.ScriptTarget.Latest,
    true,
  );
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);

  const splice = (node, text) =>
    original.slice(0, node.getStart(file)) +
    text +
    original.slice(node.getEnd());

  it("compiles unchanged under the type-test options", () => {
    expect(compile({ [witness]: original }, []).diagnostics.map(shown)).toEqual(
      [],
    );
  });

  it.each([
    [
      "paragraph to paragrph",
      () => nodes.find((n) => ts.isStringLiteral(n) && n.text === "paragraph"),
      '"paragrph"',
      2820,
      "paragrph",
    ],
    [
      "blockId to blockid",
      () =>
        nodes.find(
          (n) =>
            ts.isPropertyAssignment(n) &&
            ts.isIdentifier(n.name) &&
            n.name.text === "blockId",
        )?.name,
      "blockid",
      // The near-miss form of the excess-property error (TS2353), which names the intended key.
      2561,
      "but 'blockid' does not exist in type 'ParagraphBlock'. Did you mean to write 'blockId'?",
    ],
  ])(
    "%s fails with its recorded diagnostic",
    (_, find, text, code, fragment) => {
      const node = find();
      expect(node).toBeDefined();
      const { diagnostics } = compile({ [witness]: splice(node, text) }, []);
      expect(diagnostics.map(shown)).toHaveLength(1);
      expect(diagnostics[0].code).toBe(code);
      expect(message(diagnostics[0])).toContain(fragment);
    },
  );
});

describe("__proto__ in a satisfies literal", () => {
  const body = `type: "part", kind: "syntax", chapter: "ch-matrix", order: 1, sections: [{ id: "matrix-one", number: "1.1", title: [{ type: "text", text: "One"PLACE }], body: [], spoken: { segments: [], audio: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945" } }]`;
  const module = (literal) =>
    `import type { ContentDoc } from "../src/generated/content.ts";\nexport const row = { ${literal} } satisfies ContentDoc;\n`;

  // TypeScript checks the key as an ordinary excess property, though at run time it sets the prototype.
  it.each([
    [
      "identifier key at the top",
      `__proto__: { extra: 1 }, ${body.replace("PLACE", "")}`,
      "'__proto__' does not exist in type 'PartFile'",
    ],
    [
      "string key at the top",
      `"__proto__": { extra: 1 }, ${body.replace("PLACE", "")}`,
      "'\"__proto__\"' does not exist in type 'PartFile'",
    ],
    [
      "identifier key in a span",
      body.replace("PLACE", ", __proto__: null"),
      "'__proto__' does not exist in type 'TextSpan'",
    ],
  ])("%s is an excess property (TS2353)", (_, literal, fragment) => {
    const { diagnostics } = compile(
      { [join(folder, "proto-case.ts")]: module(literal) },
      [],
    );
    expect(diagnostics.map(shown)).toHaveLength(1);
    expect(diagnostics[0].code).toBe(2353);
    expect(message(diagnostics[0])).toContain(fragment);
  });

  it("compiles the same literal without the key", () => {
    const { diagnostics } = compile(
      { [join(folder, "proto-case.ts")]: module(body.replace("PLACE", "")) },
      [],
    );
    expect(diagnostics.map(shown)).toEqual([]);
  });
});
