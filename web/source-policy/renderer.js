// Source rules for the content renderer: its frozen module list, import graph, exports, and the
// elements, attributes and attribute value sources it may write, plus the markup sinks banned
// in all of src. They bound the tracked source only, never the data it renders, and fail
// closed: an element, attribute, expression form or import they do not recognise is a finding.
import { createHash } from "node:crypto";

// Each renderer module, keyed by its path under src, with exactly the bindings it exports.
export const rendererModules = new Map([
  ["content/assertNever.ts", ["assertNever"]],
  [
    "content/href.ts",
    ["internalHref", "termHref", "buildSlugMap", "type SlugMap"],
  ],
  ["content/ContentLink.tsx", ["ContentLink"]],
  ["content/Spans.tsx", ["Spans", "LinkContent"]],
  ["content/Blocks.tsx", ["Blocks"]],
  ["content/Entries.tsx", ["GlossaryEntryView", "ErrorEntryView"]],
  ["content/Cards.tsx", ["CardsSectionView"]],
  ["content/Drill.tsx", ["DrillSectionView"]],
  [
    "content/approach.ts",
    [
      "projectBuild",
      "checkedBuildView",
      "staticDoc",
      "type ApproachOption",
      "type SelectedApproach",
      "type ChoiceSection",
      "type BuildViewSection",
      "type BuildView",
      "type ApproachSelection",
      "type ApproachChange",
      "type StaticDoc",
      "type StaticPart",
    ],
  ],
  [
    "content/hints.ts",
    [
      "selectHints",
      "checkedHintsView",
      "type HintOption",
      "type SelectedCue",
      "type HintsView",
      "type HintChange",
    ],
  ],
  ["content/ApproachPicker.tsx", ["ApproachPicker", "HintPicker"]],
  ["content/Term.tsx", ["Term"]],
  ["content/Build.tsx", ["BuildPartView"]],
  ["content/Hints.tsx", ["HintsPartView"]],
  ["content/ContentView.tsx", ["ContentView"]],
]);

// The reviewed helpers the JSX modules trust, each pinned to the SHA-256 of its exact text.
export const helperPins = new Map([
  [
    "content/approach.ts",
    "a4e3ccae7fa087dd9d0d38ea23e9cb88d4fee72e9fb6e814bcbf7685b7efa441",
  ],
  [
    "content/assertNever.ts",
    "c0ec0b0d9ed46a593853aea55684d37376b81ecb821a66b685d41a958a8e5c23",
  ],
  [
    "content/hints.ts",
    "50fc2db30b8fa7f7dffe27806f3f084bfff2a5ba9ab6c1468550252e41ea0a89",
  ],
  [
    "content/href.ts",
    "4592231be603d2db39cdb0e283e688613ee0d9c3ba6c368cffa9765d64b48d88",
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
  "content-tests/approach.test.tsx",
  "content-tests/hints-view.ts",
  "content-tests/hints.test.tsx",
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

// Every intrinsic may carry key; these are the only other attributes per element. The data
// attributes are the hooks a spoken segment's target resolves to.
const blockHook = "data-block-id";
const sectionHook = "data-section-id";
const intrinsics = new Map([
  ["section", [sectionHook]],
  ["div", ["id", blockHook, "role", "aria-label"]],
  [
    "button",
    ["type", "aria-pressed", "onClick", "popoverTarget", "popoverTargetAction"],
  ],
  ["span", ["id", "popover"]],
  ["h2", ["id"]],
  ["h3", ["id"]],
  ["h4", ["id"]],
  ["dl", []],
  ["dt", []],
  ["dd", []],
  ["p", [blockHook]],
  ["ul", [blockHook]],
  ["ol", ["start", blockHook]],
  ["li", [blockHook]],
  ["table", [blockHook]],
  ["thead", []],
  ["tbody", []],
  ["tr", []],
  ["th", ["scope"]],
  ["td", []],
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
  "popover",
  "popovertarget",
  "popovertargetaction",
]);

const hrefModule = "content/ContentLink.tsx";
// The one module whose h2 carries an entry's own id.
const entryModule = "content/Entries.tsx";
// The one module that writes a card: its heading level and its description list live nowhere else.
const cardsModule = "content/Cards.tsx";
const cardElements = new Set(["dl", "dt", "dd"]);
// The one module that shows a build part, and the one that writes its approach heading.
const buildModule = "content/Build.tsx";
// The picker module: its one private list writes every pressed button and the single handler, and
// each exported wrapper names its own group.
const pickerModule = "content/ApproachPicker.tsx";
const pickerButton = ["type", "aria-pressed", "onClick"];
const changeProp = "onApproachChange";
const chooseProp = "onChoose";
const groupLabels = new Map([
  ["ApproachPicker", "Build approaches"],
  ["HintPicker", "Hint approaches"],
]);
// The one module that shows hints, and the handler it hands down unchanged.
const hintsModule = "content/Hints.tsx";
const hintProp = "onHintChange";
// Types that can hold what a hints view hides; only the reviewed helper that excludes them names them.
const approachModule = "content/approach.ts";
const wholeRecordTypes = new Set([
  "ContentDoc",
  "PartFile",
  "HintsPart",
  "Ladder",
  "Rung",
]);
// The one module that writes a native popover: a button and its definition, and no handler.
const termModule = "content/Term.tsx";
const termButton = ["type", "popoverTarget", "popoverTargetAction"];
const badCall = "this call is not admitted in a JSX renderer module";
// React reads a capitalised JSX name as a component and a lower-case one as an element.
const isComponentName = (name) => /^[A-Z]/u.test(name);
const plainTypes = new Set([
  "TSStringKeyword",
  "TSNumberKeyword",
  "TSBooleanKeyword",
  "TSNullKeyword",
  "TSUndefinedKeyword",
  "TSLiteralType",
]);
// A declared type of plain values alone, so no alias or wrapper can hide an element in it.
const isPlainType = (type) =>
  type.type === "TSUnionType"
    ? type.types.every(isPlainType)
    : plainTypes.has(type.type);

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

  // One plain member of the element parameter of an admitted inline map callback.
  const isMapElementMember = (expression, field) => {
    if (
      expression?.type !== "MemberExpression" ||
      expression.computed ||
      expression.optional ||
      expression.property.name !== field ||
      expression.object.type !== "Identifier"
    )
      return false;
    const def = onlyDef(variableOf(expression.object));
    if (def?.type !== "Parameter") return false;
    const callback = def.node;
    return (
      callback.type === "ArrowFunctionExpression" &&
      callback.params[0] === def.name &&
      isMapCall(callback.parent) &&
      callback.parent.arguments[0] === callback
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

  // Why a reviewed callee may not be called, or null: a call would hand a component props its
  // tag's rules never saw, and a local helper that may return elements is a component.
  const componentProblem = (callee) => {
    if (isComponentName(callee.name))
      return "a component renders only through its tag";
    const def = onlyDef(variableOf(callee));
    if (def?.type !== "FunctionName") return null;
    const returned = def.node.returnType?.typeAnnotation;
    return returned !== undefined && isPlainType(returned)
      ? null
      : "a called helper must declare a return type of plain values";
  };

  const checkCall = (call) => {
    const problem = isRendererBinding(call.callee)
      ? componentProblem(call.callee)
      : null;
    if (
      call.optional ||
      call.typeArguments ||
      call.arguments.some((a) => a.type === "SpreadElement")
    )
      report(call, "an optional, generic or spread call is not admitted");
    else if (problem !== null) report(call, `${badCall}: ${problem}`);
    else if (
      !isRendererBinding(call.callee) &&
      !isReactUseId(call.callee) &&
      !isMapCall(call) &&
      !changeCalls.has(call)
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

  // A plain call, with this many arguments, of the named function imported from href.ts.
  const isHrefHelperCall = (expression, name, count) => {
    if (
      expression?.type !== "CallExpression" ||
      expression.optional ||
      expression.typeArguments ||
      expression.arguments.length !== count
    )
      return false;
    const { callee } = expression;
    if (callee.type !== "Identifier" || callee.name !== name) return false;
    const def = onlyDef(variableOf(callee));
    return (
      def?.type === "ImportBinding" &&
      def.node.type === "ImportSpecifier" &&
      importedName(def.node) === name &&
      !isTypeImport(def.node) &&
      def.parent.source.value === "./href.ts"
    );
  };

  const isExported = (name) => (fn) =>
    fn.id?.name === name && fn.parent.type === "ExportNamedDeclaration";

  const isHrefCall = (expression) => {
    if (!isHrefHelperCall(expression, "internalHref", 2)) return false;
    const [first, second] = expression.arguments;
    return (
      isPropParameter(first, "link", isExported("ContentLink")) &&
      isPropParameter(second, "slugs", isExported("ContentLink"))
    );
  };

  const isTermHrefCall = (expression) =>
    isHrefHelperCall(expression, "termHref", 1) &&
    isPropParameter(expression.arguments[0], "term", isExported("Term"));

  const attributeOf = (opening, name) =>
    opening.attributes.find(
      (a) =>
        a.type === "JSXAttribute" &&
        a.name.type === "JSXIdentifier" &&
        a.name.name === name,
    );

  const elementSiblings = (element) => {
    const parent = element.parent;
    return parent.type === "JSXElement" || parent.type === "JSXFragment"
      ? parent.children.filter((c) => c.type === "JSXElement")
      : [];
  };

  const isTag = (element, tag) =>
    element.openingElement.name.type === "JSXIdentifier" &&
    element.openingElement.name.name === tag;

  // A Term's button and its definition sit side by side and name one useId binding, so a button
  // can only ever open its own definition.
  const isTermPair = (button, definition) => {
    const target = attributeOf(button.openingElement, "popoverTarget");
    const id = attributeOf(definition.openingElement, "id");
    const mode = attributeOf(definition.openingElement, "popover");
    const variable = target ? useIdVariable(expressionOf(target)) : null;
    return (
      isTag(button, "button") &&
      isTag(definition, "span") &&
      variable !== null &&
      id !== undefined &&
      mode !== undefined &&
      useIdVariable(expressionOf(id)) === variable &&
      literalValue(mode) === "auto"
    );
  };

  const pairedAfter = (element) => {
    const siblings = elementSiblings(element);
    const at = siblings.indexOf(element);
    return at >= 0 && at + 1 < siblings.length
      ? isTermPair(element, siblings[at + 1])
      : false;
  };

  const pairedBefore = (element) => {
    const siblings = elementSiblings(element);
    const at = siblings.indexOf(element);
    return at > 0 ? isTermPair(siblings[at - 1], element) : false;
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

  const literalValue = (attribute) =>
    attribute.value?.type === "Literal" ? attribute.value.value : null;

  // The private list of the picker module: a top-level function that is never exported.
  const isChoices = (fn) =>
    unit === pickerModule &&
    fn.id?.name === "Choices" &&
    fn.parent.type === "Program";

  const isWrapper = (name) => (fn) =>
    unit === pickerModule && isExported(name)(fn);

  const plainCall = (call, count) =>
    call?.type === "CallExpression" &&
    !call.optional &&
    !call.typeArguments &&
    call.arguments.length === count;

  // The one call a button's handler makes: the list's chooser with this option's id.
  const isChooseCall = (call) =>
    plainCall(call, 1) &&
    isPropParameter(call.callee, chooseProp, isChoices) &&
    isMapElementMember(call.arguments[0], "id");

  // An inline arrow with these parameters whose body is one call statement, or null.
  const soleCallOf = (expression, params) =>
    expression?.type === "ArrowFunctionExpression" &&
    !expression.async &&
    expression.params.length === params &&
    expression.params.every((p) => p.type === "Identifier") &&
    expression.body.type === "BlockStatement" &&
    expression.body.body.length === 1 &&
    expression.body.body[0].type === "ExpressionStatement"
      ? expression.body.body[0].expression
      : null;

  // A handler is an inline arrow that takes nothing and does nothing but that one call.
  const changeCallOf = (expression) => {
    const call = soleCallOf(expression, 0);
    return isChooseCall(call) ? call : null;
  };

  // The build wrapper's chooser: the caller's own function with this section and the chosen id.
  const approachCallOf = (expression) => {
    const call = soleCallOf(expression, 1);
    if (!plainCall(call, 2)) return null;
    const [first, second] = call.arguments;
    const def =
      second.type === "Identifier" ? onlyDef(variableOf(second)) : null;
    return isPropParameter(
      call.callee,
      changeProp,
      isWrapper("ApproachPicker"),
    ) &&
      isPropParameter(first, "sectionId", isWrapper("ApproachPicker")) &&
      def?.type === "Parameter" &&
      def.node === expression &&
      def.name === expression.params[0]
      ? call
      : null;
  };

  // What a wrapper hands the list as its chooser: the build call above, or the hint handler as is.
  const chooserCallOf = (expression) =>
    approachCallOf(expression) ??
    (isPropParameter(expression, hintProp, isWrapper("HintPicker"))
      ? expression
      : null);

  const isChoicesTag = (opening) =>
    opening.name.type === "JSXIdentifier" &&
    onlyDef(variableOf(opening.name))?.type === "FunctionName" &&
    isChoices(onlyDef(variableOf(opening.name)).node);

  const isPressed = (expression) =>
    expression?.type === "BinaryExpression" &&
    expression.operator === "===" &&
    isMapElementMember(expression.left, "id") &&
    isPropParameter(expression.right, "pressed", isChoices);

  const enclosingFunction = (node) => {
    let at = node;
    while (at !== null && at !== undefined && !isTopLevelFunction(at))
      at = at.parent;
    return at ?? null;
  };

  // Each wrapper's group carries its own fixed label and no other.
  const isGroupLabel = (opening, attribute) => {
    const fn = enclosingFunction(opening);
    return (
      unit === pickerModule &&
      fn !== null &&
      fn.parent.type === "ExportNamedDeclaration" &&
      groupLabels.get(fn.id?.name) === literalValue(attribute)
    );
  };

  const changeCalls = new Set();
  let handlerCount = 0;
  let hrefCount = 0;
  let popoverCount = 0;

  const checkIntrinsic = (opening, tag) => {
    const allowed = intrinsics.get(tag);
    if (
      allowed === undefined ||
      (cardElements.has(tag) && unit !== cardsModule) ||
      (tag === "h4" && unit !== cardsModule && unit !== buildModule) ||
      (tag === "button" && unit !== pickerModule && unit !== termModule)
    ) {
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
      if (name === blockHook)
        ok =
          tag === "li"
            ? isMapElementMember(expression, "blockId")
            : isParamMember(expression, "block", "blockId");
      else if (name === sectionHook)
        ok = isParamMember(expression, "section", "id");
      else if (name === "role")
        ok = unit === pickerModule && literalValue(attribute) === "group";
      else if (name === "aria-label") ok = isGroupLabel(opening, attribute);
      else if (name === "type") ok = literalValue(attribute) === "button";
      else if (name === "popoverTarget")
        ok = unit === termModule && pairedAfter(opening.parent);
      else if (name === "popoverTargetAction")
        ok = unit === termModule && literalValue(attribute) === "toggle";
      else if (name === "popover") {
        popoverCount++;
        ok = unit === termModule && pairedBefore(opening.parent);
      } else if (name === "aria-pressed") ok = isPressed(expression);
      else if (name === "scope") ok = literalValue(attribute) === "col";
      else if (name === "onClick") {
        handlerCount++;
        const call = changeCallOf(expression);
        if (call !== null) changeCalls.add(call);
        ok = call !== null;
      } else if (tag === "div") ok = isParamMember(expression, "block", "id");
      else if (tag === "h2" && unit === entryModule)
        ok = isParamMember(expression, "entry", "id");
      else if (tag === "h4")
        ok =
          unit === buildModule
            ? isParamMember(expression, "approach", "id")
            : isParamMember(expression, "card", "id");
      else if (tag === "h2" || tag === "h3")
        ok = isParamMember(expression, "section", "id");
      else if (tag === "ol") ok = isParamMember(expression, "block", "start");
      else if (tag === "span") ok = useIdVariable(expression) !== null;
      else if (tag === "pre") {
        const variable = useIdVariable(expression);
        ok = variable !== null && hasLabelSibling(opening.parent, variable);
      } else {
        hrefCount++;
        ok =
          (unit === hrefModule && isHrefCall(expression)) ||
          (unit === termModule && isTermHrefCall(expression));
      }
      if (!ok)
        report(
          attribute,
          `${name} on <${tag}> is not from its admitted source`,
        );
    }
    // A button with no type submits a form; a picker button needs its state and handler, and a
    // Term button its own definition.
    if (tag === "button")
      for (const name of unit === termModule ? termButton : pickerButton)
        if (!seen.has(name))
          report(opening.name, `<button> must carry ${name}`);
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
      // The caller's handler is handed down unchanged, and only by the build view; likewise the
      // hint handler, only by the hints view.
      if (
        (attribute.name.name === changeProp &&
          unit === buildModule &&
          isPropParameter(expressionOf(attribute), changeProp)) ||
        (attribute.name.name === hintProp &&
          unit === hintsModule &&
          isPropParameter(expressionOf(attribute), hintProp))
      )
        continue;
      // A wrapper hands its list one chooser, and no other component takes one.
      if (attribute.name.name === chooseProp && isChoicesTag(opening)) {
        const call = chooserCallOf(expressionOf(attribute));
        if (call?.type === "CallExpression") changeCalls.add(call);
        if (call !== null) continue;
      }
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
      else if (generatedTypes.has(source))
        ok =
          node.importKind === "type" &&
          (unit === approachModule || !wholeRecordTypes.has(name));
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
  if (unit === pickerModule && handlerCount !== 1)
    report(program, `${pickerModule} must write exactly one handler`);
  // Each href module names its binding sources once and never writes them, so a lookalike cannot
  // stand in for one.
  const bound =
    unit === hrefModule
      ? ["internalHref", "link", "slugs"]
      : unit === termModule
        ? ["termHref", "term", "definition", "useId"]
        : null;
  if (unit === termModule && popoverCount !== 1)
    report(program, `${termModule} must write exactly one definition`);
  if (bound !== null) {
    if (hrefCount !== 1) report(program, `${unit} must write exactly one href`);
    for (const scope of scopeManager.scopes) {
      for (const variable of scope.variables) {
        if (!bound.includes(variable.name)) continue;
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
