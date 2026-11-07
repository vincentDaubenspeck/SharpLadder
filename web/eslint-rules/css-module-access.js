// Knip credits a CSS module class only when it is read by a static name, so the
// module object is acquired by one static default import and never travels.
// Case-insensitive, so a differently cased name gets the stricter policy too.
const moduleSpecifier = /\.module\.css(\?[^]*)?$/i;
// Vite also compiles these to CSS-module objects; only .module.css is admitted.
const otherFamily =
  /\.module\.(?:less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;

const staticText = (node) =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : null;

// A specifier that is not static text may name a CSS module, so it counts as
// unknown.
const classify = (source) => {
  const text = staticText(source);
  if (typeof text !== "string") return "unknown";
  if (otherFamily.test(text)) return "family";
  const match = moduleSpecifier.exec(text);
  if (!match) return null;
  return match[1] === undefined ? "module" : "query";
};

const importedName = (specifier) =>
  specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;

const keyName = (member) =>
  member.computed ? staticText(member.property) : member.property.name;

// An own class property can shadow an Object.prototype name; reserving the names
// of the standard, unmodified prototype avoids proving that it does not.
export const reservedNames = Object.freeze([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);
const reserved = new Set(reservedNames);

const wrappers = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

// These pass the read value on unchanged, so a call of them calls the read.
const passesOn = (node) => {
  const { parent } = node;
  switch (parent.type) {
    case "SequenceExpression":
      return parent.expressions.at(-1) === node;
    case "ConditionalExpression":
      return parent.test !== node;
    case "LogicalExpression":
      return true;
    default:
      return wrappers.has(parent.type);
  }
};

const isCallTarget = (member) => {
  let node = member;
  while (passesOn(node)) node = node.parent;
  const { parent } = node;
  switch (parent.type) {
    case "CallExpression":
    case "NewExpression":
      return parent.callee === node;
    case "TaggedTemplateExpression":
      return parent.tag === node;
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.superClass === node;
    default:
      return false;
  }
};

// These change the module object instead of reading a class from it.
const isWriteTarget = (member) => {
  const parent = member.parent;
  switch (parent.type) {
    case "AssignmentExpression":
    case "AssignmentPattern":
      return parent.left === member;
    case "UpdateExpression":
    case "RestElement":
      return true;
    case "UnaryExpression":
      return parent.operator === "delete";
    case "ArrayPattern":
      return true;
    case "Property":
      return parent.value === member && parent.parent.type === "ObjectPattern";
    case "ForInStatement":
    case "ForOfStatement":
      return parent.left === member;
    default:
      return false;
  }
};

const isPlainDestructuring = (pattern) =>
  pattern.type === "ObjectPattern" &&
  pattern.properties.every(
    (p) =>
      p.type === "Property" &&
      !p.computed &&
      p.key.type === "Identifier" &&
      !reserved.has(p.key.name) &&
      p.value.type === "Identifier",
  );

const inTypeQuery = (identifier) => {
  let node = identifier;
  while (node.parent?.type === "TSQualifiedName") node = node.parent;
  return node.parent?.type === "TSTypeQuery";
};

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Acquire a CSS module by one static default import and read its classes by static name",
    },
    messages: {
      computed:
        "Read a CSS module class by dot, string-literal or expression-free template key, not a computed key.",
      destructure:
        "Destructure a CSS module only with identifier class keys, without reserved names, defaults, nesting or a rest element.",
      dynamic:
        "Acquire a CSS module by a static default import, not by import(), require() or a glob.",
      call: "Read a CSS module class as a value; do not call or construct it.",
      family:
        "Use a .module.css CSS module; other CSS-module languages are not admitted.",
      escape:
        "Use a CSS module object only to read its classes by static name; do not alias, pass, return, spread, cast, write, enumerate or inspect it.",
      named:
        "Import a CSS module by its default binding and read classes from it, not by named imports.",
      namespace:
        "Import a CSS module by its default binding, not as a namespace.",
      query:
        "Import a CSS module from a specifier that ends in .module.css, without a query suffix.",
      reExport: "Do not re-export a CSS module.",
      reserved:
        "Do not read a CSS module key named after an Object.prototype member; the name is reserved.",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;

    const checkReference = (reference) => {
      const { identifier } = reference;
      if (reference.isValueReference === false || inTypeQuery(identifier)) {
        return;
      }
      const parent = identifier.parent;
      if (parent.type === "MemberExpression" && parent.object === identifier) {
        const name = keyName(parent);
        if (isWriteTarget(parent)) {
          context.report({ node: parent, messageId: "escape" });
        } else if (name === null) {
          context.report({ node: parent, messageId: "computed" });
        } else if (reserved.has(name)) {
          context.report({ node: parent, messageId: "reserved" });
        } else if (isCallTarget(parent)) {
          context.report({ node: parent, messageId: "call" });
        }
        return;
      }
      if (
        parent.type === "VariableDeclarator" &&
        parent.init === identifier &&
        parent.id.type === "ObjectPattern"
      ) {
        if (!isPlainDestructuring(parent.id)) {
          context.report({ node: parent.id, messageId: "destructure" });
        }
        return;
      }
      context.report({ node: identifier, messageId: "escape" });
    };

    const checkAcquisition = (node, source) => {
      const kind = classify(source);
      if (kind !== null) {
        context.report({
          node,
          messageId: kind === "family" ? "family" : "dynamic",
        });
      }
    };

    const reportReExport = (node) => {
      if (!node.source) return;
      const kind = classify(node.source);
      if (kind === "family") {
        context.report({ node, messageId: "family" });
      } else if (kind === "module" || kind === "query") {
        context.report({ node, messageId: "reExport" });
      }
    };

    return {
      ImportDeclaration(node) {
        const kind = classify(node.source);
        if (kind === "family") {
          context.report({ node, messageId: "family" });
          return;
        }
        if (kind === "query") {
          context.report({ node, messageId: "query" });
          return;
        }
        if (kind !== "module") return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            context.report({ node: specifier, messageId: "namespace" });
            continue;
          }
          if (
            specifier.type === "ImportSpecifier" &&
            importedName(specifier) !== "default"
          ) {
            context.report({ node: specifier, messageId: "named" });
            continue;
          }
          for (const variable of sourceCode.getDeclaredVariables(specifier)) {
            variable.references.forEach(checkReference);
          }
        }
      },
      ImportExpression(node) {
        checkAcquisition(node, node.source);
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type === "Identifier" && callee.name === "require") {
          checkAcquisition(node, node.arguments[0]);
        }
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "MetaProperty" &&
          callee.object.meta.name === "import" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "glob"
        ) {
          const patterns = node.arguments[0];
          const items =
            patterns?.type === "ArrayExpression"
              ? patterns.elements
              : [patterns];
          const globbed = items.some((item) => {
            const text = staticText(item);
            return typeof text !== "string" || /\.module\./i.test(text);
          });
          if (globbed) context.report({ node, messageId: "dynamic" });
        }
      },
      TSImportEqualsDeclaration(node) {
        const ref = node.moduleReference;
        if (ref.type === "TSExternalModuleReference") {
          checkAcquisition(node, ref.expression);
        }
      },
      ExportAllDeclaration: reportReExport,
      ExportNamedDeclaration: reportReExport,
    };
  },
};
