// Acceptance of the extracted named type roles, kept pure so it runs without a browser.
import valueParser from "postcss-value-parser";

/** Comments and spacing are not value differences, so they are dropped before comparing. */
export function normalise(value) {
  const print = (nodes) =>
    nodes
      .filter((n) => n.type !== "comment")
      .map((n) => {
        if (n.type === "function") return `${n.value}(${print(n.nodes)})`;
        if (n.type === "space") return " ";
        return n.value;
      })
      .join("");
  return print(valueParser(value.trim()).nodes);
}

// Measured-pair notes that mean the role no longer holds its contract value.
const failingNotes = new Set([
  "role value differs from the contract",
  "role measured with two values",
]);

/** An unmeasured role fails unless it is listed as resting on authored evidence alone. */
export function roleFailures({
  roles,
  authoredOnly,
  declarations,
  measured,
  conflicts,
}) {
  const failures = [];
  const find = (selector, line, prop) =>
    declarations.filter(
      (d) => d.selector === selector && d.line === line && d.prop === prop,
    );
  for (const [label, fontSize, lineHeight, bindings] of roles) {
    for (const [fsSelector, fsLine, lhSelector, lhLine] of bindings) {
      for (const [prop, selector, line, contract] of [
        ["font-size", fsSelector, fsLine, fontSize],
        ["line-height", lhSelector, lhLine, lineHeight],
      ]) {
        const found = find(selector, line, prop);
        if (found.length === 0) {
          failures.push(
            `${label}: no ${prop} at ${selector} line ${line} (missing or moved)`,
          );
        } else if (
          !found.some((d) => normalise(d.value) === normalise(contract))
        ) {
          failures.push(
            `${label}: ${prop} at ${selector} line ${line} is ${found[0].value}, contract ${contract}`,
          );
        }
      }
    }
    if (!measured.has(label) && !authoredOnly.has(label)) {
      failures.push(`${label}: never measured`);
    }
  }
  for (const { name, note, mockup } of conflicts) {
    if (failingNotes.has(note)) failures.push(`${name}: ${note} (${mockup})`);
  }
  return failures;
}
