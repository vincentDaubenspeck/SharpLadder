// Source rules for the content renderer: its frozen module list, import graph, exports, and the
// elements, attributes and attribute value sources it may write, plus the markup sinks banned
// in all of src. They bound the tracked source only, never the data it renders. An element,
// attribute or import they do not recognise is a finding; other expressions are checked only in
// the forms a rule names. They are local checks, not a proof of what a module renders.
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
  [
    "content/Blocks.tsx",
    ["Blocks", "type WalkShown", "type WalkControlChange", "type WalkControl"],
  ],
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
  [
    "content/walk-position.ts",
    [
      "isValidPosition",
      "move",
      "type WalkPosition",
      "type WalkShape",
      "type WalkRequest",
    ],
  ],
  [
    "content/walk-replay.ts",
    ["replay", "type WalkCell", "type WalkStepInput", "type ReplayState"],
  ],
  [
    "content/ApproachPicker.tsx",
    ["ApproachPicker", "HintPicker", "SequencePicker"],
  ],
  ["content/WalkStepper.tsx", ["WalkStepper", "type WalkChange"]],
  ["content/span-text.ts", ["spanText"]],
  ["content/Term.tsx", ["Term"]],
  ["content/Build.tsx", ["BuildPartView"]],
  ["content/Hints.tsx", ["HintsPartView"]],
  ["content/ContentView.tsx", ["ContentView"]],
]);

// Exports no renderer module may import, by module under src: a renderer shows the view it is
// handed and never selects one itself.
const rendererWithheld = new Map([["content/hints.ts", ["selectHints"]]]);

// The reviewed helpers the JSX modules trust, each pinned to the SHA-256 of its exact text.
export const helperPins = new Map([
  [
    "content/approach.ts",
    "e5df359a458100a251e87a5819a464ed91e85a55a26cccaabfe9a6ff87b1ac54",
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
  [
    "content/span-text.ts",
    "67b6fa798999d879e7cd602d3ee39d7045e02961c62602df319c3a1f6c3af058",
  ],
  [
    "content/walk-position.ts",
    "650d058f1adef40f9ba2121f7b5667a945cea3c28b90b1ac5e2ea34dcbc2396d",
  ],
  [
    "content/walk-replay.ts",
    "4ceadd49961a93e8e7642a5bf0849d0272b232cf5266ef31d293d14966e27338",
  ],
]);

// The reviewed JSX modules pinned whole, as their local checks cannot bind what they render; a
// pin update needs a review of the whole module, its dependencies and its behaviour tests.
export const modulePins = new Map([
  [
    "content/WalkStepper.tsx",
    "c83f19619b3379548a50d92f8588c6f39adae7f48f622547cd3b3d903fbc248e",
  ],
]);

// Each module owed a pin check, by its exact place under src. The stepper is named here as well
// as in its pin, so a misspelt pin key leaves it owed a check it fails, never silently unpinned.
export const pinnedUnits = new Set([
  ...[...rendererModules.keys()].filter((unit) => !unit.endsWith(".tsx")),
  "content/WalkStepper.tsx",
  ...helperPins.keys(),
  ...modulePins.keys(),
]);

// A checkout may use CRLF, so only that is undone; a byte order mark is refused, never hashed.
export const helperDigest = (text) =>
  createHash("sha256")
    .update(text.replaceAll("\r\n", "\n"), "utf8")
    .digest("hex");

// The one pin policy for both entry points. ESLint strips one byte order mark from the text and
// reports it in hasBOM while the build reads the raw file, so either signal is the same finding.
function pinFindings(unit, text, hasBOM = false) {
  const what = unit.endsWith(".tsx") ? "module" : "helper";
  const review =
    what === "module"
      ? "the whole module, its dependencies and its behaviour tests"
      : "the whole helper";
  const pin = helperPins.get(unit) ?? modulePins.get(unit);
  if (pin === undefined)
    return [`src/${unit} is a ${what} with no reviewed pin`];
  if (typeof text !== "string")
    return [`src/${unit} has no source text to check against its pin`];
  if (hasBOM === true || text.startsWith("\uFEFF"))
    return [
      `src/${unit}: a reviewed ${what} must not start with a byte order mark`,
    ];
  if (helperDigest(text) !== pin)
    return [
      `src/${unit}: the reviewed ${what} source changed; update its pin only after a review of ${review}`,
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
  "content-tests/walk-controller.tsx",
  "content-tests/walk-position.test.ts",
  "content-tests/walk-replay.test.ts",
  "content-tests/walk-stepper.test.tsx",
]);

// The walk helpers by basename: only a listed test may take their values, and no module but a
// listed test may run a listed test module, so a test cannot hand a helper value on. Folding and
// cutting a source only ever refuse, so another folder, letter case, a missing or other
// extension, a query, a hash or percent-encoding still names the module.
const walkHelpers = new Set(["walk-replay", "walk-position"]);
const fold = (text) => text.toUpperCase().toLowerCase();
const withoutExtension = (name) =>
  name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
const testNames = new Set(
  [...rendererTests].flatMap((unit) => {
    const name = fold(unit.slice(unit.lastIndexOf("/") + 1));
    return [name, withoutExtension(name)];
  }),
);
const decoded = (source) => {
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
};
// The last named segment of a source, raw and decoded, each whole and cut at its first ? or #.
const lastNames = (source) =>
  [source, decoded(source)]
    .flatMap((text) => [text, text.split(/[?#]/u)[0]])
    .map((text) =>
      fold(
        text
          .split(/[\\/]/u)
          .filter((segment) => segment !== "" && segment !== ".")
          .at(-1) ?? "",
      ),
    );
const namesWalkHelper = (source) =>
  lastNames(source).some((name) => walkHelpers.has(name.split(/[.?#]/u)[0]));
const namesListedTest = (source) =>
  lastNames(source).some(
    (name) => testNames.has(name) || testNames.has(withoutExtension(name)),
  );

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

// Every intrinsic may carry key; these are the only other attributes per element. The block and
// section attributes are the hooks a spoken segment's target resolves to; the cell attribute is
// for the theme alone, beside the words that already tell a walk cell's states.
const blockHook = "data-block-id";
const sectionHook = "data-section-id";
const cellStates = "data-cell";
const intrinsics = new Map([
  ["section", [sectionHook]],
  ["div", ["id", blockHook, "role", "aria-label"]],
  [
    "button",
    [
      "type",
      "aria-pressed",
      "aria-disabled",
      "onClick",
      "popoverTarget",
      "popoverTargetAction",
    ],
  ],
  ["span", ["id", "popover"]],
  ["h2", ["id"]],
  ["h3", ["id"]],
  ["h4", ["id"]],
  ["dl", []],
  ["dt", []],
  ["dd", []],
  ["p", [blockHook, "aria-live", "aria-atomic"]],
  ["ul", [blockHook]],
  ["ol", ["start", blockHook]],
  ["li", [blockHook, cellStates]],
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
  ["s", []],
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
  ["SequencePicker", "Walk sequences"],
]);
// The one module that shows hints, and the handler it hands down unchanged.
const hintsModule = "content/Hints.tsx";
const hintProp = "onHintChange";
// The walk stepper: its buttons and its switch only report a move the position helper made, and
// its markup is the cell list, the one strike and the one live region.
const stepperModule = "content/WalkStepper.tsx";
const stepperButton = ["type", "aria-disabled", "onClick"];
const positionProp = "onPositionChange";
const sequenceProp = "onSequenceChange";
const stepperElements = new Set(["div", "p", "ol", "li", "s", "button"]);
const stepperLabels = new Map([
  ["Prev", "prev"],
  ["Next", "next"],
]);
// The helper values the stepper alone may take, each by name from this exact source.
const stepperHelperValues = new Map([
  ["./walk-position.ts", ["isValidPosition", "move"]],
  ["./walk-replay.ts", ["replay"]],
]);
// The one module that freezes a walk when no controller is given, and the part that writes it.
const blocksModule = "content/Blocks.tsx";
const frozenWalk = "FrozenWalk";
// The walk control a page hands down, the hosts that pass it on, and the part of Blocks.tsx that
// shows a walk under it: the stepper alone, so the stepper's hooks are the walk's only ones.
const controlProp = "walkControl";
const controlHosts = new Set([
  blocksModule,
  "content/Build.tsx",
  "content/Cards.tsx",
  "content/ContentView.tsx",
  "content/Drill.tsx",
  "content/Entries.tsx",
]);
const controlledWalk = "ControlledWalk";
const controlledProps = [
  "block",
  "position",
  "onPositionChange",
  "announce",
  "slugs",
];
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
    (isPropParameter(expression, hintProp, isWrapper("HintPicker")) ||
    isPropParameter(expression, sequenceProp, isWrapper("SequencePicker"))
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

  // A value imported by its own name from this exact source.
  const isImportOf = (identifier, name, source) => {
    if (
      (identifier?.type !== "Identifier" &&
        identifier?.type !== "JSXIdentifier") ||
      identifier.name !== name
    )
      return false;
    const def = onlyDef(variableOf(identifier));
    return (
      def?.type === "ImportBinding" &&
      def.node.type === "ImportSpecifier" &&
      importedName(def.node) === name &&
      !isTypeImport(def.node) &&
      def.parent.source.value === source
    );
  };

  const isStepperProp = (identifier, name) =>
    unit === stepperModule &&
    isPropParameter(identifier, name, isExported("WalkStepper"));

  const isLiteralProperty = (property, key) =>
    property?.type === "Property" &&
    property.kind === "init" &&
    !property.computed &&
    !property.method &&
    staticName(property.key) === key;

  // The request of a plain move call on the stepper's own walk and position, or null.
  const moveRequestOf = (call) =>
    plainCall(call, 3) &&
    isImportOf(call.callee, "move", "./walk-position.ts") &&
    isParamMember(call.arguments[0], "block", "sequences") &&
    isStepperProp(call.arguments[0].object, "block") &&
    isStepperProp(call.arguments[1], "position") &&
    call.arguments[2].type === "ObjectExpression"
      ? call.arguments[2]
      : null;

  const causeOf = (request) => {
    const cause = request?.properties[0];
    return isLiteralProperty(cause, "cause") && cause.value.type === "Literal"
      ? cause.value.value
      : null;
  };

  // A const of the stepper's own body bound to a move with this one literal cause, or null.
  const movedConst = (identifier, cause) => {
    if (identifier?.type !== "Identifier" || cause === null) return null;
    const variable = variableOf(identifier);
    const def = onlyDef(variable);
    if (
      def?.type !== "Variable" ||
      def.parent.kind !== "const" ||
      def.node.id !== def.name
    )
      return null;
    const fn = enclosingFunction(def.node);
    const request = moveRequestOf(def.node.init);
    return fn !== null &&
      isExported("WalkStepper")(fn) &&
      def.parent.parent === fn.body &&
      request?.properties.length === 1 &&
      causeOf(request) === cause
      ? variable
      : null;
  };

  const isKindOf = (expression, operator, variable) =>
    variable !== null &&
    expression?.type === "BinaryExpression" &&
    expression.operator === operator &&
    expression.left.type === "MemberExpression" &&
    !expression.left.computed &&
    !expression.left.optional &&
    expression.left.property.name === "kind" &&
    expression.left.object.type === "Identifier" &&
    variableOf(expression.left.object) === variable &&
    expression.right.type === "Literal" &&
    expression.right.value === "moved";

  // `if (X.kind === "moved") onPositionChange(X);` for this variable: the call, or null.
  const guardedReportOf = (statement, variable) => {
    if (
      statement?.type !== "IfStatement" ||
      statement.alternate !== null ||
      !isKindOf(statement.test, "===", variable)
    )
      return null;
    const { consequent } = statement;
    const inner =
      consequent.type === "BlockStatement" && consequent.body.length === 1
        ? consequent.body[0]
        : consequent;
    const call = inner.type === "ExpressionStatement" ? inner.expression : null;
    return plainCall(call, 1) &&
      isStepperProp(call.callee, positionProp) &&
      call.arguments[0].type === "Identifier" &&
      variableOf(call.arguments[0]) === variable
      ? call
      : null;
  };

  const arrowBodyOf = (expression, params) =>
    expression?.type === "ArrowFunctionExpression" &&
    !expression.async &&
    expression.params.length === params &&
    expression.params.every((p) => p.type === "Identifier") &&
    expression.body.type === "BlockStatement"
      ? expression.body.body
      : null;

  // A stepper button's literal text, as the cause it stands for, or null.
  const buttonCause = (opening) => {
    const kids = opening.parent.children;
    return kids.length === 1 && kids[0].type === "JSXText"
      ? (stepperLabels.get(kids[0].value.trim()) ?? null)
      : null;
  };

  const isBound = (expression, cause) =>
    isKindOf(expression, "!==", movedConst(expression?.left?.object, cause));

  const clickReportOf = (expression, cause) => {
    const body = arrowBodyOf(expression, 0);
    const statement = body?.length === 1 ? body[0] : null;
    return guardedReportOf(
      statement,
      movedConst(statement?.test?.left?.object, cause),
    );
  };

  const isSequencePickerTag = (opening) =>
    isImportOf(opening.name, "SequencePicker", "./ApproachPicker.tsx");

  // The switch moves to the chosen sequence's Start and reports it only when it moved.
  const sequenceReportOf = (expression) => {
    const body = arrowBodyOf(expression, 1);
    if (body?.length !== 2) return null;
    const [declaration, guard] = body;
    const declarator =
      declaration.type === "VariableDeclaration" &&
      declaration.kind === "const" &&
      declaration.declarations.length === 1
        ? declaration.declarations[0]
        : null;
    const request = moveRequestOf(declarator?.init);
    const chosen = request?.properties[1];
    const variable = variableOf(guard.test?.left?.object ?? null);
    return declarator !== null &&
      onlyDef(variable)?.node === declarator &&
      request.properties.length === 2 &&
      causeOf(request) === "sequence" &&
      isLiteralProperty(chosen, "sequence") &&
      chosen.value.type === "Identifier" &&
      onlyDef(variableOf(chosen.value))?.name === expression.params[0]
      ? guardedReportOf(guard, variable)
      : null;
  };

  const isNull = (expression) =>
    expression?.type === "Literal" && expression.value === null;

  const isStepperSequences = (expression) =>
    isParamMember(expression, "block", "sequences") &&
    isStepperProp(expression.object, "block");

  const isPositionField = (expression, field) =>
    isParamMember(expression, "position", field) &&
    isStepperProp(expression.object, "position");

  const isParamOf = (expression, param) =>
    expression?.type === "Identifier" &&
    onlyDef(variableOf(expression))?.name === param;

  const isIndexPlusOne = (expression, index) =>
    expression?.type === "BinaryExpression" &&
    expression.operator === "+" &&
    isParamOf(expression.left, index) &&
    expression.right.type === "Literal" &&
    expression.right.value === 1;

  // The stepper's one validity const, from the pinned helper on its own walk and position.
  const isValidConst = (expression) => {
    if (expression?.type !== "Identifier") return false;
    const def = onlyDef(variableOf(expression));
    if (
      def?.type !== "Variable" ||
      def.parent.kind !== "const" ||
      def.node.id !== def.name
    )
      return false;
    const fn = enclosingFunction(def.node);
    const call = def.node.init;
    return (
      fn !== null &&
      isExported("WalkStepper")(fn) &&
      def.parent.parent === fn.body &&
      plainCall(call, 2) &&
      isImportOf(call.callee, "isValidPosition", "./walk-position.ts") &&
      isStepperSequences(call.arguments[0]) &&
      isStepperProp(call.arguments[1], "position")
    );
  };

  // `(sequence, index) => ...` as the one argument of a map over the stepper's own sequences.
  const sequenceMapOf = (callback) =>
    callback?.type === "ArrowFunctionExpression" &&
    callback.params.length === 2 &&
    callback.params.every((p) => p.type === "Identifier") &&
    isMapCall(callback.parent) &&
    callback.parent.arguments[0] === callback &&
    isStepperSequences(callback.parent.callee.object)
      ? callback
      : null;

  // What such a map shows for the position's own sequence and for no other, as its callback.
  const selectedCallbackOf = (element) => {
    const choice = element.parent;
    const callback = sequenceMapOf(choice?.parent);
    return choice?.type === "ConditionalExpression" &&
      choice.consequent === element &&
      isNull(choice.alternate) &&
      callback?.body === choice &&
      choice.test.type === "BinaryExpression" &&
      choice.test.operator === "===" &&
      isIndexPlusOne(choice.test.left, callback.params[1]) &&
      isPositionField(choice.test.right, "sequence")
      ? callback
      : null;
  };

  const isShownWhenValid = (node) =>
    node?.parent?.type === "ConditionalExpression" &&
    node.parent.consequent === node &&
    isNull(node.parent.alternate) &&
    isValidConst(node.parent.test);

  // The only expression written in the live region, read when the caller asks at a valid position.
  const isAnnouncedWhen = (choice, map) =>
    choice?.type === "ConditionalExpression" &&
    choice.consequent === map &&
    isNull(choice.alternate) &&
    choice.test.type === "LogicalExpression" &&
    choice.test.operator === "&&" &&
    isValidConst(choice.test.left) &&
    isStepperProp(choice.test.right, "announce");

  const isStepperPart = (name) => (fn) =>
    unit === stepperModule &&
    fn?.type === "FunctionDeclaration" &&
    fn.id?.name === name &&
    fn.parent.type === "Program";

  const partOf = (opening) => {
    if (opening.name.type !== "JSXIdentifier") return null;
    const def = onlyDef(variableOf(opening.name));
    return def?.type === "FunctionName" &&
      (isStepperPart("ActiveSequence")(def.node) ||
        isStepperPart("Announcement")(def.node))
      ? def.node.id.name
      : null;
  };

  const partProps = new Map([
    ["ActiveSequence", ["key", "block", "sequence", "step", "slugs"]],
    ["Announcement", ["key", "sequence", "step"]],
  ]);

  // A selected part takes the selected sequence, the position's step and the stepper's own props.
  const isPartProp = (name, expression, sequence) => {
    switch (name) {
      case "key":
        return (
          expression?.type === "MemberExpression" &&
          !expression.computed &&
          !expression.optional &&
          expression.property.name === "introBlockId" &&
          isParamOf(expression.object, sequence)
        );
      case "sequence":
        return isParamOf(expression, sequence);
      case "step":
        return isPositionField(expression, "step");
      default:
        return isStepperProp(expression, name);
    }
  };

  const isLiveRegion = (node) =>
    node?.type === "JSXElement" &&
    node.openingElement.attributes.some(
      (a) => a.type === "JSXAttribute" && a.name.name === "aria-live",
    );

  // The active sequence is written among what a valid position shows; the announcement is the
  // only expression written in the live region.
  const isPartPlaced = (part, map) =>
    part === "ActiveSequence"
      ? map.parent.type === "JSXExpressionContainer" &&
        isShownWhenValid(map.parent.parent)
      : isAnnouncedWhen(map.parent, map) &&
        map.parent.parent.type === "JSXExpressionContainer" &&
        isLiveRegion(map.parent.parent.parent);

  // Named once, at this one tag, with exactly its props.
  const isSelectedPart = (opening, part) => {
    const callback = selectedCallbackOf(opening.parent);
    const names = partProps.get(part);
    const given = opening.attributes.filter(
      (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier",
    );
    return (
      callback !== null &&
      isPartPlaced(part, callback.parent) &&
      variableOf(opening.name).references.length === 1 &&
      given.length === opening.attributes.length &&
      given.length === names.length &&
      names.every((name) =>
        given.some(
          (a) =>
            a.name.name === name &&
            isPartProp(name, expressionOf(a), callback.params[0]),
        ),
      )
    );
  };

  // The live region holds the announcement and nothing else, so no control can reach it.
  const holdsAnnouncement = (element) => {
    const kids = element.children.filter(
      (c) => c.type !== "JSXText" || c.value.trim() !== "",
    );
    const choice =
      kids.length === 1 && kids[0].type === "JSXExpressionContainer"
        ? kids[0].expression
        : null;
    const shown =
      choice?.type === "ConditionalExpression" &&
      choice.consequent.type === "CallExpression"
        ? choice.consequent.arguments[0]?.body?.consequent
        : null;
    return (
      shown?.type === "JSXElement" &&
      partOf(shown.openingElement) === "Announcement"
    );
  };

  const isSwitchOptions = (expression) => {
    const callback = sequenceMapOf(expression?.arguments?.[0]);
    const option = callback?.body;
    if (
      callback?.parent !== expression ||
      option.type !== "ObjectExpression" ||
      option.properties.length !== 2
    )
      return false;
    const field = (key) =>
      option.properties.find((p) => isLiteralProperty(p, key))?.value;
    const label = field("label");
    return (
      isIndexPlusOne(field("id"), callback.params[1]) &&
      label?.type === "MemberExpression" &&
      !label.computed &&
      !label.optional &&
      label.property.name === "name" &&
      isParamOf(label.object, callback.params[0])
    );
  };

  const isPressedWhenValid = (expression) =>
    expression?.type === "ConditionalExpression" &&
    isValidConst(expression.test) &&
    isPositionField(expression.consequent, "sequence") &&
    isNull(expression.alternate);

  const switchProps = ["options", "selectedSequence", sequenceProp];

  const shownWhen = (element) =>
    element.parent?.type === "ConditionalExpression" &&
    element.parent.consequent === element
      ? element.parent.test
      : null;

  let titleHooks = 0;
  let introHooks = 0;
  let noteHooks = 0;
  // The intro and note hooks read the active sequence's own props, which its one call site binds.
  const isActive = isStepperPart("ActiveSequence");
  // The stepper's hooks: the title's from its block, the intro's only at Start, and a note's only
  // at its own step, so one target is shown per state.
  const isStepperHook = (opening, tag, expression) => {
    if (tag !== "p") return false;
    if (
      isParamMember(expression, "block", "blockId") &&
      isStepperProp(expression.object, "block")
    ) {
      titleHooks++;
      return true;
    }
    const test = shownWhen(opening.parent);
    if (isParamMember(expression, "sequence", "introBlockId")) {
      introHooks++;
      return (
        isPropParameter(expression.object, "sequence", isActive) &&
        test?.type === "BinaryExpression" &&
        test.operator === "===" &&
        isPropParameter(test.left, "step", isActive) &&
        test.right.type === "Literal" &&
        test.right.value === 0
      );
    }
    if (!isMapElementMember(expression, "blockId")) return false;
    noteHooks++;
    const callback = onlyDef(variableOf(expression.object)).node;
    const index = test?.left?.left;
    return (
      isParamMember(callback.parent.callee.object, "sequence", "steps") &&
      isPropParameter(
        callback.parent.callee.object.object,
        "sequence",
        isActive,
      ) &&
      callback.body === opening.parent.parent &&
      test?.type === "BinaryExpression" &&
      test.operator === "===" &&
      test.left.type === "BinaryExpression" &&
      test.left.operator === "+" &&
      index?.type === "Identifier" &&
      onlyDef(variableOf(index))?.name === callback.params[1] &&
      test.left.right.type === "Literal" &&
      test.left.right.value === 1 &&
      isPropParameter(test.right, "step", isActive)
    );
  };

  const isStepperRoot = (opening) => {
    const fn = enclosingFunction(opening);
    const statement = opening.parent.parent;
    return (
      fn !== null &&
      isExported("WalkStepper")(fn) &&
      statement?.type === "ReturnStatement" &&
      statement.parent === fn.body
    );
  };

  const isFrozenPart = (fn) =>
    unit === blocksModule &&
    fn?.type === "FunctionDeclaration" &&
    fn.id?.name === frozenWalk &&
    fn.parent.type === "Program";

  const inFrozenWalk = (node) => isFrozenPart(enclosingFunction(node));

  const isControlledPart = (fn) =>
    unit === blocksModule &&
    fn?.type === "FunctionDeclaration" &&
    fn.id?.name === controlledWalk &&
    fn.parent.type === "Program";

  const isControlledRoot = (opening) => {
    const fn = enclosingFunction(opening);
    const statement = opening.parent.parent;
    return (
      isControlledPart(fn) &&
      statement?.type === "ReturnStatement" &&
      statement.parent === fn.body
    );
  };

  const isPlainCall = (call, count) =>
    call?.type === "CallExpression" &&
    !call.optional &&
    !call.typeArguments &&
    call.arguments.length === count;

  // What the page shows for this walk: one field of the control's lookup by the walk's own id.
  const shownCallOf = (expression, field) =>
    expression?.type === "MemberExpression" &&
    !expression.computed &&
    !expression.optional &&
    expression.property.name === field &&
    isPlainCall(expression.object, 1) &&
    isParamMember(expression.object.callee, controlProp, "shownOf") &&
    isParamMember(expression.object.arguments[0], "block", "id")
      ? expression.object
      : null;

  // The stepper's handler: one call that hands the page the change with the walk's own id, as
  // `(change) => { walkControl.onWalkChange({ walkId: block.id, position: change.position,
  // cause: change.cause }); }`, or null.
  const controlReportOf = (expression) => {
    if (
      expression?.type !== "ArrowFunctionExpression" ||
      expression.async ||
      expression.params.length !== 1 ||
      expression.params[0].type !== "Identifier" ||
      expression.body.type !== "BlockStatement" ||
      expression.body.body.length !== 1 ||
      expression.body.body[0].type !== "ExpressionStatement"
    )
      return null;
    const call = expression.body.body[0].expression;
    if (
      !isPlainCall(call, 1) ||
      !isParamMember(call.callee, controlProp, "onWalkChange") ||
      call.arguments[0].type !== "ObjectExpression"
    )
      return null;
    const fields = call.arguments[0].properties;
    const ofChange = (value, field) =>
      value?.type === "MemberExpression" &&
      !value.computed &&
      !value.optional &&
      value.property.name === field &&
      value.object.type === "Identifier" &&
      onlyDef(variableOf(value.object))?.node === expression;
    const formed = new Map([
      ["walkId", (value) => isParamMember(value, "block", "id")],
      ["position", (value) => ofChange(value, "position")],
      ["cause", (value) => ofChange(value, "cause")],
    ]);
    const seen = new Set();
    for (const field of fields) {
      const name = field.type === "Property" ? propertyName(field) : null;
      if (
        name === null ||
        field.computed ||
        field.shorthand ||
        seen.has(name) ||
        !formed.get(name)?.(field.value)
      )
        return null;
      seen.add(name);
    }
    return seen.size === formed.size ? call : null;
  };

  // The one choice that freezes a walk with no control and hands it to the controlled walk with one.
  const isWalkChoice = (opening, branch) => {
    const choice = opening.parent.parent;
    const tagOf = (node) =>
      node?.type === "JSXElement" &&
      node.openingElement.name.type === "JSXIdentifier"
        ? node.openingElement.name.name
        : null;
    const test = choice?.type === "ConditionalExpression" ? choice.test : null;
    const blank = test?.right;
    return (
      unit === blocksModule &&
      test !== null &&
      choice[branch] === opening.parent &&
      test.type === "BinaryExpression" &&
      test.operator === "===" &&
      isPropParameter(test.left, controlProp) &&
      blank.type === "Identifier" &&
      blank.name === "undefined" &&
      (variableOf(blank)?.defs.length ?? 0) === 0 &&
      tagOf(choice.consequent) === frozenWalk &&
      tagOf(choice.alternate) === controlledWalk
    );
  };

  // The container the frozen walk returns: its anchor and its block hook stand there alone.
  const isFrozenRoot = (opening) => {
    if (opening?.type !== "JSXOpeningElement") return false;
    const fn = enclosingFunction(opening);
    const statement = opening.parent.parent;
    return (
      opening.name.type === "JSXIdentifier" &&
      opening.name.name === "div" &&
      isFrozenPart(fn) &&
      statement?.type === "ReturnStatement" &&
      statement.parent === fn.body
    );
  };

  // One field of the walk's first sequence, read straight from the block prop.
  const isFirstSequenceMember = (expression, field) =>
    expression?.type === "MemberExpression" &&
    !expression.computed &&
    !expression.optional &&
    expression.property.name === field &&
    expression.object.type === "MemberExpression" &&
    expression.object.computed &&
    !expression.object.optional &&
    expression.object.property.type === "Literal" &&
    expression.object.property.value === 0 &&
    isParamMember(expression.object.object, "block", "sequences");

  // The <p> standing at the frozen walk's root that shows sequence 1's intro through Spans.
  const isFrozenIntro = (opening) =>
    opening.name.type === "JSXIdentifier" &&
    opening.name.name === "p" &&
    isFrozenRoot(opening.parent.parent?.openingElement) &&
    opening.parent.children.some(
      (child) =>
        child.type === "JSXElement" &&
        child.openingElement.name.type === "JSXIdentifier" &&
        child.openingElement.name.name === "Spans" &&
        child.openingElement.attributes.some(
          (a) =>
            a.type === "JSXAttribute" &&
            a.name.name === "spans" &&
            isFirstSequenceMember(expressionOf(a), "intro"),
        ),
    );

  let frozenRoots = 0;
  let controlledRoots = 0;
  let walkChoices = 0;
  let frozenIntros = 0;
  // A frozen walk's only hooks: its block's on the root and sequence 1's intro on the <p> that
  // shows it, so the hook is never duplicated and no inactive target is written.
  const frozenHookProblem = (opening, expression) => {
    if (isFirstSequenceMember(expression, "introBlockId")) {
      frozenIntros++;
      return isFrozenIntro(opening)
        ? null
        : "a frozen walk's intro hook must stand on the <p> at its root that shows sequence 1's intro";
    }
    return isParamMember(expression, "block", "blockId") &&
      isFrozenRoot(opening)
      ? null
      : "a frozen walk writes no hook but its block's on its root and sequence 1's intro";
  };

  // The admitted map callback that returns this element as its whole body.
  const cellCallback = (opening) => {
    const callback = opening.parent.parent;
    return callback?.type === "ArrowFunctionExpression" &&
      callback.body === opening.parent &&
      isMapCall(callback.parent) &&
      callback.parent.arguments[0] === callback
      ? callback
      : null;
  };

  // A walk cell's states stand only on a cell of the two walk lists: in the stepper a call of
  // its own cellState on each replayed slot, the pin binding that helper; in a frozen walk the
  // literal empty on a starting cell that is null, as no step has read or written one yet.
  const isCellStates = (opening, expression) => {
    const callback = cellCallback(opening);
    if (callback === null) return false;
    const collection = callback.parent.callee.object;
    if (unit === stepperModule)
      return (
        isStepperPart("CellList")(enclosingFunction(opening)) &&
        isParamMember(collection, "state", "slots") &&
        expression?.type === "CallExpression" &&
        expression.arguments.length === 3 &&
        expression.callee.type === "Identifier" &&
        isStepperPart("cellState")(onlyDef(variableOf(expression.callee))?.node)
      );
    const test = expression?.test;
    return (
      inFrozenWalk(opening) &&
      isParamMember(collection, "block", "cells") &&
      expression?.type === "ConditionalExpression" &&
      test.type === "BinaryExpression" &&
      test.operator === "===" &&
      test.left.type === "Identifier" &&
      onlyDef(variableOf(test.left))?.name === callback.params[0] &&
      isNull(test.right) &&
      expression.consequent.type === "Literal" &&
      expression.consequent.value === "empty" &&
      isNull(expression.alternate)
    );
  };

  const besideLost = (element) => {
    const parent = element.parent;
    return (
      (parent?.type === "JSXElement" || parent?.type === "JSXFragment") &&
      parent.children.some(
        (c) => c.type === "JSXText" && c.value.trim() === "lost",
      )
    );
  };

  const changeCalls = new Set();
  let liveCount = 0;
  let strikeCount = 0;
  let rootCount = 0;
  let switchCount = 0;
  const stepperCauses = [];
  let handlerCount = 0;
  let hrefCount = 0;
  let popoverCount = 0;

  const checkIntrinsic = (opening, tag) => {
    if (isControlledPart(enclosingFunction(opening))) {
      report(opening.name, "a controlled walk writes nothing but its stepper");
      return;
    }
    if (unit === stepperModule && !stepperElements.has(tag)) {
      report(
        opening.name,
        `element <${tag}> is not admitted in the walk stepper`,
      );
      return;
    }
    const allowed = intrinsics.get(tag);
    if (
      allowed === undefined ||
      (cardElements.has(tag) && unit !== cardsModule) ||
      (tag === "h4" && unit !== cardsModule && unit !== buildModule) ||
      (tag === "s" && unit !== stepperModule) ||
      (tag === "button" &&
        unit !== pickerModule &&
        unit !== termModule &&
        unit !== stepperModule)
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
      if (
        name === blockHook &&
        unit === blocksModule &&
        (inFrozenWalk(opening) ||
          isFirstSequenceMember(expression, "introBlockId"))
      ) {
        const problem = frozenHookProblem(opening, expression);
        if (problem !== null) report(attribute, problem);
        continue;
      }
      let ok;
      if (name === blockHook)
        ok =
          unit === stepperModule
            ? isStepperHook(opening, tag, expression)
            : tag === "li"
              ? isMapElementMember(expression, "blockId")
              : isParamMember(expression, "block", "blockId");
      else if (name === sectionHook)
        ok = isParamMember(expression, "section", "id");
      else if (name === cellStates) ok = isCellStates(opening, expression);
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
      else if (name === "aria-disabled")
        ok =
          unit === stepperModule && isBound(expression, buttonCause(opening));
      else if (name === "aria-live") {
        liveCount++;
        ok = unit === stepperModule && literalValue(attribute) === "polite";
      } else if (name === "aria-atomic")
        ok =
          unit === stepperModule &&
          literalValue(attribute) === "true" &&
          isLiveRegion(opening.parent);
      else if (name === "scope") ok = literalValue(attribute) === "col";
      else if (name === "onClick" && unit === stepperModule) {
        const call = clickReportOf(expression, buttonCause(opening));
        if (call !== null) changeCalls.add(call);
        ok = call !== null;
      } else if (name === "onClick") {
        handlerCount++;
        const call = changeCallOf(expression);
        if (call !== null) changeCalls.add(call);
        ok = call !== null;
      } else if (tag === "div") {
        if (unit === stepperModule) rootCount++;
        ok =
          isParamMember(expression, "block", "id") &&
          (unit !== stepperModule || isStepperRoot(opening)) &&
          (!inFrozenWalk(opening) || isFrozenRoot(opening));
      } else if (tag === "h2" && unit === entryModule)
        ok = isParamMember(expression, "entry", "id");
      else if (tag === "h4")
        ok =
          unit === buildModule
            ? isParamMember(expression, "approach", "id")
            : isParamMember(expression, "card", "id");
      else if (tag === "h2" || tag === "h3")
        ok = isParamMember(expression, "section", "id");
      else if (tag === "ol")
        ok =
          unit !== stepperModule && isParamMember(expression, "block", "start");
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
      for (const name of unit === termModule
        ? termButton
        : unit === stepperModule
          ? stepperButton
          : pickerButton)
        if (!seen.has(name))
          report(opening.name, `<button> must carry ${name}`);
    // A stepper button's text names the move its bound and handler read.
    if (tag === "button" && unit === stepperModule) {
      const cause = buttonCause(opening);
      if (cause === null)
        report(
          opening.name,
          "a walk stepper button must carry the literal text Prev or Next",
        );
      else stepperCauses.push(cause);
      if (!isShownWhenValid(opening.parent.parent))
        report(
          opening.name,
          "a walk stepper button must be shown only at a valid position",
        );
    }
    // Where the region is written and what it holds; its persistence and plain text rest on the
    // module pin and the view tests.
    if (tag === "p" && unit === stepperModule && seen.has("aria-live")) {
      if (!seen.has("aria-atomic"))
        report(opening.name, "the live region must carry aria-atomic");
      const parent = opening.parent.parent;
      if (
        parent?.type !== "JSXElement" ||
        !isStepperRoot(parent.openingElement)
      )
        report(
          opening.name,
          "the live region must stand at the walk stepper's root",
        );
      if (!holdsAnnouncement(opening.parent))
        report(
          opening.name,
          "the live region must hold the walk announcement alone",
        );
    }
    if (isFrozenRoot(opening)) {
      frozenRoots++;
      if (!seen.has("id") || !seen.has(blockHook))
        report(
          opening.name,
          "a frozen walk's root must carry its anchor and its block hook",
        );
    }
    if (tag === "s") {
      strikeCount++;
      if (!besideLost(opening.parent))
        report(opening.name, "<s> must stand beside the text lost");
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
    if (name.name === "WalkStepper") {
      if (isControlledRoot(opening)) controlledRoots++;
      else
        report(
          name,
          "the walk stepper is shown only as the root of the controlled walk in Blocks.tsx",
        );
    } else if (isControlledPart(enclosingFunction(opening)))
      report(name, "a controlled walk writes nothing but its stepper");
    if (name.name === frozenWalk || name.name === controlledWalk) {
      const branch = name.name === frozenWalk ? "consequent" : "alternate";
      if (!isWalkChoice(opening, branch))
        report(
          name,
          "a walk is frozen with no control and controlled with one, by one choice",
        );
      else if (branch === "consequent") walkChoices++;
    }
    if (isControlledRoot(opening) && name.name === "WalkStepper") {
      const given = new Set();
      for (const attribute of opening.attributes) {
        const prop =
          attribute.type === "JSXAttribute" &&
          attribute.name.type === "JSXIdentifier"
            ? attribute.name.name
            : null;
        if (!controlledProps.includes(prop) || given.has(prop)) {
          report(
            attribute,
            `prop ${String(prop)} is not admitted on the controlled stepper`,
          );
          continue;
        }
        given.add(prop);
        const expression = expressionOf(attribute);
        const shown =
          prop === "position" || prop === "announce"
            ? shownCallOf(expression, prop)
            : null;
        const call = prop === positionProp ? controlReportOf(expression) : null;
        if (shown !== null) changeCalls.add(shown);
        if (call !== null) changeCalls.add(call);
        if (
          shown === null &&
          call === null &&
          !(
            (prop === "block" || prop === "slugs") &&
            isPropParameter(expression, prop, isControlledPart)
          )
        )
          report(
            attribute,
            "the controlled stepper takes its own block and slugs, what the page shows for the walk's id, and a handler that reports the move with that id",
          );
      }
      return;
    }
    const part = unit === stepperModule ? partOf(opening) : null;
    if (part !== null && !isSelectedPart(opening, part))
      report(
        name,
        `${part} must show the selected sequence at a valid position, with its own props`,
      );
    if (unit === stepperModule && isSequencePickerTag(opening)) {
      switchCount++;
      const given = new Map();
      for (const attribute of opening.attributes) {
        const prop =
          attribute.type === "JSXAttribute" &&
          attribute.name.type === "JSXIdentifier"
            ? attribute.name.name
            : null;
        if (!switchProps.includes(prop) || given.has(prop))
          report(
            attribute,
            `prop ${String(prop)} is not admitted on the sequence switch`,
          );
        else given.set(prop, expressionOf(attribute));
      }
      for (const prop of switchProps)
        if (!given.has(prop))
          report(name, `the sequence switch must carry ${prop}`);
      if (given.has("options") && !isSwitchOptions(given.get("options")))
        report(
          name,
          "the switch options must be the walk's own sequences, by place from 1 and name",
        );
      if (
        given.has("selectedSequence") &&
        !isPressedWhenValid(given.get("selectedSequence"))
      )
        report(
          name,
          "the switch must press the position's sequence only when it is valid",
        );
    }
    for (const attribute of opening.attributes) {
      if (attribute.type !== "JSXAttribute") continue;
      if (attribute.name.type !== "JSXIdentifier") {
        report(attribute, "namespaced attribute is not admitted");
        continue;
      }
      const lower = attribute.name.name.toLowerCase();
      if (lower === controlProp.toLowerCase()) {
        if (!controlHosts.has(unit))
          report(
            attribute,
            "the walk control is handed down only by the content hosts",
          );
        else if (
          attribute.name.name !== controlProp ||
          !isPropParameter(expressionOf(attribute), controlProp)
        )
          report(attribute, "a host hands the walk control down unchanged");
        continue;
      }
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
      if (
        unit === stepperModule &&
        attribute.name.name === sequenceProp &&
        isSequencePickerTag(opening)
      ) {
        const call = sequenceReportOf(expressionOf(attribute));
        if (call !== null) {
          changeCalls.add(call);
          continue;
        }
      }
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
        if (rendererWithheld.get(target)?.includes(name)) {
          report(
            spec,
            `import ${name} from ${source} is withheld from renderer modules`,
          );
          continue;
        }
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

  // An erased declaration-level type import or export never runs, so only this check passes it;
  // the renderer import and export rules still apply. verbatimModuleSyntax keeps an inline type
  // specifier as a run-time import, so that is refused like a value.
  const checkReach = (node) => {
    if (node.source === null || node.source === undefined) return;
    const declared =
      node.type === "ImportDeclaration" ? node.importKind : node.exportKind;
    if (declared === "type") return;
    const source = node.source.value;
    if (namesListedTest(source))
      report(
        node,
        `a run-time import or re-export of test module ${source} is admitted only in a listed test`,
      );
    if (!namesWalkHelper(source)) return;
    const specifiers = node.specifiers ?? [];
    if (node.type === "ExportAllDeclaration")
      report(
        node,
        `export * from walk helper ${source} is admitted only in a listed test`,
      );
    else if (specifiers.length === 0)
      report(
        node,
        `a side-effect import of walk helper ${source} is admitted only in a listed test`,
      );
    for (const spec of specifiers) {
      const name =
        spec.type === "ImportSpecifier"
          ? importedName(spec)
          : spec.type === "ImportDefaultSpecifier"
            ? "default"
            : spec.type === "ImportNamespaceSpecifier"
              ? "*"
              : staticName(spec.local);
      if (
        unit === stepperModule &&
        node.type === "ImportDeclaration" &&
        spec.type === "ImportSpecifier" &&
        spec.importKind !== "type" &&
        stepperHelperValues.get(source)?.includes(name)
      )
        continue;
      report(
        spec,
        spec.importKind === "type" || spec.exportKind === "type"
          ? `inline type ${name} from walk helper ${source} stays a run-time import; use import type`
          : `walk helper value ${name} from ${source} is admitted only in a listed test`,
      );
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
    if (kind !== "test")
      switch (node.type) {
        case "ImportDeclaration":
        case "ExportNamedDeclaration":
        case "ExportAllDeclaration":
          checkReach(node);
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
          if (isStepperPart("Announcement")(enclosingFunction(node)))
            report(node.name, "the walk announcement writes no element");
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
  // The pin adds to the local rules rather than replacing them, so a pin update alone cannot
  // admit what they refuse.
  if (pinnedUnits.has(unit))
    for (const name of pinFindings(unit, text, hasBOM)) report(program, name);
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
  // Counts of what the source writes, not of what renders: a value written once may render twice.
  if (unit === pickerModule && handlerCount !== 1)
    report(program, `${pickerModule} must write exactly one handler`);
  if (unit === blocksModule)
    for (const [count, what] of [
      [frozenRoots, "frozen walk root"],
      [frozenIntros, "frozen walk intro hook"],
      [controlledRoots, "controlled walk stepper"],
      [walkChoices, "walk choice"],
    ])
      if (count !== 1)
        report(program, `${blocksModule} must write exactly one ${what}`);
  if (unit === stepperModule) {
    const once = [
      [liveCount, "live region"],
      [strikeCount, "strike"],
      [rootCount, "root anchor"],
      [titleHooks, "title hook"],
      [introHooks, "intro hook"],
      [noteHooks, "note hook"],
      [switchCount, "sequence switch"],
    ];
    for (const [count, what] of once)
      if (count !== 1)
        report(program, `${stepperModule} must write exactly one ${what}`);
    if (stepperCauses.sort().join() !== "next,prev")
      report(
        program,
        `${stepperModule} must write exactly one Prev and one Next button`,
      );
  }
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
