// Source rules for the content renderer: its frozen module list, import graph, exports, and the
// elements, attributes and attribute value sources it may write, plus the markup sinks banned
// in all of src. They bound the tracked source only, never the data it renders, and fail
// closed: an element, attribute, expression form or import they do not recognise is a finding.
import { createHash } from "node:crypto";

// Each renderer module, keyed by its path under src, with exactly the bindings it exports.
export const rendererModules = new Map([
  ["content/assertNever.ts", ["assertNever"]],
  ["content/href.ts", ["internalHref", "buildSlugMap", "type SlugMap"]],
  ["content/ContentLink.tsx", ["ContentLink"]],
  ["content/Spans.tsx", ["Spans", "LinkContent"]],
  ["content/Blocks.tsx", ["Blocks"]],
  ["content/ContentView.tsx", ["ContentView"]],
]);

// The reviewed helpers the JSX modules trust, each pinned to the SHA-256 of its exact text.
export const helperPins = new Map([
  [
    "content/assertNever.ts",
    "c0ec0b0d9ed46a593853aea55684d37376b81ecb821a66b685d41a958a8e5c23",
  ],
  [
    "content/href.ts",
    "277784cb68dddd5d86588e51dbc868cd161cdcc2934ea9551c32a8a8735f8643",
  ],
]);

// A checkout may use CRLF, so only that is undone; a byte order mark is refused, never hashed.
export const helperDigest = (text) =>
  createHash("sha256")
    .update(text.replaceAll("\r\n", "\n"), "utf8")
    .digest("hex");

// The one pin policy for both entry points. ESLint strips one byte order mark from the text and
// reports it in hasBOM while the build reads the raw file, so either signal is the same finding.
function helperPinFindings(unit, text, hasBOM = false) {
  const pin = helperPins.get(unit);
  if (pin === undefined)
    return [`src/${unit} is a helper with no reviewed pin`];
  if (typeof text !== "string")
    return [`src/${unit} has no source text to check against its pin`];
  if (hasBOM === true || text.startsWith("\uFEFF"))
    return [
      `src/${unit}: a reviewed helper must not start with a byte order mark`,
    ];
  if (helperDigest(text) !== pin)
    return [
      `src/${unit}: the reviewed helper source changed; update its pin only after a review of the whole helper`,
    ];
  return [];
}

// The renderer's tests and the round trip's declaration are admitted by exact path and get only
// the src-wide rules; an admitted path is never a renderer module, whichever folder holds it.
export const rendererTests = new Set([
  "content/round-trip.test.tsx",
  "content/provided.d.ts",
  "content-tests/href.test.ts",
  "content-tests/renderer.test.tsx",
]);

const generatedTypes = new Set([
  "../generated/body.ts",
  "../generated/content.ts",
]);
const reactValues = new Set(["useId"]);
const reactTypes = new Set(["ReactElement", "ReactNode"]);
const elementFactories = new Set([
  "createElement",
  "cloneElement",
  "jsx",
  "jsxs",
]);
const markupSinks = new Set([
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "srcdoc",
]);
const tsDirectives = ["@ts-ignore", "@ts-nocheck", "@ts-expect-error"];

// Every intrinsic may carry key; these are the only other attributes per element.
const intrinsics = new Map([
  ["div", ["id"]],
  ["span", ["id"]],
  ["h2", ["id"]],
  ["h3", ["id"]],
  ["p", []],
  ["ul", []],
  ["ol", ["start"]],
  ["li", []],
  ["pre", ["aria-labelledby"]],
  ["code", []],
  ["em", []],
  ["strong", []],
  ["a", ["href"]],
]);

// Props a renderer component may never receive, compared without case.
const componentBanned = new Set([
  "ref",
  "href",
  "src",
  "srcset",
  "action",
  "formaction",
  "poster",
  "data",
  "xlinkhref",
  "style",
  "classname",
]);

const hrefModule = "content/ContentLink.tsx";
const badCall = "this call is not admitted in a JSX renderer module";

const reserved = ["content", "content-tests", "generated"];
const folderOf = (unit) =>
  typeof unit === "string" && unit.includes("/")
    ? unit.slice(0, unit.indexOf("/"))
    : null;

/** Whether a path under src lies in a renderer folder, under any letter case of its name. */
export const isReservedPath = (unit) =>
  reserved.includes(folderOf(unit)?.toLowerCase());

// A path that differs from a reserved one only in letter case is a separate file on some
// systems and the same file on others, so it is neither a renderer module nor ordinary source.
const listed = new Set(
  [...rendererModules.keys(), ...rendererTests].map((u) => u.toLowerCase()),
);
const isLookalike = (unit) =>
  (isReservedPath(unit) && !reserved.includes(folderOf(unit))) ||
  (listed.has(unit.toLowerCase()) &&
    !rendererModules.has(unit) &&
    !rendererTests.has(unit));

function unitKind(unit) {
  if (typeof unit !== "string") return "other";
  if (isLookalike(unit)) return "lookalike";
  if (rendererTests.has(unit)) return "test";
  if (unit.startsWith("content/"))
    return rendererModules.has(unit) ? "renderer" : "unlisted";
  if (unit.startsWith("content-tests/")) return "unlisted";
  if (unit.startsWith("generated/")) return "generated";
  return "other";
}

const staticName = (node) => {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return null;
};

const memberName = (node) =>
  node.computed ? staticName(node.property) : node.property.name;

const propertyName = (node) => staticName(node.key);

const isTopLevelFunction = (node) =>
  node?.type === "FunctionDeclaration" &&
  (node.parent.type === "Program" ||
    (node.parent.type === "ExportNamedDeclaration" &&
      node.parent.parent.type === "Program"));

const importedName = (spec) => staticName(spec.imported);

const isTypeImport = (spec) =>
  spec.parent.importKind === "type" || spec.importKind === "type";

const relativeUnit = (source) =>
  source.startsWith("./") && !source.slice(2).includes("/")
    ? `content/${source.slice(2)}`
    : null;

export function rendererFindings(
  program,
  scopeManager,
  unit,
  children,
  text = null,
  hasBOM = false,
) {
  const found = [];
  const report = (node, name) => found.push({ node, kind: "renderer", name });
  const kind = unitKind(unit);
  const renderer = kind === "renderer";
  const typed = renderer || kind === "generated";
  // For certified plain data and ordinary arrays, the JSX modules hold no construct that writes to
  // their inputs, given href.ts and assertNever.ts as pinned in helperPins; no rule checks the
  // calls inside those two. The pin is a review tripwire, not a defence against an edit of this
  // file. This is not a proof for arbitrary JavaScript values, nor that a newly built component
  // prop came from the compiler.
  const jsx = renderer && unit.endsWith(".tsx");

  // The build parse carries no parent links; ESLint's links are the same ones.
  const link = (node) => {
    for (const child of children(node)) {
      child.parent ??= node;
      link(child);
    }
  };
  link(program);

  const references = new Map();
  for (const scope of scopeManager.scopes) {
    for (const reference of scope.references)
      references.set(reference.identifier, reference);
  }
  const variableOf = (identifier) =>
    references.get(identifier)?.resolved ?? null;
  const onlyDef = (variable) =>
    variable !== null &&
    variable.defs.length === 1 &&
    !variable.references.some((r) => r.isWrite() && !r.init)
      ? variable.defs[0]
      : null;

  // A shorthand property of the destructured first parameter of a top-level function.
  const isPropParameter = (identifier, name, fn = () => true) => {
    if (identifier?.type !== "Identifier" || identifier.name !== name)
      return false;
    const def = onlyDef(variableOf(identifier));
    if (def?.type !== "Parameter" || !isTopLevelFunction(def.node))
      return false;
    if (!fn(def.node)) return false;
    const property = def.name.parent;
    return (
      property.type === "Property" &&
      property.shorthand &&
      !property.computed &&
      property.value === def.name &&
      property.parent === def.node.params[0] &&
      property.parent.type === "ObjectPattern"
    );
  };

  const isParamMember = (expression, object, field) =>
    expression?.type === "MemberExpression" &&
    !expression.computed &&
    !expression.optional &&
    expression.property.name === field &&
    isPropParameter(expression.object, object);

  const isReactUseId = (callee) => {
    if (callee.type !== "Identifier" || callee.name !== "useId") return false;
    const def = onlyDef(variableOf(callee));
    return (
      def?.type === "ImportBinding" &&
      def.node.type === "ImportSpecifier" &&
      importedName(def.node) === "useId" &&
      !isTypeImport(def.node) &&
      def.parent.source.value === "react"
    );
  };

  // The binding a label id comes from: a const initialised by a bare call of React's useId.
  const useIdVariable = (expression) => {
    if (expression?.type !== "Identifier") return null;
    const variable = variableOf(expression);
    const def = onlyDef(variable);
    if (
      def?.type !== "Variable" ||
      def.parent.kind !== "const" ||
      def.node.id !== def.name
    )
      return null;
    const init = def.node.init;
    return init?.type === "CallExpression" &&
      !init.optional &&
      !init.typeArguments &&
      init.arguments.length === 0 &&
      isReactUseId(init.callee)
      ? variable
      : null;
  };

  // A collection the renderer may map over: a plain member chain rooted at a destructured prop
  // or at the element parameter of an admitted inline map callback.
  const isCollection = (expression) => {
    let node = expression;
    while (node.type === "MemberExpression") {
      if (node.computed || node.optional) return false;
      node = node.object;
    }
    if (node.type !== "Identifier") return false;
    const def = onlyDef(variableOf(node));
    if (def?.type !== "Parameter") return false;
    if (isTopLevelFunction(def.node)) return isPropParameter(node, node.name);
    const callback = def.node;
    return (
      callback.type === "ArrowFunctionExpression" &&
      callback.params[0] === def.name &&
      isMapCall(callback.parent) &&
      callback.parent.arguments[0] === callback
    );
  };

  const isMapCall = (call) => {
    if (call?.type !== "CallExpression") return false;
    const { callee, arguments: args } = call;
    return (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      !callee.optional &&
      callee.property.type === "Identifier" &&
      callee.property.name === "map" &&
      args.length === 1 &&
      args[0].type === "ArrowFunctionExpression" &&
      !args[0].async &&
      isCollection(callee.object)
    );
  };

  // A reviewed callee: a top-level function declaration of this module or a value import from a
  // listed renderer module, each with one definition and never written.
  const isRendererBinding = (callee) => {
    if (callee.type !== "Identifier") return false;
    const def = onlyDef(variableOf(callee));
    if (def?.type === "FunctionName") return isTopLevelFunction(def.node);
    return (
      def?.type === "ImportBinding" &&
      def.node.type === "ImportSpecifier" &&
      !isTypeImport(def.node) &&
      rendererModules.has(relativeUnit(def.parent.source.value) ?? "")
    );
  };

  const checkCall = (call) => {
    if (
      call.optional ||
      call.typeArguments ||
      call.arguments.some((a) => a.type === "SpreadElement")
    )
      report(call, "an optional, generic or spread call is not admitted");
    else if (
      !isRendererBinding(call.callee) &&
      !isReactUseId(call.callee) &&
      !isMapCall(call)
    )
      report(
        call,
        call.callee.type === "Identifier" &&
          onlyDef(variableOf(call.callee))?.type === "Variable"
          ? `${badCall}: a helper must be a top-level function declaration`
          : badCall,
      );
  };

  const expressionOf = (attribute) =>
    attribute.value?.type === "JSXExpressionContainer"
      ? attribute.value.expression
      : null;

  const isHrefCall = (expression) => {
    if (
      expression?.type !== "CallExpression" ||
      expression.optional ||
      expression.typeArguments ||
      expression.arguments.length !== 2
    )
      return false;
    const { callee } = expression;
    if (callee.type !== "Identifier" || callee.name !== "internalHref")
      return false;
    const def = onlyDef(variableOf(callee));
    if (
      def?.type !== "ImportBinding" ||
      def.node.type !== "ImportSpecifier" ||
      importedName(def.node) !== "internalHref" ||
      isTypeImport(def.node) ||
      def.parent.source.value !== "./href.ts"
    )
      return false;
    const isContentLink = (fn) =>
      fn.id?.name === "ContentLink" &&
      fn.parent.type === "ExportNamedDeclaration";
    const [first, second] = expression.arguments;
    return (
      isPropParameter(first, "link", isContentLink) &&
      isPropParameter(second, "slugs", isContentLink)
    );
  };

  // The span carrying the label must come before its pre among the same parent's children.
  const hasLabelSibling = (pre, variable) => {
    const parent = pre.parent;
    if (parent.type !== "JSXElement" && parent.type !== "JSXFragment")
      return false;
    for (const child of parent.children) {
      if (child === pre) return false;
      if (
        child.type === "JSXElement" &&
        child.openingElement.name.type === "JSXIdentifier" &&
        child.openingElement.name.name === "span" &&
        child.openingElement.attributes.some(
          (a) =>
            a.type === "JSXAttribute" &&
            a.name.name === "id" &&
            useIdVariable(expressionOf(a)) === variable,
        )
      )
        return true;
    }
    return false;
  };

  let hrefCount = 0;

  const checkIntrinsic = (opening, tag) => {
    const allowed = intrinsics.get(tag);
    if (allowed === undefined) {
      report(opening.name, `element <${tag}> is not admitted in the renderer`);
      return;
    }
    const seen = new Set();
    for (const attribute of opening.attributes) {
      if (attribute.type !== "JSXAttribute") continue;
      if (attribute.name.type !== "JSXIdentifier") {
        report(attribute, `namespaced attribute on <${tag}> is not admitted`);
        continue;
      }
      const name = attribute.name.name;
      if (seen.has(name)) report(attribute, `attribute ${name} is repeated`);
      seen.add(name);
      if (name !== "key" && !allowed.includes(name)) {
        report(attribute, `attribute ${name} is not admitted on <${tag}>`);
        continue;
      }
      // React consumes key itself, so it never reaches the DOM and has no provenance to check.
      if (name === "key") continue;
      const expression = expressionOf(attribute);
      let ok;
      if (tag === "div") ok = isParamMember(expression, "block", "id");
      else if (tag === "h2" || tag === "h3")
        ok = isParamMember(expression, "section", "id");
      else if (tag === "ol") ok = isParamMember(expression, "block", "start");
      else if (tag === "span") ok = useIdVariable(expression) !== null;
      else if (tag === "pre") {
        const variable = useIdVariable(expression);
        ok = variable !== null && hasLabelSibling(opening.parent, variable);
      } else {
        hrefCount++;
        ok = unit === hrefModule && isHrefCall(expression);
      }
      if (!ok)
        report(
          attribute,
          `${name} on <${tag}> is not from its admitted source`,
        );
    }
  };

  const checkComponent = (opening) => {
    const { name } = opening;
    if (name.type !== "JSXIdentifier") {
      report(name, "a component tag must be a plain reviewed binding");
      return;
    }
    const def = onlyDef(variableOf(name));
    const admitted =
      (def?.type === "FunctionName" && isTopLevelFunction(def.node)) ||
      (def?.type === "ImportBinding" &&
        def.node.type === "ImportSpecifier" &&
        rendererModules.has(relativeUnit(def.parent.source.value)) &&
        !isTypeImport(def.node));
    if (!admitted)
      report(name, `component ${name.name} is not a reviewed renderer binding`);
    for (const attribute of opening.attributes) {
      if (attribute.type !== "JSXAttribute") continue;
      if (attribute.name.type !== "JSXIdentifier") {
        report(attribute, "namespaced attribute is not admitted");
        continue;
      }
      const lower = attribute.name.name.toLowerCase();
      if (componentBanned.has(lower) || lower.startsWith("on"))
        report(attribute, `prop ${attribute.name.name} is not admitted`);
    }
  };

  const checkImport = (node) => {
    const source = node.source.value;
    const specifiers = node.specifiers;
    if (specifiers.length === 0) {
      report(node, `side-effect import of ${source} is not admitted`);
      return;
    }
    for (const spec of specifiers) {
      if (spec.type !== "ImportSpecifier") {
        report(
          spec,
          `default or namespace import from ${source} is not admitted`,
        );
        continue;
      }
      const name = importedName(spec);
      if (name !== spec.local.name) {
        report(spec, `import ${name} from ${source} must keep its own name`);
        continue;
      }
      const type = isTypeImport(spec);
      let ok;
      if (source === "react")
        ok = type ? reactTypes.has(name) : reactValues.has(name);
      else if (generatedTypes.has(source)) ok = node.importKind === "type";
      else {
        const target = relativeUnit(source);
        const exported = rendererModules.get(target);
        ok =
          target !== unit &&
          exported !== undefined &&
          (exported.includes(name) ||
            (type && exported.includes(`type ${name}`)));
      }
      if (!ok) report(spec, `import ${name} from ${source} is not admitted`);
    }
  };

  const exportedNames = [];
  const checkExport = (node) => {
    if (node.type !== "ExportNamedDeclaration" || node.source) {
      report(node, "only local named exports are admitted in the renderer");
      return;
    }
    const declaration = node.declaration;
    if (declaration) {
      switch (declaration.type) {
        case "FunctionDeclaration":
          exportedNames.push([declaration, declaration.id.name]);
          break;
        case "TSTypeAliasDeclaration":
        case "TSInterfaceDeclaration":
          exportedNames.push([declaration, `type ${declaration.id.name}`]);
          break;
        default:
          report(declaration, `export of ${declaration.type} is not admitted`);
      }
    }
    for (const spec of node.specifiers) {
      const local = staticName(spec.local);
      if (local !== staticName(spec.exported)) {
        report(spec, `export ${local} must keep its own name`);
        continue;
      }
      const type = node.exportKind === "type" || spec.exportKind === "type";
      exportedNames.push([spec, type ? `type ${local}` : local]);
    }
  };

  const visit = (node, parent) => {
    switch (node.type) {
      case "JSXAttribute":
        if (node.name.name === "dangerouslySetInnerHTML")
          report(node, "dangerouslySetInnerHTML is not admitted");
        break;
      case "Property":
      case "PropertyDefinition":
      case "MethodDefinition": {
        const name = propertyName(node);
        if (name === "dangerouslySetInnerHTML")
          report(node, "dangerouslySetInnerHTML is not admitted");
        if (parent?.type === "ObjectPattern" && markupSinks.has(name))
          report(node, `${name} is not admitted`);
        if (renderer && node.computed)
          report(
            node,
            "a computed property key is not admitted in the renderer",
          );
        if (renderer && elementFactories.has(name))
          report(node, `${name} is not admitted in the renderer`);
        break;
      }
      case "MemberExpression": {
        const name = memberName(node);
        if (markupSinks.has(name)) report(node, `${name} is not admitted`);
        if (renderer && node.computed && node.property.type !== "Literal")
          report(
            node,
            "a computed member with a non-literal key is not admitted in the renderer",
          );
        if (renderer && elementFactories.has(name))
          report(node, `${name} is not admitted in the renderer`);
        break;
      }
      case "TSAsExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
        if (typed) report(node, `type assertion ${node.type} is not admitted`);
        break;
      case "TSAnyKeyword":
        if (typed) report(node, "any is not admitted");
        break;
      default:
        break;
    }
    if (renderer) {
      switch (node.type) {
        case "ImportDeclaration":
          checkImport(node);
          break;
        case "ExportNamedDeclaration":
        case "ExportDefaultDeclaration":
        case "ExportAllDeclaration":
        case "TSExportAssignment":
        case "TSNamespaceExportDeclaration":
          checkExport(node);
          break;
        case "TSImportType":
        case "TSImportEqualsDeclaration":
          report(node, "this import form is not admitted in the renderer");
          break;
        case "JSXSpreadAttribute":
        case "JSXSpreadChild":
          report(node, "JSX spread is not admitted in the renderer");
          break;
        case "AssignmentExpression":
        case "UpdateExpression":
          report(node, "an assignment is not admitted in the renderer");
          break;
        case "UnaryExpression":
          if (node.operator === "delete")
            report(node, "delete is not admitted in the renderer");
          break;
        case "ForInStatement":
        case "ForOfStatement":
          if (
            node.left.type !== "VariableDeclaration" ||
            node.left.kind !== "const"
          )
            report(node, "a loop must declare a fresh const in the renderer");
          break;
        case "JSXOpeningElement":
          if (
            node.name.type === "JSXIdentifier" &&
            /^[a-z]/u.test(node.name.name)
          )
            checkIntrinsic(node, node.name.name);
          else checkComponent(node);
          break;
        default:
          break;
      }
    }
    if (jsx) {
      switch (node.type) {
        case "CallExpression":
          checkCall(node);
          break;
        case "ClassDeclaration":
        case "ClassExpression":
        case "AwaitExpression":
        case "YieldExpression":
        case "NewExpression":
        case "TaggedTemplateExpression":
          report(node, `${node.type} is not admitted in a JSX renderer module`);
          break;
        case "Property":
          if (node.kind !== "init" || node.method)
            report(
              node,
              "an accessor or method is not admitted in a JSX renderer module",
            );
          break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
          if (node.async || node.generator)
            report(
              node,
              "an async or generator function is not admitted in a JSX renderer module",
            );
          break;
        default:
          break;
      }
    }
    for (const child of children(node)) visit(child, node);
  };

  if (kind === "lookalike")
    report(
      program,
      `src/${unit} differs from a renderer path only in letter case`,
    );
  if (kind === "unlisted")
    report(program, `src/${unit} is not in the renderer module list`);
  if (renderer && !unit.endsWith(".tsx"))
    for (const name of helperPinFindings(unit, text, hasBOM))
      report(program, name);
  if (!Array.isArray(program.comments))
    report(program, "the comment list is missing");
  for (const comment of program.comments ?? []) {
    for (const directive of tsDirectives) {
      if (comment.value.toLowerCase().includes(directive))
        report(comment, `${directive} is not admitted in src`);
    }
  }
  visit(program, null);

  if (renderer) {
    const expected = rendererModules.get(unit);
    const names = exportedNames.map(([, name]) => name);
    for (const [node, name] of exportedNames) {
      if (
        !expected.includes(name) ||
        names.indexOf(name) !== names.lastIndexOf(name)
      )
        report(node, `export ${name} is not in the module's frozen list`);
    }
    for (const name of expected) {
      if (!names.includes(name))
        report(program, `export ${name} is missing from the module`);
    }
  }
  if (unit === hrefModule) {
    if (hrefCount !== 1)
      report(program, `${hrefModule} must write exactly one href`);
    for (const scope of scopeManager.scopes) {
      for (const variable of scope.variables) {
        if (!["internalHref", "link", "slugs"].includes(variable.name))
          continue;
        const declared = scopeManager.scopes
          .flatMap((s) => s.variables)
          .filter((v) => v.name === variable.name);
        if (declared.length !== 1 || variable.defs.length !== 1)
          report(
            variable.defs[0]?.name ?? program,
            `${variable.name} is declared more than once`,
          );
        if (variable.references.some((r) => r.isWrite() && !r.init))
          report(
            variable.defs[0]?.name ?? program,
            `${variable.name} is written`,
          );
      }
    }
  }
  return found;
}
