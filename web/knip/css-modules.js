import { basename } from "node:path";
import { transform } from "lightningcss";

const literal = (value) => JSON.stringify(value);

// Knip reports unused members only on a named enum, and credits `styles.name`
// on a default import only when the default is a re-export, so the module
// exports its local names as an enum and re-exports that enum as default.
export const compileCssModule = (source, path) => {
  const { exports = {} } = transform({
    filename: path,
    code: Buffer.from(source),
    cssModules: true,
  });
  const names = Object.keys(exports).sort();
  const hashed = new Map(names.map((name) => [exports[name].name, name]));
  const usedInFile = new Set(
    names.filter((name) => exports[name].isReferenced),
  );
  const composed = new Map();
  for (const name of names) {
    for (const entry of exports[name].composes) {
      if (entry.type === "local") usedInFile.add(hashed.get(entry.name));
      if (entry.type !== "dependency") continue;
      const targets = composed.get(entry.specifier) ?? new Set();
      composed.set(entry.specifier, targets.add(entry.name));
    }
  }
  const members = names.map((name) => `${literal(name)} = ""`).join(", ");
  const lines = [
    `export enum Locals { ${members} }`,
    `import { Locals as self } from ${literal(`./${basename(path)}`)};`,
    "export { self as default };",
  ];
  for (const name of [...usedInFile].sort()) {
    lines.push(`self[${literal(name)}];`);
  }
  [...composed.keys()].sort().forEach((specifier, index) => {
    lines.push(`import composed${index} from ${literal(specifier)};`);
    for (const name of [...composed.get(specifier)].sort()) {
      lines.push(`composed${index}[${literal(name)}];`);
    }
  });
  return lines.join("\n");
};

// Global stylesheets export nothing to JavaScript.
export const compileCss = (source, path) =>
  path.endsWith(".module.css") ? compileCssModule(source, path) : "";
