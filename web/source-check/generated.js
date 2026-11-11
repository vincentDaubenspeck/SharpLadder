import { readFileSync } from "node:fs";
import ts from "typescript";
import { shown } from "./paths.js";

const typesHeader =
  "// SharpLadder.Content type emitter output, grammar 1. Do not edit.";
const witnessHeader =
  "// SharpLadder.Content witness emitter output, grammar 1. Do not edit.";
const typeModules = new Set(["body.ts", "content.ts"]);
const propertyName = /^[a-z][A-Za-z0-9]{0,47}(?![\s\S])/u;
const aliasName = /^[A-Z][A-Za-z0-9]{0,47}(?![\s\S])/u;
const digits = /^(?:0|[1-9][0-9]*)(?![\s\S])/u;
const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
const K = ts.SyntaxKind;
// A byte-order mark is kept, so the header check refuses it.
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function parse(name, text, problems) {
  const file = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const d of file.parseDiagnostics)
    problems.push(
      `does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
    );
  return file;
}

// Every comment is trivia in front of some token, so scanning each token's trivia finds them all.
function comments(file) {
  const found = new Map();
  const visit = (node) => {
    if (node.kind < K.FirstNode || node.kind === K.EndOfFileToken) {
      const ranges = [
        ...(ts.getLeadingCommentRanges(file.text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(file.text, node.pos) ?? []),
      ];
      for (const r of ranges) found.set(r.pos, file.text.slice(r.pos, r.end));
    }
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return [...found].sort(([a], [b]) => a - b);
}

function headerProblems(file, header, problems) {
  const all = comments(file);
  if (!file.text.startsWith(`${header}\n\n`))
    problems.push("does not start with the generator header");
  if (all.length !== 1 || all[0][0] !== 0 || all[0][1] !== header)
    problems.push("has a comment other than the generator header");
}

const only = (modifiers, kind) =>
  modifiers?.length === 1 && modifiers[0].kind === kind;

// Identifier text is decoded, so an escaped spelling is caught by comparing the source text.
const plainName = (file, node, pattern) =>
  ts.isIdentifier(node) &&
  node.getText(file) === node.text &&
  pattern.test(node.text);

function typeImportProblems(file, node, name, specifier) {
  const clause = node.importClause;
  const named = clause?.namedBindings;
  if (
    node.modifiers !== undefined ||
    node.attributes !== undefined ||
    clause?.isTypeOnly !== true ||
    clause.name !== undefined ||
    named === undefined ||
    !ts.isNamedImports(named) ||
    !ts.isStringLiteral(node.moduleSpecifier) ||
    node.moduleSpecifier.getText(file) !== `"${specifier}"`
  )
    return [`import is not "import type { ... } from \\"${specifier}\\""`];
  const bad = named.elements.filter(
    (e) =>
      e.isTypeOnly ||
      e.propertyName !== undefined ||
      !plainName(file, e.name, aliasName) ||
      (name !== undefined && e.name.text !== name),
  );
  if (bad.length > 0 || (name !== undefined && named.elements.length !== 1))
    return [`import names are not exactly ${name ?? "plain aliases"}`];
  return [];
}

function numberProblem(file, node) {
  const token = node.getText(file);
  if (!digits.test(token) || BigInt(token) > maxSafe)
    return `number ${token} is not a safe integer token`;
  return undefined;
}

function valueProblems(file, node, at, problems) {
  if (ts.isObjectLiteralExpression(node)) {
    const seen = new Set();
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p) || !plainName(file, p.name, propertyName))
        problems.push(`${at}: member is not a plain property assignment`);
      else if (seen.has(p.name.text))
        problems.push(`${at}: duplicate property ${p.name.text}`);
      else {
        seen.add(p.name.text);
        valueProblems(file, p.initializer, `${at}.${p.name.text}`, problems);
      }
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    node.elements.forEach((e, i) => {
      valueProblems(file, e, `${at}[${String(i)}]`, problems);
    });
  } else if (ts.isStringLiteral(node)) {
    if (!node.getText(file).startsWith('"'))
      problems.push(`${at}: string is not double-quoted`);
  } else if (node.kind === K.TrueKeyword || node.kind === K.FalseKeyword) {
    // Boolean literals are admitted as they stand.
  } else if (ts.isNumericLiteral(node)) {
    const p = numberProblem(file, node);
    if (p) problems.push(`${at}: ${p}`);
  } else if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === K.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    const p = numberProblem(file, node.operand);
    if (p) problems.push(`${at}: ${p}`);
    else if (node.operand.getText(file) === "0")
      problems.push(`${at}: -0 is not a safe integer token`);
  } else problems.push(`${at}: ${K[node.kind]} is not an admitted value`);
}

/** The witness grammar of the brief, section 3.2, checked on the parsed module. */
export function witnessProblems(path, text) {
  const problems = [];
  const file = parse(path, text, problems);
  if (problems.length > 0) return problems;
  headerProblems(file, witnessHeader, problems);
  const depth = path.split("/").length - 1;
  const specifier = `${"../".repeat(depth)}content.ts`;
  const [first, second, ...rest] = file.statements;
  if (rest.length > 0 || second === undefined)
    problems.push("is not exactly one import and one export");
  if (first === undefined || !ts.isImportDeclaration(first))
    problems.push("first statement is not the type import");
  else
    problems.push(...typeImportProblems(file, first, "ContentDoc", specifier));
  if (second === undefined) return problems;
  const list = ts.isVariableStatement(second) ? second.declarationList : null;
  const [declaration, ...others] = list?.declarations ?? [];
  const init = declaration?.initializer;
  if (
    !only(second.modifiers, K.ExportKeyword) ||
    !list ||
    (list.flags & ts.NodeFlags.BlockScoped) !== ts.NodeFlags.Const ||
    others.length > 0 ||
    !plainName(file, declaration.name, /^witness(?![\s\S])/u) ||
    declaration.type !== undefined ||
    declaration.exclamationToken !== undefined ||
    init === undefined ||
    !ts.isSatisfiesExpression(init) ||
    !ts.isTypeReferenceNode(init.type) ||
    init.type.typeArguments !== undefined ||
    !plainName(file, init.type.typeName, /^ContentDoc(?![\s\S])/u) ||
    !ts.isObjectLiteralExpression(init.expression)
  ) {
    problems.push(
      "export is not exactly export const witness = { ... } satisfies ContentDoc",
    );
    return problems;
  }
  valueProblems(file, init.expression, "witness", problems);
  return problems;
}

const literalString = /^[a-z][a-z0-9-]{0,47}(?![\s\S])/u;
// Global and library names an alias could shadow, as the emitter refuses them.
const reservedAliases = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Function",
  "Map",
  "Number",
  "Object",
  "Promise",
  "Record",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "ReturnType",
  "JSX",
  "React",
]);

const withoutParentheses = (node) =>
  ts.isParenthesizedTypeNode(node) ? withoutParentheses(node.type) : node;

// Structural equality of two type nodes: kinds, names, literal values and operators, never trivia.
function sameType(a, b) {
  const x = withoutParentheses(a);
  const y = withoutParentheses(b);
  if (x.kind !== y.kind || x.operator !== y.operator) return false;
  if ("text" in x && x.text !== y.text) return false;
  const xs = [];
  const ys = [];
  ts.forEachChild(x, (c) => {
    xs.push(c);
  });
  ts.forEachChild(y, (c) => {
    ys.push(c);
  });
  return xs.length === ys.length && xs.every((c, i) => sameType(c, ys[i]));
}

// The place says where the emitter can put a node: never only as an optional property's type,
// and parentheses only around a union that is an array or tuple element.
function typeNodeProblems(file, node, at, problems, place = "alias") {
  const recurse = (child, where) => {
    typeNodeProblems(file, child, at, problems, where);
  };
  switch (node.kind) {
    case K.StringKeyword:
    case K.NumberKeyword:
    case K.BooleanKeyword:
      return;
    case K.NeverKeyword:
      if (place !== "optional")
        problems.push(`${at}: never is not an optional property's type`);
      return;
    case K.TypeReference:
      if (
        node.typeArguments !== undefined ||
        !plainName(file, node.typeName, aliasName)
      )
        problems.push(`${at}: type reference is not a plain alias`);
      return;
    case K.LiteralType: {
      const l = node.literal;
      if (ts.isStringLiteral(l)) {
        if (l.getText(file) !== `"${l.text}"` || !literalString.test(l.text))
          problems.push(
            `${at}: string literal type is outside the literal grammar`,
          );
      } else if (ts.isNumericLiteral(l)) {
        const p = numberProblem(file, l);
        if (p) problems.push(`${at}: ${p}`);
      } else if (
        ts.isPrefixUnaryExpression(l) &&
        l.operator === K.MinusToken &&
        ts.isNumericLiteral(l.operand) &&
        numberProblem(file, l.operand) === undefined &&
        l.operand.getText(file) !== "0"
      ) {
        // A negative safe integer literal type.
      } else problems.push(`${at}: literal type is not admitted`);
      return;
    }
    case K.TypeLiteral: {
      if (node.members.length === 0)
        problems.push(`${at}: object type has no members`);
      const names = new Set();
      for (const m of node.members) {
        if (
          !ts.isPropertySignature(m) ||
          m.modifiers !== undefined ||
          m.type === undefined ||
          !plainName(file, m.name, propertyName)
        )
          problems.push(`${at}: member is not a plain property signature`);
        else {
          if (names.has(m.name.text))
            problems.push(`${at}: property ${m.name.text} is declared twice`);
          names.add(m.name.text);
          recurse(
            m.type,
            m.questionToken === undefined ? "required" : "optional",
          );
        }
      }
      return;
    }
    case K.UnionType:
      if (node.types.length < 2)
        problems.push(`${at}: union has fewer than two members`);
      node.types.forEach((t, i) => {
        if (ts.isUnionTypeNode(t) || ts.isParenthesizedTypeNode(t))
          problems.push(
            `${at}: union member is itself a union or parenthesised`,
          );
        else if (node.types.slice(0, i).some((u) => sameType(t, u)))
          problems.push(`${at}: union repeats a member`);
        recurse(t, "union");
      });
      return;
    case K.ArrayType:
      recurse(node.elementType, "element");
      return;
    case K.TupleType: {
      const [head, last] = node.elements;
      if (
        node.elements.length !== 2 ||
        ts.isNamedTupleMember(head) ||
        ts.isRestTypeNode(head) ||
        ts.isOptionalTypeNode(head) ||
        !ts.isRestTypeNode(last) ||
        !ts.isArrayTypeNode(last.type)
      )
        problems.push(`${at}: tuple is not [T, ...T[]]`);
      else if (!sameType(head, last.type.elementType))
        problems.push(`${at}: tuple rest does not repeat the first item type`);
      else {
        recurse(head, "element");
        recurse(last.type, "tuple rest");
      }
      return;
    }
    case K.ParenthesizedType:
      if (place !== "element" || !ts.isUnionTypeNode(node.type))
        problems.push(
          `${at}: parentheses are not around an array or tuple element union`,
        );
      recurse(node.type, place);
      return;
    default:
      problems.push(`${at}: ${K[node.kind]} is not an admitted type node`);
  }
}

/** The type grammar of the brief, section 3.1, checked on the parsed module. */
export function typeModuleProblems(name, text) {
  const problems = [];
  const file = parse(name, text, problems);
  if (problems.length > 0) return problems;
  headerProblems(file, typesHeader, problems);
  const aliases = new Set();
  file.statements.forEach((s, i) => {
    if (ts.isImportDeclaration(s)) {
      if (name !== "content.ts" || i !== 0)
        problems.push("has an import other than content.ts's body import");
      else
        problems.push(...typeImportProblems(file, s, undefined, "./body.ts"));
    } else if (ts.isTypeAliasDeclaration(s)) {
      const alias = s.name.text;
      if (
        !only(s.modifiers, K.ExportKeyword) ||
        s.typeParameters !== undefined ||
        !plainName(file, s.name, aliasName)
      )
        problems.push(`${alias}: is not a plain exported type alias`);
      else if (aliases.has(alias)) problems.push(`${alias}: is declared twice`);
      else if (
        reservedAliases.has(alias) ||
        (alias === "ContentDoc" && name !== "content.ts")
      )
        problems.push(`${alias}: is a reserved alias name`);
      aliases.add(alias);
      typeNodeProblems(file, s.type, alias, problems);
    } else problems.push(`${K[s.kind]} is not an admitted top-level statement`);
  });
  if (name === "content.ts" && !aliases.has("ContentDoc"))
    problems.push("does not export ContentDoc");
  return problems;
}

/** Checks every admitted file under src/generated against its grammar. */
export function generatedProblems(src, admitted) {
  const problems = [];
  for (const { path: full } of admitted) {
    const path = shown(src, full);
    if (!path.startsWith("generated/")) continue;
    const inner = path.slice("generated/".length);
    const read = () => strict.decode(readFileSync(full));
    let found;
    if (typeModules.has(inner)) found = typeModuleProblems(inner, read());
    else if (/^witness\/.+\.ts$/u.test(inner))
      found = witnessProblems(inner, read());
    else found = ["is not a generated type or witness module"];
    for (const p of found) problems.push(`src/${path}: ${p}`);
  }
  return problems;
}

function decode(node) {
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((p) => [p.name.text, decode(p.initializer)]),
    );
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(decode);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node)) return -Number(node.operand.text);
  return node.kind === K.TrueKeyword;
}

/** Decodes an admitted witness module's value from its syntax tree, never by running it. */
export function witnessValue(path, text) {
  const problems = witnessProblems(path, text);
  if (problems.length > 0) throw new Error(problems.join("; "));
  const file = parse(path, text, problems);
  return decode(
    file.statements[1].declarationList.declarations[0].initializer.expression,
  );
}
