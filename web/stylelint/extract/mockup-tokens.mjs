// The mockup's token declarations per context, recorded so tokens.css can be reconciled offline.
// Run as: node web/stylelint/extract/mockup-tokens.mjs <mockup.html> <out.json>.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";

const GENERATOR = "web/stylelint/extract/mockup-tokens.mjs";

const contexts = new Map([
  ["|:root", "light"],
  ['|[data-theme="dark"]', "dark"],
  ['|[data-theme="dark"]  .work', "dark-work"],
  ["prefers-color-scheme: dark|:root:not([data-theme])", "system-dark"],
  [
    "prefers-color-scheme: dark|:root:not([data-theme]) .work",
    "system-dark-work",
  ],
  [
    "print|:root[data-theme], :root:not([data-theme]), :root[data-theme] .work, :root:not([data-theme]) .work",
    "print",
  ],
]);

/** Every custom property in the first style element, in source order, duplicates kept. */
export function mockupTokens(html) {
  const style = /<style>([\s\S]*?)<\/style>/u.exec(html);
  if (style === null) throw new Error("the mockup has no style element");
  const found = Object.fromEntries([...contexts.values()].map((c) => [c, []]));
  postcss.parse(style[1]).walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return;
    const rule = decl.parent;
    const media = rule.parent?.type === "atrule" ? rule.parent.params : "";
    const key = `${media.replace(/^\(|\)$/gu, "")}|${rule.selector}`;
    const context = contexts.get(key);
    if (context === undefined)
      throw new Error(`unrecognised token context ${JSON.stringify(key)}`);
    found[context].push([decl.prop, decl.value]);
  });
  return found;
}

const [mockupPath, outPath] = process.argv.slice(2);
if (mockupPath !== undefined) {
  if (outPath === undefined) {
    console.error("Usage: node mockup-tokens.mjs <mockup.html> <out.json>");
    process.exit(2);
  }
  const html = readFileSync(mockupPath);
  const record = {
    source: {
      description: "theme mockup",
      sha256: createHash("sha256").update(html).digest("hex"),
    },
    generator: GENERATOR,
    contexts: mockupTokens(html.toString("utf8")),
  };
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
}
