import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// The renderer re-checks ids, slugs and chapter references at run time, so its literals must
// stay the schema's own rules; a drift would admit at render what the compiler refused.
export const hrefModule = "src/content/href.ts";

const declared = (file, name) => {
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === name) return d;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      return statement;
  }
  return null;
};

const calls = (node) => {
  const found = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression))
      found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

// What href.ts states, read from its syntax tree; anything not in the expected form is null.
function hrefLiterals(text) {
  const file = ts.createSourceFile(
    hrefModule,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const regex = (name) => {
    const init = declared(file, name)?.initializer;
    if (!init || init.kind !== ts.SyntaxKind.RegularExpressionLiteral)
      return null;
    const literal = init.text;
    const end = literal.lastIndexOf("/");
    return { source: literal.slice(1, end), flags: literal.slice(end + 1) };
  };
  const maxInit = declared(file, "slugMaxLength")?.initializer;
  const chapterCheck = declared(file, "isChapterId");
  const chapterCalls = chapterCheck ? calls(chapterCheck) : [];
  const method = (name) =>
    chapterCalls.filter((c) => c.expression.name.text === name);
  const prefix = method("startsWith");
  const idTest = method("test");
  return {
    id: regex("idPattern"),
    slug: regex("slugPattern"),
    slugMaxLength:
      maxInit && ts.isNumericLiteral(maxInit) ? Number(maxInit.text) : null,
    chapterPrefix:
      prefix.length === 1 &&
      prefix[0].arguments.length === 1 &&
      ts.isStringLiteral(prefix[0].arguments[0])
        ? prefix[0].arguments[0].text
        : null,
    chapterUsesId:
      idTest.length === 1 &&
      ts.isIdentifier(idTest[0].expression.expression) &&
      idTest[0].expression.expression.text === "idPattern",
  };
}

// A prefix pattern the schema states as "^" and a literal with no pattern syntax.
const literalPrefix = (pattern) =>
  typeof pattern === "string" && /^\^[a-z0-9-]+$/u.test(pattern)
    ? pattern.slice(1)
    : null;

const refinement = (definition, idRef) => {
  const parts = definition?.allOf;
  if (!Array.isArray(parts) || parts.length !== 2) return null;
  const [ref, prefix] = parts;
  if (JSON.stringify(ref) !== JSON.stringify({ $ref: idRef })) return null;
  if (Object.keys(prefix ?? {}).join() !== "pattern") return null;
  return literalPrefix(prefix.pattern);
};

// What the schema files state for the same rules.
function schemaRules(body, content) {
  const slug = content.definitions?.chapterFile?.properties?.slug;
  return {
    id: body.definitions?.id?.pattern ?? null,
    slug: slug?.pattern ?? null,
    slugMaxLength: slug?.maxLength ?? null,
    chapterRefPrefix: refinement(
      body.definitions?.chapterRef,
      "#/definitions/id",
    ),
    chapterIdPrefix: refinement(
      content.definitions?.chapterId,
      "body.schema.json#/definitions/id",
    ),
  };
}

export function hrefPatternProblems(hrefText, body, content) {
  const code = hrefLiterals(hrefText);
  const schema = schemaRules(body, content);
  const problems = [];
  const differ = (what, got, want) => {
    if (got === null || want === null || got !== want)
      problems.push(
        `${what}: href.ts has ${JSON.stringify(got)}, the schema ${JSON.stringify(want)}`,
      );
  };
  differ("id pattern", code.id?.source ?? null, schema.id);
  differ("id pattern flags", code.id?.flags ?? null, "u");
  differ("slug pattern", code.slug?.source ?? null, schema.slug);
  differ("slug pattern flags", code.slug?.flags ?? null, "u");
  differ("slug length limit", code.slugMaxLength, schema.slugMaxLength);
  differ("chapter prefix", code.chapterPrefix, schema.chapterRefPrefix);
  differ("content chapter prefix", code.chapterPrefix, schema.chapterIdPrefix);
  if (!code.chapterUsesId)
    problems.push(
      "chapter check: href.ts must test chapter ids with idPattern",
    );
  return problems;
}

export function readHrefPatternProblems(web) {
  const schemaDir = join(web, "..", "content", "schema");
  const json = (name) =>
    JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
  return hrefPatternProblems(
    readFileSync(join(web, hrefModule), "utf8"),
    json("body.schema.json"),
    json("content.schema.json"),
  );
}
