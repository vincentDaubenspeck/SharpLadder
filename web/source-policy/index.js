// The one source-language policy for application code, shared by the ESLint rule and the build
// guard. Both judge the typescript-eslint tree and its scope manager, so binding and hoisting
// follow the parser of record, and no disable comment can reach the build's verdict.
import { parseForESLint } from "@typescript-eslint/parser";

// A run-time read or write of one of these fails unless a run-time binding shadows it.
const bannedGlobals = new Set([
  "Function",
  "SharedWorker",
  "Worker",
  "document",
  "eval",
  "frames",
  "globalThis",
  "parent",
  "self",
  "top",
  "window",
]);
const workerNames = new Set(["SharedWorker", "Worker"]);

const skipKeys = new Set([
  "parent",
  "loc",
  "range",
  "start",
  "end",
  "tokens",
  "comments",
  "hashbang",
]);

// Every node type the policy has been checked against; any other type is a finding.
const knownTypes = new Set([
  "AccessorProperty",
  "ArrayExpression",
  "ArrayPattern",
  "ArrowFunctionExpression",
  "AssignmentExpression",
  "AssignmentPattern",
  "AwaitExpression",
  "BinaryExpression",
  "BlockStatement",
  "BreakStatement",
  "CallExpression",
  "CatchClause",
  "ChainExpression",
  "ClassBody",
  "ClassDeclaration",
  "ClassExpression",
  "ConditionalExpression",
  "ContinueStatement",
  "DebuggerStatement",
  "Decorator",
  "DoWhileStatement",
  "EmptyStatement",
  "ExportAllDeclaration",
  "ExportDefaultDeclaration",
  "ExportNamedDeclaration",
  "ExportSpecifier",
  "ExpressionStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "Identifier",
  "IfStatement",
  "ImportAttribute",
  "ImportDeclaration",
  "ImportDefaultSpecifier",
  "ImportExpression",
  "ImportNamespaceSpecifier",
  "ImportSpecifier",
  "JSXAttribute",
  "JSXClosingElement",
  "JSXClosingFragment",
  "JSXElement",
  "JSXEmptyExpression",
  "JSXExpressionContainer",
  "JSXFragment",
  "JSXIdentifier",
  "JSXMemberExpression",
  "JSXNamespacedName",
  "JSXOpeningElement",
  "JSXOpeningFragment",
  "JSXSpreadAttribute",
  "JSXSpreadChild",
  "JSXText",
  "LabeledStatement",
  "Literal",
  "LogicalExpression",
  "MemberExpression",
  "MetaProperty",
  "MethodDefinition",
  "NewExpression",
  "ObjectExpression",
  "ObjectPattern",
  "PrivateIdentifier",
  "Program",
  "Property",
  "PropertyDefinition",
  "RestElement",
  "ReturnStatement",
  "SequenceExpression",
  "SpreadElement",
  "StaticBlock",
  "Super",
  "SwitchCase",
  "SwitchStatement",
  "TaggedTemplateExpression",
  "TemplateElement",
  "TemplateLiteral",
  "ThisExpression",
  "ThrowStatement",
  "TryStatement",
  "UnaryExpression",
  "UpdateExpression",
  "VariableDeclaration",
  "VariableDeclarator",
  "WhileStatement",
  "YieldExpression",
  "TSAbstractAccessorProperty",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSArrayType",
  "TSAsExpression",
  "TSCallSignatureDeclaration",
  "TSClassImplements",
  "TSConditionalType",
  "TSConstructSignatureDeclaration",
  "TSConstructorType",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSEnumBody",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSExportAssignment",
  "TSExternalModuleReference",
  "TSFunctionType",
  "TSImportEqualsDeclaration",
  "TSImportType",
  "TSIndexSignature",
  "TSIndexedAccessType",
  "TSInferType",
  "TSInstantiationExpression",
  "TSInterfaceBody",
  "TSInterfaceDeclaration",
  "TSInterfaceHeritage",
  "TSIntersectionType",
  "TSLiteralType",
  "TSMappedType",
  "TSMethodSignature",
  "TSModuleBlock",
  "TSModuleDeclaration",
  "TSNamedTupleMember",
  "TSNamespaceExportDeclaration",
  "TSNonNullExpression",
  "TSOptionalType",
  "TSParameterProperty",
  "TSParenthesizedType",
  "TSPropertySignature",
  "TSQualifiedName",
  "TSRestType",
  "TSSatisfiesExpression",
  "TSTemplateLiteralType",
  "TSThisType",
  "TSTupleType",
  "TSTypeAliasDeclaration",
  "TSTypeAnnotation",
  "TSTypeAssertion",
  "TSTypeLiteral",
  "TSTypeOperator",
  "TSTypeParameter",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypePredicate",
  "TSTypeQuery",
  "TSTypeReference",
  "TSUnionType",
]);
const keywordType = /^TS[A-Za-z]+Keyword$/u;

// Subtrees both compilers erase, so a type query inside them reads no run-time value.
const erasedTypes = new Set([
  "TSClassImplements",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSInterfaceDeclaration",
  "TSInterfaceHeritage",
  "TSTypeAliasDeclaration",
  "TSTypeAnnotation",
  "TSTypeLiteral",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypeQuery",
]);
const isErased = (node) =>
  erasedTypes.has(node.type) ||
  node.declare === true ||
  (node.type === "TSImportEqualsDeclaration" && node.importKind === "type");

const children = (node) => {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (skipKeys.has(key) || value === null || typeof value !== "object")
      continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (typeof child?.type === "string") out.push(child);
    }
  }
  return out;
};

// Erased declarations and type-only imports leave the name unbound at run time. A namespace or
// const enum may be erased too, so neither counts as a run-time binding of a banned name. A
// function or class expression's own name is bound inside it at run time.
const runtimeDefinition = (def) => {
  switch (def.type) {
    case "ImportBinding":
      return def.parent.importKind !== "type" && def.node.importKind !== "type";
    case "Variable":
      return def.parent?.declare !== true;
    case "FunctionName":
      return (
        def.node.type === "FunctionExpression" ||
        (def.node.type === "FunctionDeclaration" && !def.node.declare)
      );
    case "ClassName":
      return !def.node.declare;
    case "TSEnumName":
      return !def.node.declare && !def.node.const;
    case "Parameter":
    case "CatchClause":
      return true;
    default:
      return false;
  }
};

// A value reference reaches the host when nothing in the module binds it at run time: it is
// unresolved, resolved to a lib or configured global, or bound only by erased syntax.
function hostReferences(scopeManager) {
  const ids = new Set();
  for (const scope of scopeManager.scopes) {
    for (const reference of scope.references) {
      const { identifier, resolved } = reference;
      // A scope manager without type flags sees no types, so its every reference is a value.
      if (
        reference.isValueReference === false ||
        !bannedGlobals.has(identifier.name)
      )
        continue;
      if (
        resolved === null ||
        resolved.scope.type === "global" ||
        !resolved.defs.some(runtimeDefinition)
      )
        ids.add(identifier);
    }
  }
  return ids;
}

// The one admitted use of document: the entry lookup of the page's root element.
const isRootLookup = (call) =>
  !call.optional &&
  !call.typeArguments &&
  call.callee.type === "MemberExpression" &&
  !call.callee.computed &&
  !call.callee.optional &&
  call.callee.object.type === "Identifier" &&
  call.callee.object.name === "document" &&
  call.callee.property.type === "Identifier" &&
  call.callee.property.name === "getElementById" &&
  call.arguments.length === 1 &&
  call.arguments[0].type === "Literal" &&
  call.arguments[0].value === "root";

const staticKey = (node) =>
  node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node.type === "TemplateLiteral" && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : null;

// An empty clause leaves the attribute list empty, so presence is read from the tokens: only a
// statement terminator may follow the source. Missing tokens count as a clause.
const firstTokenFrom = (tokens, offset) => {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (tokens[mid].range[0] < offset) low = mid + 1;
    else high = mid;
  }
  return low;
};

const hasAttributes = (node, tokens) => {
  if (
    (node.attributes?.length ?? 0) > 0 ||
    (node.assertions?.length ?? 0) > 0 ||
    Boolean(node.withClause)
  )
    return true;
  if (!node.source) return false;
  if (!Array.isArray(tokens)) return true;
  const end = node.range[1];
  for (
    let i = firstTokenFrom(tokens, node.source.range[1]);
    i < tokens.length;
    i++
  ) {
    const token = tokens[i];
    if (token.range[0] >= end) break;
    if (!(token.type === "Punctuator" && token.value === ";")) return true;
  }
  return false;
};

// The parser of record, configured as the editor sees source; only .tsx admits JSX.
export function parseSource(code, filePath) {
  return parseForESLint(code, {
    filePath,
    range: true,
    loc: true,
    jsx: filePath.endsWith(".tsx"),
    sourceType: "module",
  });
}

// Returns every finding in source order as { node, kind, name }; kind is importMeta,
// dynamicImport, attributes, requireImport, global or unsupported. An unknown node type is a
// finding, never a pass.
export function checkProgram(program, scopeManager) {
  const found = [];
  const report = (node, kind, name = node.type) => {
    found.push({ node, kind, name });
  };
  const host = hostReferences(scopeManager);
  const admitted = new Set();

  const visit = (node, inErased) => {
    const { type } = node;
    if (!knownTypes.has(type) && !keywordType.test(type)) {
      report(node, "unsupported");
      return;
    }
    const erased = inErased || isErased(node);
    switch (type) {
      case "CallExpression":
        if (isRootLookup(node)) admitted.add(node.callee.object);
        break;
      case "Identifier":
      case "JSXIdentifier":
        if (!erased && host.has(node) && !admitted.has(node))
          report(node, "global", node.name);
        break;
      case "MemberExpression": {
        // A worker key is named even where the object is already refused, so the message says
        // which capability was reached.
        const key = node.computed
          ? staticKey(node.property)
          : host.has(node.object)
            ? node.property.name
            : null;
        if (!erased && workerNames.has(key)) report(node, "global", key);
        break;
      }
      case "MetaProperty":
        if (node.meta.name === "import") report(node, "importMeta");
        break;
      case "ImportExpression":
        report(node, "dynamicImport");
        break;
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        if (hasAttributes(node, program.tokens)) report(node, "attributes");
        break;
      case "TSExternalModuleReference":
        report(node, "requireImport");
        return;
      default:
        break;
    }
    for (const child of children(node)) visit(child, erased);
  };

  visit(program, false);
  return found;
}

export function describeFinding({ kind, name }) {
  switch (kind) {
    case "importMeta":
      return "import.meta";
    case "dynamicImport":
      return "import()";
    case "attributes":
      return "import attributes";
    case "requireImport":
      return "import = require()";
    case "global":
      return `reference to ${name}`;
    default:
      return `unsupported syntax ${name}`;
  }
}
